package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/demoprofile"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// seedTraegerStaffProofStep seeds the Nachweise of the Personalstamm
// (#4707) through the routes of the Personalverwaltung: an own kind besides
// the standard list, a proof mix over the seeded records so the list shows
// every status (expired, expiring, missing, valid), and the mapping of each
// school's certificate of conduct onto the Träger's. The days count back
// from the seed day, so the mix holds on every dev machine. Several demo
// schools seed the same Träger; a kind another run created is no error.
type seedTraegerStaffProofStep struct{}

func (seedTraegerStaffProofStep) Name() string {
	return "Seeding the Nachweise of the Träger staff records"
}

const (
	seedCodeProofTypeNameTaken = "workforce.traeger_proof_type_name_taken"
	seedOwnProofKind           = "Belehrung nach § 43 IfSG"
)

type seedProofKind struct {
	ID          demoprofile.ID `json:"id"`
	StandardKey string         `json:"standard_key"`
	Name        string         `json:"name"`
}

// seedProofPlan is the proof mix of one record: days back from today for
// the certificate of conduct's issue day (0 = none), whether the measles
// protection and the prevention training were presented.
type seedProofPlan struct {
	policeIssuedDaysAgo int
	measles             bool
	prevention          bool
}

// seedProofPlans cycle over the records: one certificate runs into its
// twelve-week lead, one is expired, one person lacks the measles
// protection, the others are complete.
var seedProofPlans = []seedProofPlan{
	{policeIssuedDaysAgo: 5*365 - 30, measles: true},
	{policeIssuedDaysAgo: 5*365 + 12, measles: true, prevention: true},
	{policeIssuedDaysAgo: 300},
	{policeIssuedDaysAgo: 700, measles: true, prevention: true},
	{policeIssuedDaysAgo: 0, measles: true},
	{policeIssuedDaysAgo: 120, measles: true, prevention: true},
}

func (seedTraegerStaffProofStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil || rt.Bootstrap.OrganizationID <= 0 {
		return fmt.Errorf("the Träger proof seed prerequisites are not available")
	}
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	_, err = rt.Client.PostWithAuth(auth, "/traeger/staff-proofs/types", map[string]any{"name": seedOwnProofKind, "validity_months": 24, "reminder_lead_weeks": 4})
	var refused *APIError
	if err != nil && (!errors.As(err, &refused) || refused.Code != seedCodeProofTypeNameTaken) {
		return fmt.Errorf("create a Träger proof kind: %w", err)
	}
	kinds, err := seedProofKinds(rt.Client, auth)
	if err != nil {
		return err
	}
	records, err := seedTraegerStaffRecordIDs(rt.Client, auth)
	if err != nil {
		return err
	}
	today := calendar.TodayDate()
	for i, record := range records {
		if err := seedRecordProofs(rt.Client, auth, record, kinds, seedProofPlans[i%len(seedProofPlans)], today); err != nil {
			return err
		}
	}
	if err := seedMapSchoolProofKinds(rt.Client, auth, kinds["police_certificate"]); err != nil {
		return err
	}
	fmt.Printf("  Träger Nachweise: %d records\n", len(records))
	return nil
}

func seedProofKinds(client *Client, auth AuthRef) (map[string]int64, error) {
	raw, err := client.GetWithAuth(auth, "/traeger/staff-proofs/types")
	if err != nil {
		return nil, fmt.Errorf("read the Träger proof kinds: %w", err)
	}
	var list []seedProofKind
	if err := seedDataList(raw, &list); err != nil {
		return nil, fmt.Errorf("decode the Träger proof kinds: %w", err)
	}
	kinds := map[string]int64{}
	for _, kind := range list {
		key := kind.StandardKey
		if key == "" {
			key = kind.Name
		}
		kinds[key] = int64(kind.ID)
	}
	return kinds, nil
}

func seedTraegerStaffRecordIDs(client *Client, auth AuthRef) ([]int64, error) {
	raw, err := client.GetWithAuth(auth, "/traeger/staff-records/")
	if err != nil {
		return nil, fmt.Errorf("read the Träger staff records: %w", err)
	}
	var envelope struct {
		Data struct {
			Records []struct {
				ID demoprofile.ID `json:"id"`
			} `json:"records"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("decode the Träger staff records: %w", err)
	}
	ids := make([]int64, 0, len(envelope.Data.Records))
	for _, record := range envelope.Data.Records {
		ids = append(ids, int64(record.ID))
	}
	return ids, nil
}

func seedRecordProofs(client *Client, auth AuthRef, record int64, kinds map[string]int64, plan seedProofPlan, today calendar.Date) error {
	save := func(kind int64, body map[string]any) error {
		if kind <= 0 {
			return nil
		}
		if _, err := client.PutWithAuth(auth, fmt.Sprintf("/traeger/staff-proofs/records/%d/%d", record, kind), body); err != nil {
			return fmt.Errorf("record a Träger proof: %w", err)
		}
		return nil
	}
	if plan.policeIssuedDaysAgo > 0 {
		issued := today.AddDays(-plan.policeIssuedDaysAgo)
		if err := save(kinds["police_certificate"], map[string]any{
			"issued_on": issued.String(), "presented_on": issued.AddDays(9).String(), "no_relevant_entry": true,
		}); err != nil {
			return err
		}
	}
	if plan.measles {
		if err := save(kinds["measles_protection"], map[string]any{"presented_on": today.AddDays(-410).String()}); err != nil {
			return err
		}
	}
	if plan.prevention {
		if err := save(kinds["prevention_training"], map[string]any{"presented_on": today.AddDays(-200).String()}); err != nil {
			return err
		}
	}
	return save(kinds[seedOwnProofKind], map[string]any{"presented_on": today.AddDays(-60).String()})
}

// seedMapSchoolProofKinds maps the certificate of conduct of every school
// onto the Träger's, so a person the Träger keeps is reminded once.
func seedMapSchoolProofKinds(client *Client, auth AuthRef, police int64) error {
	if police <= 0 {
		return nil
	}
	raw, err := client.GetWithAuth(auth, "/traeger/staff-proofs/school-kinds")
	if err != nil {
		return fmt.Errorf("read the school proof kinds: %w", err)
	}
	var schools []struct {
		SchoolID demoprofile.ID `json:"school_id"`
		Kinds    []struct {
			SchoolTypeID demoprofile.ID `json:"school_type_id"`
			Name         string         `json:"name"`
		} `json:"kinds"`
	}
	if err := seedDataList(raw, &schools); err != nil {
		return fmt.Errorf("decode the school proof kinds: %w", err)
	}
	for _, school := range schools {
		for _, kind := range school.Kinds {
			if kind.Name != "Erweitertes Führungszeugnis" {
				continue
			}
			if _, err := client.PutWithAuth(auth, "/traeger/staff-proofs/school-kinds", map[string]any{
				"school_id": school.SchoolID, "school_type_id": kind.SchoolTypeID, "proof_type_id": police,
			}); err != nil {
				return fmt.Errorf("map a school proof kind: %w", err)
			}
		}
	}
	return nil
}

// seedDataList decodes the list in the envelope's data; data that is no
// list (a route of an older backend or a test double) is an empty list.
func seedDataList(raw []byte, list any) error {
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return err
	}
	if len(envelope.Data) == 0 || envelope.Data[0] != '[' {
		return nil
	}
	return json.Unmarshal(envelope.Data, list)
}
