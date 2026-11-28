package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedTraegerStaffStep seeds the Personalstamm of the demo Träger (#4705)
// through the routes the people use: the moto team grants the release
// „Personal beim Träger“ in the Operator portal, then the Personalverwaltung
// confirms the proposals of the overview, choosing the first value where the
// schools disagree, and keeps an invented IBAN for the first record; then
// it imports invented people from a file (#4724), hires one new person
// (#7206) and seeds
// the Abwesenheitsarten and Kontingente of the Träger (#4710). Several
// demo schools seed the same Träger; a release or link another school's run
// made is no error.
type seedTraegerStaffStep struct{}

func (seedTraegerStaffStep) Name() string { return "Seeding the staff records of the Träger" }

// seedTraegerStaffLinks bounds the proposals the seed confirms, so the
// overview keeps open proposals to review.
const seedTraegerStaffLinks = 6

// The codes the routes answer when another school's run got there first.
const (
	seedCodeStaffReleaseExists = "workforce.traeger_staff_release_exists"
	seedCodeStaffAlreadyLinked = "workforce.traeger_staff_already_linked"
	seedCodeStaffNumberTaken   = "workforce.personnel_number_taken"
)

// seedTraegerStaffIBAN is an invented IBAN with a valid checksum.
const seedTraegerStaffIBAN = "DE02120300000000202051"

func (seedTraegerStaffStep) Run(ctx context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil || rt.Bootstrap.OrganizationID <= 0 {
		return fmt.Errorf("the Träger staff seed prerequisites are not available")
	}
	if err := seedTraegerStaffRelease(rt); err != nil {
		return err
	}
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	suggestions, err := seedTraegerStaffSuggestions(rt.Client, auth)
	if err != nil {
		return err
	}
	linked, first, records, err := seedTraegerStaffLinkAll(rt.Client, auth, withoutVisitorStaff(rt, suggestions))
	if err != nil {
		return err
	}
	contracts, err := seedTraegerStaffContracts(rt.Client, auth, records)
	if err != nil {
		return err
	}
	if err := seedTraegerStaffFirstRecord(rt.Client, auth, first); err != nil {
		return err
	}
	imported, hired, err := seedTraegerStaffIntake(rt.Client, auth, rt.Bootstrap.SchoolID)
	if err != nil {
		return err
	}
	planned, err := seedTraegerPlanning(rt.Client, auth)
	if err != nil {
		return err
	}
	blocked, err := seedTraegerPoolBlock(rt.Client, rt.TenantAuth)
	if err != nil {
		return err
	}
	closed, err := seedTraegerMonthClose(rt.Client, auth, first)
	if err != nil {
		return err
	}
	employers, paid, err := seedTraegerPayrollMonth(rt.Client, auth, records)
	if err != nil {
		return err
	}
	fmt.Printf("  Träger staff records: %d linked, %d contracts, %d imported, person hired: %t, %d planned shifts, Springer blocked: %t, month closed: %t, %d employers with payroll values, %d contracts in the payroll file\n",
		linked, contracts, imported, hired, planned, blocked, closed, employers, paid)
	return seedTraegerAbsences(ctx, rt, auth)
}

// seedTraegerPayrollMonth fills in the payroll values of the other
// employers (#8041) and reads the check of last month's payroll file: how
// many employers it filled in and how many contracts the file counts.
func seedTraegerPayrollMonth(client *Client, auth AuthRef, records []int64) (int, int, error) {
	employers, err := seedTraegerPayrollEmployers(client, auth, records)
	if err != nil {
		return 0, 0, err
	}
	last := time.Now().AddDate(0, -1, 0)
	paid, err := seedTraegerPayroll(client, auth, last.Year(), int(last.Month()))
	return employers, paid, err
}

// seedTraegerStaffLinkAll confirms up to seedTraegerStaffLinks proposals and
// returns how many it linked, the first record it created and all of them.
func seedTraegerStaffLinkAll(client *Client, auth AuthRef, suggestions []seedTraegerStaffSuggestion) (int, int64, []int64, error) {
	var records []int64
	first := int64(0)
	for _, suggestion := range suggestions {
		if len(records) == seedTraegerStaffLinks {
			break
		}
		id, err := seedTraegerStaffLink(client, auth, suggestion)
		if err != nil {
			return 0, 0, nil, err
		}
		if id > 0 {
			records = append(records, id)
		}
		if first == 0 {
			first = id
		}
	}
	return len(records), first, records, nil
}

// seedTraegerStaffRelease grants the release with the statement of an
// agreement with the employee representation.
func seedTraegerStaffRelease(rt *Runtime) error {
	path := fmt.Sprintf("/operator/organizations/%d/staff-release", rt.Bootstrap.OrganizationID)
	_, err := rt.Client.PostWithAuth(rt.OperatorAuth, path, map[string]any{"representation": "agreement"})
	var refused *APIError
	if errors.As(err, &refused) && refused.Code == seedCodeStaffReleaseExists {
		return nil
	}
	if err != nil {
		return fmt.Errorf("grant the release Personal beim Träger: %w", err)
	}
	return nil
}

type seedTraegerStaffSuggestion struct {
	Reason   string    `json:"reason"`
	RecordID *ident.ID `json:"staff_record_id"`
	Members  []struct {
		SchoolID ident.ID `json:"school_id"`
		StaffID  ident.ID `json:"staff_id"`
	} `json:"members"`
}

// withoutVisitorStaff drops the proposals that name the visitor's
// employment: the visitor's name never reaches a record of the Träger, which
// outlives the visit (ADR 0233 point 9, ADR 0271).
func withoutVisitorStaff(rt *Runtime, suggestions []seedTraegerStaffSuggestion) []seedTraegerStaffSuggestion {
	if rt.seedVisitor().empty() || rt.Bootstrap == nil || rt.FixedSeeder == nil {
		return suggestions
	}
	staff := DemoStaff[visitorStaffIndex]
	visitorStaffID := rt.FixedSeeder.staffIDs[staff.FirstName+" "+staff.LastName]
	kept := make([]seedTraegerStaffSuggestion, 0, len(suggestions))
	for _, suggestion := range suggestions {
		named := false
		for _, member := range suggestion.Members {
			if int64(member.SchoolID) == rt.Bootstrap.SchoolID && int64(member.StaffID) == visitorStaffID {
				named = true
			}
		}
		if !named {
			kept = append(kept, suggestion)
		}
	}
	return kept
}

func seedTraegerStaffSuggestions(client *Client, auth AuthRef) ([]seedTraegerStaffSuggestion, error) {
	raw, err := client.GetWithAuth(auth, "/traeger/staff-records/")
	if err != nil {
		return nil, fmt.Errorf("read the Träger staff records: %w", err)
	}
	var envelope struct {
		Data struct {
			Suggestions []seedTraegerStaffSuggestion `json:"suggestions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("decode the Träger staff records: %w", err)
	}
	return envelope.Data.Suggestions, nil
}

// seedTraegerStaffLink confirms one proposal with the first value of every
// field the schools disagree on; it returns 0 when another run linked it.
func seedTraegerStaffLink(client *Client, auth AuthRef, suggestion seedTraegerStaffSuggestion) (int64, error) {
	members := make([]map[string]ident.ID, 0, len(suggestion.Members))
	for _, member := range suggestion.Members {
		members = append(members, map[string]ident.ID{"school_id": member.SchoolID, "staff_id": member.StaffID})
	}
	body := map[string]any{"members": members}
	if suggestion.RecordID != nil {
		body["staff_record_id"] = *suggestion.RecordID
	}
	raw, err := client.PostWithAuth(auth, "/traeger/staff-records/link-preview", body)
	if seedTraegerStaffAlreadyLinked(err) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("preview a Träger staff link: %w", err)
	}
	var preview struct {
		Data struct {
			Fingerprint string `json:"fingerprint"`
			Fields      []struct {
				Field    string `json:"field"`
				Conflict bool   `json:"conflict"`
				Options  []struct {
					Source string `json:"source"`
				} `json:"options"`
			} `json:"fields"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &preview); err != nil {
		return 0, fmt.Errorf("decode a Träger staff link preview: %w", err)
	}
	choices := map[string]string{}
	for _, field := range preview.Data.Fields {
		if field.Conflict && len(field.Options) > 0 {
			choices[field.Field] = field.Options[0].Source
		}
	}
	body["choices"] = choices
	// The link carries the fingerprint of the preview it chose on (ADR 0311).
	body["expected_fingerprint"] = preview.Data.Fingerprint
	raw, err = client.PostWithAuth(auth, "/traeger/staff-records/", body)
	if seedTraegerStaffAlreadyLinked(err) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("link a Träger staff record: %w", err)
	}
	var record struct {
		Data struct {
			ID ident.ID `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &record); err != nil || record.Data.ID == 0 {
		return 0, fmt.Errorf("decode a Träger staff record: %w", errors.Join(err, errors.New("no record id")))
	}
	return int64(record.Data.ID), nil
}

// seedTraegerStaffAlreadyLinked recognizes a proposal another school's run
// confirmed meanwhile, or a number another record holds.
func seedTraegerStaffAlreadyLinked(err error) bool {
	var refused *APIError
	return errors.As(err, &refused) && (refused.Code == seedCodeStaffAlreadyLinked || refused.Code == seedCodeStaffNumberTaken)
}

// seedTraegerStaffFinancial keeps the bank values of a record, saved over
// the version of the section's read as the form does (ADR 0311).
func seedTraegerStaffFinancial(client *Client, auth AuthRef, recordID int64) error {
	path := fmt.Sprintf("/traeger/staff-records/%d/financial", recordID)
	version, err := readDataVersion(func(path string) ([]byte, error) { return client.GetWithAuth(auth, path) }, path)
	if err != nil {
		return err
	}
	if _, err := client.PutWithAuth(auth, path, map[string]any{"iban": seedTraegerStaffIBAN, "expected_version": version}); err != nil {
		return fmt.Errorf("keep the bank values of a Träger staff record: %w", err)
	}
	return nil
}
