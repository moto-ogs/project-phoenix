package api

import (
	"context"
	"encoding/json"
	"fmt"
)

const seedHolidayLegalPeriodKey = "traeger.holiday_legal_period"
const seedHolidayLegalPublishedKey = "traeger.holiday_legal_published"

type seedHolidayLegalStep struct{}

func (seedHolidayLegalStep) Name() string { return "Seeding holiday PDF notices and acceptances" }
func (seedHolidayLegalStep) Run(ctx context.Context, rt *Runtime) error {
	period, ok := rt.Values[seedHolidayLegalPeriodKey].(int64)
	if !ok {
		return fmt.Errorf("the seeded holiday period is missing")
	}
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	path := fmt.Sprintf("/traeger/holiday-periods/%d/form", period)
	version, err := seedHolidayLegalForm(rt, auth, path)
	if err != nil {
		return err
	}
	return seedHolidayLegalRegistration(ctx, rt, auth, period, version)
}

func seedHolidayLegalForm(rt *Runtime, auth AuthRef, path string) (int, error) {
	raw, err := rt.Client.GetWithAuth(auth, path)
	if err != nil {
		return 0, err
	}
	var form struct {
		Data struct {
			Version            int             `json:"version"`
			Fields             json.RawMessage `json:"fields"`
			AddressRequirement string          `json:"address_requirement"`
		} `json:"data"`
	}
	if err = json.Unmarshal(raw, &form); err != nil {
		return 0, err
	}
	blocks := []map[string]any{}
	for i, title := range []string{"Hinweise zur Ferienbetreuung", "Hinweise zu Ausflügen"} {
		id, err := seedHolidayLegalPDF(rt, auth, path, i+1, title)
		if err != nil {
			return 0, err
		}
		blocks = append(blocks, map[string]any{"key": fmt.Sprintf("hinweis_%d", i+1), "kind": "terms", "source": "custom", "title": title, "label": "Ich habe die Hinweise gelesen und zur Kenntnis genommen.", "enabled": true, "required": true, "display_mode": "pdf", "attachments": []map[string]string{{"label": title, "document_id": id}}})
	}
	blocks = append(blocks, map[string]any{"key": "fotos_ferien", "kind": "consent", "source": "custom", "title": "Fotos in der Ferienbetreuung", "label": "Mein Kind darf auf Erinnerungsfotos zu sehen sein.", "text": "Die Fotos bleiben in der OGS.", "enabled": true})
	raw, err = rt.Client.PutWithAuth(auth, path, map[string]any{
		// The save carries the version it replaces (ADR 0311).
		"expected_version": form.Data.Version,
		"fields":           form.Data.Fields, "legal_blocks": blocks, "address_requirement": form.Data.AddressRequirement,
		// The last version requires allergies and medication (#6686): the
		// public form shows the questions with „Nein, keine“, the earlier
		// registrations keep their optional version.
		"health_requirement": "required",
	})
	if err != nil {
		return 0, err
	}
	var saved struct {
		Data struct {
			Version int `json:"version"`
		} `json:"data"`
	}
	if err = json.Unmarshal(raw, &saved); err != nil {
		return 0, err
	}
	if saved.Data.Version <= 0 {
		return 0, fmt.Errorf("the saved holiday form has no version")
	}
	return saved.Data.Version, nil
}

func seedHolidayLegalPDF(rt *Runtime, auth AuthRef, path string, position int, title string) (string, error) {
	content := demoPDF(title, []string{"Bitte geben Sie Ihrem Kind eine Trinkflasche mit.", "Bei Fragen hilft Ihnen die OGS."})
	raw, err := rt.Client.uploadFile(auth, "POST", path+"/documents", "document", fmt.Sprintf("hinweis-%d.pdf", position), content, nil)
	if err != nil {
		return "", err
	}
	var doc struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err = json.Unmarshal(raw, &doc); err != nil {
		return "", err
	}
	if doc.Data.ID == "" {
		return "", fmt.Errorf("the seeded holiday PDF has no ID")
	}
	return doc.Data.ID, nil
}

// Older registrations retain version 1 without legal blocks. This later
// registration demonstrates the evidence display of the new version and its
// voluntary consent (#8038): the first seeded parent's account holds it, the
// parent withdraws the photo consent in the parents portal and gives it
// again, and the Träger confirms it, so the hosting school's participant
// list names the consent.
func seedHolidayLegalRegistration(ctx context.Context, rt *Runtime, auth AuthRef, period int64, version int) error {
	if rt.Values[seedHolidayRegistrationsSkippedKey] == true {
		return nil
	}
	published, ok := rt.Values[seedHolidayLegalPublishedKey].([]byte)
	if !ok {
		return fmt.Errorf("the published holiday offer is missing")
	}
	token, body, err := seedHolidayLegalBody(published, rt.Bootstrap.SchoolID, version)
	if err != nil {
		return err
	}
	parent, err := seedHolidayConsentParent(ctx, rt, token, body)
	if err != nil {
		return err
	}
	raw, err := rt.Client.PostPublic("/traeger/holiday-registrations/"+token, body)
	if err != nil {
		return err
	}
	registration, err := decodeSeedEntityID(raw)
	if err != nil {
		return fmt.Errorf("read the holiday registration with notices: %w", err)
	}
	if parent != nil {
		if err := seedHolidayConsentChange(rt, *parent, registration); err != nil {
			return err
		}
	}
	if err := postReadHolidayConfirmation(rt, auth, period, registration, map[string]any{"benefits_exemption": false, "debtor_number": "47040"}); err != nil {
		return fmt.Errorf("confirm the holiday registration with notices: %w", err)
	}
	return nil
}

// seedHolidayLegalBody is the registration of the version with notices: both
// notices and the photo consent accepted, and "Keine" for the health fields
// the version requires (#6686).
func seedHolidayLegalBody(published []byte, schoolID int64, version int) (string, map[string]any, error) {
	token, body, err := seedHolidayRegistration(published, schoolID)
	if err != nil {
		return "", nil, err
	}
	body["guardian"].(map[string]any)["email"] = "hinweise.ferien@example.org"
	for _, child := range body["children"].([]map[string]any) {
		for _, field := range []string{"allergies", "medication"} {
			if value, _ := child[field].(string); value == "" {
				child[field] = "Keine"
			}
		}
	}
	body["legal_acceptances"] = map[string]bool{"hinweis_1": true, "hinweis_2": true, seedHolidayPhotoConsentKey: true}
	body["form_version"] = version
	return token, body, nil
}
