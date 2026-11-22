package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedTraegerSchoolChangeStep lets one child of the seeded school change to
// the Demo-Schule Manuell of the same Träger within the current month (ADR
// 0158, Nachtrag Schulwechsel, #7874). The child keeps its student record at
// the seeded school, whose contract the parents terminate for the change
// and the Träger ends today; the Demo-Schule Manuell takes the child in
// with its own record and a contract from tomorrow, for the same family.
// The open runs of the month of both schools then bill the child once and
// show it under „Ein Kind an zwei Schulen“.
//
// The Demo-Schule Manuell has no online enrollment. The step switches it on
// for the one manual enrollment the contract needs and off again, so the
// profile keeps its settings. It runs last among the Träger steps: the
// steps before read the active contracts of the seeded school.
type seedTraegerSchoolChangeStep struct{}

func (seedTraegerSchoolChangeStep) Name() string { return "Seeding a child changing its school" }

// The settings the manual enrollment at the Demo-Schule Manuell needs, with
// the values its profile restores (manualProfileSettings).
var seedSchoolChangeEnrollmentSettings = []string{profileSettingEnrollmentEnabled, profileSettingCareOfferingsEnabled}

// seedSchoolChangeReason is the reason of the termination at the old school.
const seedSchoolChangeReason = "Schulwechsel an die Demo-Schule Manuell."

func (seedTraegerSchoolChangeStep) Run(ctx context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil || rt.Bootstrap.AdminEmail == "" || rt.Adapter == nil {
		return fmt.Errorf("the school change seed prerequisites are not available")
	}
	manual, today, ok, err := seedSchoolChangeDay(rt)
	if err != nil || !ok {
		return err
	}
	month := calendar.NewDate(today.Year(), today.Month(), 1)
	change := today.AddDays(1)
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	school := int64(manual.School.ID)
	adminAuth, err := rt.Adapter.LoginTenant(ctx, manual.Credentials.SchoolAdmin.Email, manual.Credentials.SchoolAdmin.Password, manual.School.TenantSlug)
	if err != nil {
		return fmt.Errorf("sign in the admin of the Demo-Schule Manuell: %w", err)
	}
	// A repeated seed finds the phase of the change again and moves no
	// second child.
	if done, err := seedSchoolChangeDone(rt.Client, adminAuth); err != nil || done {
		return err
	}
	old, ok, err := seedSchoolChangeContract(rt.Client, auth, rt.Bootstrap.SchoolID, month)
	if err != nil || !ok {
		if ok = err == nil; ok {
			fmt.Println("  Schulwechsel: no active contract of the school to change from")
		}
		return err
	}
	offering, requestChild, err := seedSchoolChangeEnrollment(rt, adminAuth, old, change)
	if err != nil {
		return err
	}
	contractID, err := seedSchoolChangeNewContract(rt.Client, auth, school, offering, requestChild, old.party)
	if err != nil {
		return err
	}
	if err := seedSchoolChangeEnd(rt.Client, auth, old.id, today); err != nil {
		return err
	}
	if err := seedSchoolChangeRun(rt.Client, auth, school, month); err != nil {
		return err
	}
	fmt.Printf("  Schulwechsel: %s %s changes on %s from contract %d to contract %d at the Demo-Schule Manuell\n",
		old.firstName, old.lastName, change, old.id, contractID)
	return nil
}

// seedSchoolChangeDay answers the second school of the Träger and the day
// the old contract ends; ok is false without that school or on the last day
// of a month, when the change would fall into the next month.
func seedSchoolChangeDay(rt *Runtime) (*SeedProfile, calendar.Date, bool, error) {
	manual := rt.AdditionalProfiles[ManualProfileKey]
	if manual == nil || manual.Organization.ID != rt.Bootstrap.OrganizationID {
		fmt.Println("  Schulwechsel: no second school of the Träger; no child changes its school")
		return nil, "", false, nil
	}
	today, err := rt.historyToday()
	if err != nil {
		return nil, "", false, err
	}
	if today.AddDays(1).Month() != today.Month() {
		// The change must lie within the month the open run bills.
		fmt.Println("  Schulwechsel: the month ends today; no child changes its school")
		return nil, "", false, nil
	}
	return manual, today, true, nil
}

// seedSchoolChangeRun prices the modules of the Demo-Schule Manuell from
// the month on and leaves its run of the month open, so the review shows
// the child at both schools.
func seedSchoolChangeRun(client *Client, auth AuthRef, school int64, month calendar.Date) error {
	if err := seedSchoolChangePrices(client, auth, school, month); err != nil {
		return err
	}
	runID, err := seedStartCareRun(client, auth, school, month)
	if err != nil {
		return err
	}
	return seedBillingTerms(client, auth, runID, month)
}

