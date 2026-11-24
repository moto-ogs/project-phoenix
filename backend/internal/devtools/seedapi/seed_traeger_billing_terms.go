package api

import (
	"encoding/json"
	"fmt"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedBillingTerms gives the demo Träger who gets an invoice, how it is paid
// and by when (#4689) through the Träger routes, before the monthly run is
// released: the SJR pattern of the monthly care by direct debit and the
// holiday care by transfer, the run's due date per payment method (2nd and
// 4th of the month after), and two families that deviate: one invoice goes
// to another payer, one to both parents with its own due day. It returns the
// contracts whose families got their debtor number.
func seedBillingTerms(client *Client, auth AuthRef, runID int64, month calendar.Date) (map[ident.ID]bool, error) {
	versions, err := serviceTermsVersions(client, auth)
	if err != nil {
		return nil, err
	}
	for service, terms := range map[string]map[string]any{
		"care":    {"payment_method": "direct_debit", "due_days": 10},
		"meal":    {"payment_method": "direct_debit", "due_days": 10, "bundle_with": "care"},
		"holiday": {"payment_method": "transfer", "due_days": 14},
	} {
		terms["expected_version"] = versions[service]
		if _, err := client.PutWithAuth(auth, "/traeger/billing-terms/"+service, terms); err != nil {
			return nil, fmt.Errorf("keep the payment terms of %s: %w", service, err)
		}
	}
	// The run names its invoices and the version of its due dates, which
	// their change sends back (ADR 0311); the dates change no invoice.
	raw, err := client.GetWithAuth(auth, fmt.Sprintf("/traeger/care-billing-runs/%d", runID))
	if err != nil {
		return nil, fmt.Errorf("read the monthly run: %w", err)
	}
	run, err := seedReadData[struct {
		Invoices        []seedRunInvoice `json:"invoices"`
		DueDatesVersion string           `json:"due_dates_version"`
	}](raw, "monthly run")
	if err != nil {
		return nil, err
	}
	next := calendar.NewDate(month.Year(), month.Month(), 1).AddDays(32)
	if _, err := client.PutWithAuth(auth, fmt.Sprintf("/traeger/billing-run-due-dates/care/%d", runID), map[string]any{
		"expected_version": run.DueDatesVersion,
		"due_dates": []map[string]any{
			{"payment_method": "transfer", "due_on": calendar.NewDate(next.Year(), next.Month(), 2).String()},
			{"payment_method": "direct_debit", "due_on": calendar.NewDate(next.Year(), next.Month(), 4).String()},
		},
	}); err != nil {
		return nil, fmt.Errorf("keep the due dates of the monthly run: %w", err)
	}
	invoices := run.Invoices
	if err := seedFamilyBilling(client, auth, invoices); err != nil {
		return nil, err
	}
	numbered := make(map[ident.ID]bool, len(invoices))
	for _, invoice := range invoices {
		numbered[invoice.ContractID] = true
	}
	return numbered, seedSEPAMandates(client, auth, invoices)
}

// serviceTermsVersions reads per service the version of its terms, which a
// change sends back (ADR 0311).
func serviceTermsVersions(client *Client, auth AuthRef) (map[string]string, error) {
	raw, err := client.GetWithAuth(auth, "/traeger/billing-terms/")
	if err != nil {
		return nil, fmt.Errorf("read the payment terms: %w", err)
	}
	read, err := seedReadData[struct {
		Terms []struct {
			Service string `json:"service"`
			Version string `json:"version"`
		} `json:"terms"`
	}](raw, "payment terms")
	if err != nil {
		return nil, err
	}
	versions := make(map[string]string, len(read.Terms))
	for _, terms := range read.Terms {
		versions[terms.Service] = terms.Version
	}
	return versions, nil
}

// seedRunInvoice is an invoice of the monthly run as the seed reads it.
type seedRunInvoice = struct {
	ContractID  ident.ID `json:"contract_id"`
	FamilyEmail string   `json:"family_email"`
	Recipient   struct {
		LastName string `json:"last_name"`
	} `json:"recipient"`
}

// seedFamilyBilling keeps the deviations of two families (one invoice to
// another payer, one to both parents with its own due day) and gives every
// family its debtor number (#4693), so the DATEV file of the run takes each
// invoice (#6433).
func seedFamilyBilling(client *Client, auth AuthRef, invoices []seedRunInvoice) error {
	deviations := []map[string]any{
		{"recipient_kind": "payer", "payer_first_name": "Helga", "payer_last_name": "Großmann", "payer_email": "helga.grossmann@example.org",
			"payer_address":  map[string]any{"street": "Lindenweg 4", "postal_code": "75175", "city": "Pforzheim"},
			"payment_method": "transfer"},
		{"recipient_kind": "both", "second_first_name": "Jonas", "due_day": 15},
	}
	for i := len(deviations); i < len(invoices); i++ {
		deviations = append(deviations, map[string]any{"recipient_kind": "applicant"})
	}
	for i, deviation := range deviations {
		if i >= len(invoices) {
			break
		}
		deviation["contract_id"] = invoices[i].ContractID
		deviation["debtor_number"] = seedDebtorNumber(i)
		if deviation["recipient_kind"] == "both" {
			deviation["second_last_name"] = invoices[i].Recipient.LastName
		}
		version, err := familyBillingVersion(client, auth, invoices[i].ContractID)
		if err != nil {
			return err
		}
		deviation["expected_version"] = version
		if _, err := client.PutWithAuth(auth, "/traeger/family-billing/", deviation); err != nil {
			return fmt.Errorf("keep the deviation of a family: %w", err)
		}
	}
	return nil
}

// familyBillingVersion reads the version of the deviation of a contract's
// family, which its save sends back (ADR 0311).
func familyBillingVersion(client *Client, auth AuthRef, contractID ident.ID) (string, error) {
	raw, err := client.GetWithAuth(auth, fmt.Sprintf("/traeger/family-billing/contracts/%s", contractID))
	if err != nil {
		return "", fmt.Errorf("read the deviation of a family: %w", err)
	}
	var envelope struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return "", fmt.Errorf("read the deviation of a family: %w", err)
	}
	return envelope.Data.Version, nil
}

