package api

import (
	"context"
	"fmt"
)

// seedGemeindeBillingStep lets the Gemeinde of the Demo-Schule Manuell bill
// its school itself (#8040, ADR 0321): its own creditor identifier, its own
// account and number ranges of its own. The page „Zuständigkeiten“ then
// shows its checklist, the open runs of the Demo-Schule Manuell name it as
// the issuer, and the next released run gives it a direct debit file of its
// own. The seeded school keeps the Träger as its issuer, so every invoice
// seeded before stays as it is. The family of the child that changed its
// school still needs a mandate for the Gemeinde: the checklist names it.
type seedGemeindeBillingStep struct{}

func (seedGemeindeBillingStep) Name() string { return "Seeding a Gemeinde that bills its school" }

// seedBillingGemeinde is the invented Gemeinde of the Demo-Schule Manuell,
// with a creditor identifier and an account of its own.
var seedBillingGemeinde = map[string]any{
	"name": "Gemeinde Wallenhorst", "street": "Rathausallee 1", "postal_code": "49134", "city": "Wallenhorst",
	"contact_name": "Jana Lindemann", "contact_phone": "+49 5407 888-0", "contact_email": "elternbeitraege@wallenhorst.example.test",
	"creditor_id": seedBillingGemeindeCreditor, "account_holder": "Gemeindekasse Wallenhorst",
	"iban": "DE93 3705 0198 1234 5678 90", "bic": "COLSDE33XXX", "bank_name": "Sparkasse KölnBonn",
	"expected_version": "",
}

const seedBillingGemeindeCreditor = "DE15ZZZ00000067890"

// The number patterns of the Gemeinde: a short code of its own, apart from
// the Träger's.
var seedBillingGemeindeRanges = map[string]string{"holiday": "WH-F-{JJJJ}-{NNNN}", "care": "WH-B-{JJJJ}-{NNNN}"}

func (seedGemeindeBillingStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil || rt.Bootstrap.AdminEmail == "" || rt.Bootstrap.AdminPassword == "" {
		return fmt.Errorf("the Gemeinde billing seed prerequisites are not available")
	}
	manual := rt.AdditionalProfiles[ManualProfileKey]
	if manual == nil || manual.Organization.ID != rt.Bootstrap.OrganizationID {
		fmt.Println("  Gemeinde billing: no second school of the Träger; the Träger bills every school")
		return nil
	}
	school := int64(manual.School.ID)
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	stored, err := seedSchoolHasGemeinde(rt.Client, auth, school)
	if err != nil {
		return err
	}
	if !stored {
		path := fmt.Sprintf("/traeger/master-data/responsibilities/schools/%d/parties/gemeinde", school)
		if _, err := rt.Client.PutWithAuth(auth, path, seedBillingGemeinde); err != nil {
			return fmt.Errorf("store the Gemeinde of school %d: %w", school, err)
		}
	}
	path := fmt.Sprintf("/operator/schools/%d/settings/values/%s", school, "responsibility.billing")
	if _, err := rt.Client.PutWithAuth(rt.OperatorAuth, path, map[string]any{"value": "gemeinde"}); err != nil {
		return fmt.Errorf("let the Gemeinde bill school %d: %w", school, err)
	}
	for _, service := range []string{"holiday", "care"} {
		body := map[string]any{"pattern": seedBillingGemeindeRanges[service], "issuer_key": seedBillingGemeindeCreditor}
		if _, err := rt.Client.PutWithAuth(auth, "/traeger/number-ranges/"+service, body); err != nil {
			return fmt.Errorf("set the %s number range of the Gemeinde: %w", service, err)
		}
	}
	fmt.Println("  Gemeinde billing: the Gemeinde bills the Demo-Schule Manuell with its own creditor identifier")
	return nil
}
