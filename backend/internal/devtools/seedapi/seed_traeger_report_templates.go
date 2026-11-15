package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// seedTraegerReportTemplatesStep gives the demo Träger the two report
// templates of #4716 (ADR 0246) through the Träger routes, the way the
// Träger-Büro writes them: the report for the Jugendamt on 15 October with
// every section and its schools in two Sozialräume, and the report for the
// Kommune with children and demand only. The page "Berichte" then offers
// both next to the standard report.
type seedTraegerReportTemplatesStep struct{}

func (seedTraegerReportTemplatesStep) Name() string { return "Seeding the Träger report templates" }

// The Sozialräume the Jugendamt template divides the schools into, in turn.
var seedTraegerReportDistricts = []string{"Nord", "Süd"}

// seedTraegerReportTemplates are the templates of the demo Träger; the
// districts of the first are filled from the Träger's schools.
func seedTraegerReportTemplates(schools []int64) []map[string]any {
	districts := make([]map[string]any, 0, len(schools))
	for i, school := range schools {
		districts = append(districts, map[string]any{"school_id": school, "district": seedTraegerReportDistricts[i%len(seedTraegerReportDistricts)]})
	}
	return []map[string]any{
		{
			"name": "Jugendamt Stichtag 15.10.", "sections": []string{"children", "staff", "absences", "demand"},
			"key_date_month": 10, "key_date_day": 15, "districts": districts,
		},
		{
			"name": "Kommune Belegung und Nachfrage", "sections": []string{"children", "demand"},
			"key_date_month": 3, "key_date_day": 1, "districts": []map[string]any{},
		},
	}
}

// seedTraegerReportTemplateNameTaken is the registered code of a template
// name the Träger already has.
const seedTraegerReportTemplateNameTaken = "traeger.report_template_name_taken"

func (seedTraegerReportTemplatesStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil || rt.Bootstrap.AdminEmail == "" || rt.Bootstrap.AdminPassword == "" {
		return fmt.Errorf("the Träger report template seed prerequisites are not available")
	}
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	schools, err := seedTraegerSchoolIDs(rt.Client, auth)
	if err != nil {
		return err
	}
	existing, err := seedTraegerReportTemplateNames(rt.Client, auth)
	if err != nil {
		return err
	}
	// Every demo school of one database hangs under the same Demo-Träger and
	// several seed at once: a name another school saved meanwhile is kept.
	for _, template := range seedTraegerReportTemplates(schools) {
		if existing[template["name"].(string)] {
			continue
		}
		_, err := rt.Client.PostWithAuth(auth, "/traeger/report-templates/", template)
		var refused *APIError
		if errors.As(err, &refused) && refused.Code == seedTraegerReportTemplateNameTaken {
			continue
		}
		if err != nil {
			return fmt.Errorf("add the Träger report template %s: %w", template["name"], err)
		}
	}
	fmt.Println("  Träger report templates: Jugendamt with two Sozialräume and Kommune")
	return nil
}

func seedTraegerReportTemplateNames(client *Client, auth AuthRef) (map[string]bool, error) {
	raw, err := client.GetWithAuth(auth, "/traeger/report-templates/")
	if err != nil {
		return nil, fmt.Errorf("list the Träger report templates: %w", err)
	}
	var envelope struct {
		Data []struct {
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("read the Träger report templates: %w", err)
	}
	names := make(map[string]bool, len(envelope.Data))
	for _, template := range envelope.Data {
		names[template.Name] = true
	}
	return names, nil
}