// seedSchoolChangePrices gives every module of the school its weekday
// prices from the month on. The school already has prices for the module
// the Träger offers at all its schools (seedCarePriceLists), so the price
// list of the month names that module again next to the new one.
func seedSchoolChangePrices(client *Client, auth AuthRef, school int64, month calendar.Date) error {
	modules, err := seedCareOfferings(client, auth)
	if err != nil {
		return err
	}
	prices := []map[string]any{}
	for _, module := range modules {
		if int64(module.SchoolID) == school {
			prices = append(prices, seedCareWeekdays(module)...)
		}
	}
	if _, err := client.PutWithAuth(auth, "/traeger/care-tariffs/", map[string]any{
		"school_id": school, "valid_from": month.String(), "free_months": []int{}, "prices": prices,
	}); err != nil {
		return fmt.Errorf("set the prices of the Demo-Schule Manuell: %w", err)
	}
	return nil
}

// seedSchoolChangeChild is the contract of the old school and its child.
type seedSchoolChangeChild struct {
	id                  int64
	firstName, lastName string
	birthDate           calendar.Date
	party               seedSchoolChangeParty
}

type seedSchoolChangeParty struct {
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Email     string `json:"email"`
}

// seedSchoolChangeContract picks the last active contract of the school
// that holds on the first of the month and names a student record, a
// family with a mail address and the child's date of birth. The children
// other examples of the seed use keep their contracts.
func seedSchoolChangeContract(client *Client, auth AuthRef, school int64, month calendar.Date) (seedSchoolChangeChild, bool, error) {
	raw, err := client.GetWithAuth(auth, fmt.Sprintf("/traeger/contracts/?status=aktiv&school_id=%d", school))
	if err != nil {
		return seedSchoolChangeChild{}, false, fmt.Errorf("read the active contracts for the school change: %w", err)
	}
	var list struct {
		Data struct {
			Contracts []struct {
				ID             ident.ID      `json:"id"`
				SchoolID       ident.ID      `json:"school_id"`
				StudentID      *ident.ID     `json:"student_id"`
				ChildFirstName string        `json:"child_first_name"`
				ChildLastName  string        `json:"child_last_name"`
				PartyEmail     string        `json:"party_email"`
				EffectiveFrom  calendar.Date `json:"effective_from"`
			} `json:"contracts"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &list); err != nil {
		return seedSchoolChangeChild{}, false, err
	}
	reserved := []string{"Lina Amini", "Tilda Berger"}
	for _, contract := range slices.Backward(list.Data.Contracts) {
		if int64(contract.SchoolID) != school || contract.StudentID == nil || contract.PartyEmail == "" ||
			contract.EffectiveFrom.After(month) || slices.Contains(reserved, contract.ChildFirstName+" "+contract.ChildLastName) {
			continue
		}
		child, ok, err := seedSchoolChangeDetail(client, auth, int64(contract.ID))
		if err != nil || ok {
			return child, ok, err
		}
	}
	return seedSchoolChangeChild{}, false, nil
}

// seedSchoolChangeDetail reads the child and the family of a contract; ok
// is false without a date of birth or a party with a mail address.
func seedSchoolChangeDetail(client *Client, auth AuthRef, id int64) (seedSchoolChangeChild, bool, error) {
	raw, err := client.GetWithAuth(auth, fmt.Sprintf("/traeger/contracts/%d", id))
	if err != nil {
		return seedSchoolChangeChild{}, false, fmt.Errorf("read contract %d for the school change: %w", id, err)
	}
	var detail struct {
		Data struct {
			Version struct {
				ChildFirstName string         `json:"child_first_name"`
				ChildLastName  string         `json:"child_last_name"`
				ChildBirthDate *calendar.Date `json:"child_birth_date"`
			} `json:"version"`
			Parties []seedSchoolChangeParty `json:"parties"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &detail); err != nil {
		return seedSchoolChangeChild{}, false, err
	}
	version := detail.Data.Version
	if version.ChildBirthDate == nil || len(detail.Data.Parties) == 0 || detail.Data.Parties[0].Email == "" {
		return seedSchoolChangeChild{}, false, nil
	}
	return seedSchoolChangeChild{id: id, firstName: version.ChildFirstName, lastName: version.ChildLastName,
		birthDate: *version.ChildBirthDate, party: detail.Data.Parties[0]}, true, nil
}

// seedSchoolChangeEnrollment takes the child in at the Demo-Schule Manuell
// as its office would: a care offering of a phase whose care begins on
// the day of the change, and the child's approved enrollment, which gives
// it a student record there. It answers the offering and the enrolled
// child of the application.
func seedSchoolChangeEnrollment(rt *Runtime, auth AuthRef, child seedSchoolChangeChild, change calendar.Date) (offeringID, requestChildID int64, err error) {
	err = withSchoolChangeEnrollment(rt, auth, func() error {
		phaseID, err := seedSchoolChangeOffering(rt, auth, change)
		if err != nil {
			return err
		}
		offeringID, requestChildID, err = seedSchoolChangeApproval(rt, auth, phaseID, child)
		return err
	})
	return offeringID, requestChildID, err
}

// withSchoolChangeEnrollment switches the online enrollment of the
// Demo-Schule Manuell on for enroll and off again afterwards, as its
// profile has it.
func withSchoolChangeEnrollment(rt *Runtime, auth AuthRef, enroll func() error) (err error) {
	if err := seedEnrollmentPrivacyNoticeSettings(rt, auth); err != nil {
		return err
	}
	defer func() {
		for _, key := range slices.Backward(seedSchoolChangeEnrollmentSettings) {
			if _, restoreErr := rt.Client.PutWithAuth(auth, "/api/settings/values/"+key, map[string]any{"value": false}); restoreErr != nil {
				err = errors.Join(err, fmt.Errorf("switch off %s at the Demo-Schule Manuell again: %w", key, restoreErr))
			}
		}
	}()
	for _, key := range seedSchoolChangeEnrollmentSettings {
		if _, err := rt.Client.PutWithAuth(auth, "/api/settings/values/"+key, map[string]any{"value": true}); err != nil {
			return fmt.Errorf("switch on %s at the Demo-Schule Manuell: %w", key, err)
		}
	}
	return enroll()
}

// seedSchoolChangePhase is the phase the Demo-Schule Manuell takes the
// child in with; a repeated seed finds it by its name.
const seedSchoolChangePhase = "Aufnahme im laufenden Schuljahr"

// seedNamedPhase is a phase of the list by its name.
type seedNamedPhase struct {
	Name string `json:"name"`
}

// seedSchoolChangeDone tells whether an earlier seed took a child in
// already: the Demo-Schule Manuell has the phase of the change.
func seedSchoolChangeDone(client *Client, auth AuthRef) (bool, error) {
	raw, err := client.GetWithAuth(auth, "/api/enrollment/phases")
	if err != nil {
		return false, fmt.Errorf("read the phases of the Demo-Schule Manuell: %w", err)
	}
	var phases struct {
		Data []seedNamedPhase `json:"data"`
	}
	if err := parseJSON(raw, &phases); err != nil {
		return false, err
	}
	return slices.ContainsFunc(phases.Data, func(phase seedNamedPhase) bool { return phase.Name == seedSchoolChangePhase }), nil
}

// seedSchoolChangeOffering creates the form, the phase whose care begins
// on the day of the change, and its care offering; it answers the phase.
func seedSchoolChangeOffering(rt *Runtime, auth AuthRef, change calendar.Date) (int64, error) {
	raw, err := rt.Client.PostWithAuth(auth, "/api/enrollment/schema/", map[string]any{"name": "Aufnahme bei Schulwechsel", "fields": []any{}})
	if err != nil {
		return 0, fmt.Errorf("create the enrollment form of the Demo-Schule Manuell: %w", err)
	}
	schemaID, err := parseEnvelopeStringID(raw)
	if err != nil {
		return 0, err
	}
	yearEnd := calendar.NewDate(seedSchoolYearStart(rt.FixedSeeder.seedDay)+1, 7, 31)
	raw, err = rt.Client.PostWithAuth(auth, "/api/enrollment/phases", map[string]any{
		"name": seedSchoolChangePhase, "kind": "school_year",
		"service_start_date": change.String(), "service_end_date": yearEnd.String(),
		"show_status_reason_to_parent": true, "care_overflow_mode": "waitlist", "care_offering_selection_mode": "at_least_one",
		"audience": "open", "is_active": true, "form_schema_id": strconv.FormatInt(schemaID, 10),
	})
	if err != nil {
		return 0, fmt.Errorf("create the enrollment phase of the Demo-Schule Manuell: %w", err)
	}
	return parseEnvelopeStringID(raw)
}

// seedSchoolChangeApproval offers the phase's module and enrolls the child
// with the family of its old contract, approved by the office.
func seedSchoolChangeApproval(rt *Runtime, auth AuthRef, phaseID int64, child seedSchoolChangeChild) (offeringID, requestChildID int64, err error) {
	offering := neighbourOffering("Ganztag bis 16 Uhr", 20, "16:00", demoWeekdays)
	offering.price = 15000
	raw, err := rt.Client.PostWithAuth(auth, "/api/enrollment/care-offerings", careOfferingSeedBody(offering, phaseID))
	if err != nil {
		return 0, 0, fmt.Errorf("create the care offering of the Demo-Schule Manuell: %w", err)
	}
	if offeringID, err = parseEnvelopeStringID(raw); err != nil {
		return 0, 0, err
	}
	raw, err = rt.Client.PostWithAuth(auth, fmt.Sprintf("/api/enrollment/phases/%d/manual-approved-enrollments", phaseID), map[string]any{
		"guardian_first_name": child.party.FirstName, "guardian_last_name": child.party.LastName, "guardian_email": child.party.Email,
		"consent_flags": map[string]bool{"data_processing": true},
		"children": []map[string]any{{
			"first_name": child.firstName, "last_name": child.lastName, "date_of_birth": child.birthDate.String(),
			"target_grade_level": 2, "offering_ids": []int64{offeringID},
		}},
		"reason": "Schulwechsel im laufenden Schuljahr", "external_consent_confirmed": true,
	})
	if err != nil {
		return 0, 0, fmt.Errorf("enroll the child at the Demo-Schule Manuell: %w", err)
	}
	var enrolled struct {
		Data struct {
			ChildID   ident.ID `json:"child_id"`
			StudentID ident.ID `json:"student_id"`
			Status    string   `json:"status"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &enrolled); err != nil {
		return 0, 0, err
	}
	if enrolled.Data.StudentID <= 0 || enrolled.Data.Status != "approved" {
		return 0, 0, fmt.Errorf("the enrollment at the Demo-Schule Manuell gave the child no student record")
	}
	return offeringID, int64(enrolled.Data.ChildID), nil
}

// seedSchoolChangeNewContract gives the offering its contract template and
// concludes the child's contract at the Demo-Schule Manuell on paper.
func seedSchoolChangeNewContract(client *Client, auth AuthRef, school, offering, requestChild int64, party seedSchoolChangeParty) (int64, error) {
	if _, err := client.PutWithAuth(auth, fmt.Sprintf("/traeger/contract-templates/%d/%d", school, offering), seedCareContractTemplate); err != nil {
		return 0, fmt.Errorf("save the contract template of the Demo-Schule Manuell: %w", err)
	}
	raw, err := client.PostWithAuth(auth, "/traeger/contracts/", map[string]any{
		"contracts": []map[string]any{{"school_id": school, "request_child_id": requestChild}},
	})
	if err != nil {
		return 0, fmt.Errorf("create the contract at the Demo-Schule Manuell: %w", err)
	}
	var created struct {
		Data struct {
			Created []struct {
				ID ident.ID `json:"id"`
			} `json:"created"`
			Skipped []json.RawMessage `json:"skipped"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &created); err != nil {
		return 0, err
	}
	if len(created.Data.Created) != 1 {
		return 0, fmt.Errorf("the contract at the Demo-Schule Manuell was not created: %s", created.Data.Skipped)
	}
	id := int64(created.Data.Created[0].ID)
	if err := seedPaperContractSignature(client, auth, id, party.FirstName+" "+party.LastName); err != nil {
		return 0, err
	}
	return id, nil
}

// seedSchoolChangeEnd records the parents' extraordinary termination for
// the change and ends the old contract today, the day before the new one
// begins.
func seedSchoolChangeEnd(client *Client, auth AuthRef, id int64, today calendar.Date) error {
	path := seedNoticePath(id)
	if _, err := client.PostWithAuth(auth, path, map[string]any{
		"kind": "kuendigung", "termination_kind": "ausserordentlich", "received_on": today.String(), "reason": seedSchoolChangeReason,
	}); err != nil {
		return fmt.Errorf("terminate contract %d for the school change: %w", id, err)
	}
	if _, err := client.PutWithAuth(auth, path+"/ends-on", map[string]any{"ends_on": today.String()}); err != nil {
		return fmt.Errorf("end contract %d for the school change: %w", id, err)
	}
	return nil
}