// seedLateDebtorNumbers gives the families of the invoices that joined the
// preview after seedBillingTerms read it their debtor number: the
// contract-conclusion worker concludes contracts on its own tick, 70 s after
// the server starts. Without the number the released invoice lacks its
// DATEV account and the DATEV file of the run is refused (#6433). It reports
// whether it changed a family, which changes the preview again.
func seedLateDebtorNumbers(client *Client, auth AuthRef, contracts []ident.ID, numbered map[ident.ID]bool) (bool, error) {
	changed := false
	for _, contractID := range contracts {
		if numbered[contractID] {
			continue
		}
		version, err := familyBillingVersion(client, auth, contractID)
		if err != nil {
			return changed, err
		}
		if _, err := client.PutWithAuth(auth, "/traeger/family-billing/", map[string]any{
			"contract_id": contractID, "recipient_kind": "applicant", "debtor_number": seedDebtorNumber(len(numbered)),
			"expected_version": version,
		}); err != nil {
			return changed, fmt.Errorf("keep the debtor number of a late family: %w", err)
		}
		numbered[contractID] = true
		changed = true
	}
	return changed, nil
}

// seedSEPACreditor keeps the Bundesbank's test identifier as the creditor,
// on the creditor it read (ADR 0311).
func seedSEPACreditor(client *Client, auth AuthRef) error {
	raw, err := client.GetWithAuth(auth, "/traeger/sepa-creditor/")
	if err != nil {
		return fmt.Errorf("read the SEPA creditor: %w", err)
	}
	creditor, err := seedReadData[struct {
		Version string `json:"version"`
	}](raw, "SEPA creditor")
	if err != nil {
		return err
	}
	if _, err := client.PutWithAuth(auth, "/traeger/sepa-creditor/", map[string]any{
		"creditor_id": "DE98ZZZ09999999999", "prenotification_days": 5, "missing_mandate": "transfer",
		"expected_version": creditor.Version,
	}); err != nil {
		return fmt.Errorf("keep the SEPA creditor: %w", err)
	}
	return nil
}

// seedSEPAMandates gives the demo Träger its creditor identifier (the
// Bundesbank's test identifier) and the SEPA mandates of the families that
// pay by direct debit (#4695): one family's first mandate was revoked and
// replaced, one family has none, so the review shows its hint and the
// invoice goes as a transfer. The first family pays by transfer anyway.
func seedSEPAMandates(client *Client, auth AuthRef, invoices []seedRunInvoice) error {
	if err := seedSEPACreditor(client, auth); err != nil {
		return err
	}
	// Every monthly run seeds its families again: a family that has a
	// mandate already keeps it (the backend answers in force or reference
	// taken), and siblings share one.
	seeded := map[string]bool{}
	for i, invoice := range invoices {
		if i == 0 || i == 2 || seeded[invoice.FamilyEmail] {
			continue
		}
		seeded[invoice.FamilyEmail] = true
		mandate := map[string]any{
			"contract_id": invoice.ContractID, "reference": fmt.Sprintf("SJR-2026-%04d", invoice.ContractID), "signed_on": "2026-09-01",
			"kind": "recurring", "sequence": "recurring", "account_holder": "Familie " + invoice.Recipient.LastName,
			"iban": demoIBAN(9000 + i),
		}
		raw, err := client.PostWithAuth(auth, "/traeger/sepa-mandates/", mandate)
		if seedConflictCode(err, seedMandateInForce) || seedConflictCode(err, seedMandateReferenceTaken) {
			continue
		}
		if err != nil {
			return fmt.Errorf("keep the SEPA mandate of a family: %w", err)
		}
		if i == 1 {
			if err := seedReplacedMandate(client, auth, raw, mandate, int64(invoice.ContractID)); err != nil {
				return err
			}
		}
	}
	return seedImportedMandates(client, auth, invoices)
}

// seedImportedMandates imports the mandate of the first family, if any.
func seedImportedMandates(client *Client, auth AuthRef, invoices []struct {
	ContractID  ident.ID `json:"contract_id"`
	FamilyEmail string   `json:"family_email"`
	Recipient   struct {
		LastName string `json:"last_name"`
	} `json:"recipient"`
}) error {
	if len(invoices) == 0 {
		return nil
	}
	return seedImportedMandate(client, auth, invoices[0].FamilyEmail, invoices[0].Recipient.LastName)
}

// seedImportedMandate takes over the mandate of the first family from a CSV
// export of another program (#6198), so the demo shows the import log and a
// mandate with the origin "import". The family pays by transfer anyway. A
// repeated seed finds the mandate again and takes over nothing.
func seedImportedMandate(client *Client, auth AuthRef, familyEmail, lastName string) error {
	csv := "Mandatsreferenz;Unterschriftsdatum;IBAN;Kontoinhaber;E-Mail;Lastschriftart;Letzter Einzug\r\n" +
		fmt.Sprintf("OGS-2024-0001;15.08.2024;%s;Familie %s;%s;Folgelastschrift;01.10.2026\r\n", demoIBAN(9200), lastName, familyEmail)
	mapping := `{"columns":{"reference":"Mandatsreferenz","signed_on":"Unterschriftsdatum","iban":"IBAN","bic":"",` +
		`"account_holder":"Kontoinhaber","payer":"E-Mail","creditor_id":"","sequence":"Lastschriftart",` +
		`"last_collected_on":"Letzter Einzug"},"payer_key":"email","creditor_from_traeger":true,` +
		`"confirmed_creditor_id":"DE98ZZZ09999999999"}`
	// Like the office: preview first, then take over what the preview showed.
	raw, err := client.PostFileWithAuthFields(auth, "/traeger/sepa-mandates/imports/preview", "file", "ogs-connect-mandate.csv",
		[]byte(csv), map[string]string{"mapping": mapping})
	if err != nil {
		return fmt.Errorf("preview the import of a SEPA mandate: %w", err)
	}
	var preview struct {
		Data struct {
			Fingerprint string `json:"fingerprint"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &preview); err != nil {
		return fmt.Errorf("read the import preview: %w", err)
	}
	if _, err := client.PostFileWithAuthFields(auth, "/traeger/sepa-mandates/imports", "file", "ogs-connect-mandate.csv",
		[]byte(csv), map[string]string{"mapping": mapping, "fingerprint": preview.Data.Fingerprint}); err != nil {
		return fmt.Errorf("import the SEPA mandate of a family: %w", err)
	}
	return nil
}

// The refusals of a mandate a repeated seed meets (#4695).
const (
	seedMandateInForce        = "parent_billing.sepa_mandate_in_force"
	seedMandateReferenceTaken = "parent_billing.sepa_mandate_reference_taken"
)

// seedReplacedMandate revokes the mandate just created and gives the family a
// new one with another account, so the demo shows a mandate's history.
func seedReplacedMandate(client *Client, auth AuthRef, raw []byte, mandate map[string]any, contractID int64) error {
	var created struct {
		Data struct {
			ID ident.ID `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &created); err != nil {
		return fmt.Errorf("read the SEPA mandate: %w", err)
	}
	if _, err := client.PostWithAuth(auth, fmt.Sprintf("/traeger/sepa-mandates/%d/revoke", created.Data.ID),
		map[string]any{"revoked_on": "2026-10-01"}); err != nil {
		return fmt.Errorf("revoke the SEPA mandate of a family: %w", err)
	}
	mandate["reference"], mandate["signed_on"], mandate["sequence"] = fmt.Sprintf("SJR-2026-%04d-2", contractID), "2026-10-02", "first"
	mandate["iban"] = demoIBAN(9101)
	if _, err := client.PostWithAuth(auth, "/traeger/sepa-mandates/", mandate); err != nil {
		return fmt.Errorf("keep the new SEPA mandate of a family: %w", err)
	}
	return nil
}
