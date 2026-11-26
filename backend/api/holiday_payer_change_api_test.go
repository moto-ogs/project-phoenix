// Router-level tests for the payer of a confirmed holiday registration
// (#8158, ADR 0325): the Träger-Büro changes who pays after the
// confirmation, sees the effect per child before it saves, and the open run,
// the issued invoice and the reimbursement list of the cost bearer stay
// consistent.
package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
)

type payerBody struct {
	Kind           string  `json:"kind"`
	CostBearerID   *wireID `json:"cost_bearer_id"`
	CostBearerName string  `json:"cost_bearer_name"`
}

type payerPreviewBody struct {
	Current  payerBody `json:"current"`
	Chosen   payerBody `json:"chosen"`
	Changed  bool      `json:"changed"`
	Children []struct {
		ChildID               wireID `json:"child_id"`
		FamilyBeforeCents     int64  `json:"family_before_cents"`
		FamilyAfterCents      int64  `json:"family_after_cents"`
		CostBearerBeforeCents int64  `json:"cost_bearer_before_cents"`
		CostBearerAfterCents  int64  `json:"cost_bearer_after_cents"`
	} `json:"children"`
	ExemptionAvailable bool   `json:"exemption_available"`
	Invoiced           bool   `json:"invoiced"`
	Fingerprint        string `json:"fingerprint"`
}

func holidayPayerPath(periodID, registrationID int64) string {
	return holidayContributionPath(periodID, registrationID) + "/payer"
}

func (f reviewFixture) payerPreview(t *testing.T, token string, id int64, query string) *httptest.ResponseRecorder {
	t.Helper()
	return traegerJSON(t, f.traeger, token, http.MethodGet, holidayPayerPath(int64(f.period.ID), id)+query, nil)
}

func payerQuery(body map[string]any) string {
	if id, ok := body["cost_bearer_id"]; ok {
		return fmt.Sprintf("?cost_bearer_id=%v", id)
	}
	if body["benefits_exemption"] == true {
		return "?benefits_exemption=true"
	}
	return ""
}

// changePayer saves the payer of body over the preview it reads first, as
// the registration page does (ADR 0311).
func (f reviewFixture) changePayer(t *testing.T, id int64, body map[string]any, reason string) *httptest.ResponseRecorder {
	t.Helper()
	rec := f.payerPreview(t, f.office.token, id, payerQuery(body))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	sent := map[string]any{"reason": reason, "expected_fingerprint": decodeSchoolPortalData[payerPreviewBody](t, rec.Body.Bytes()).Fingerprint}
	for key, value := range body {
		sent[key] = value
	}
	return traegerJSON(t, f.traeger, f.office.token, http.MethodPut, holidayPayerPath(int64(f.period.ID), id), sent)
}

// payerEffects renders the effect per child as
// "family before>after bearer before>after".
func payerEffects(preview payerPreviewBody) []string {
	effects := make([]string, len(preview.Children))
	for i, child := range preview.Children {
		effects[i] = fmt.Sprintf("family %d>%d bearer %d>%d", child.FamilyBeforeCents, child.FamilyAfterCents,
			child.CostBearerBeforeCents, child.CostBearerAfterCents)
	}
	return effects
}

func (f reviewFixture) payerHistory(t *testing.T, id int64) []map[string]any {
	t.Helper()
	var entries []map[string]any
	for _, event := range f.debtorNumberDetail(t, id).History {
		if event.Action == "payer" {
			entries = append(entries, event.Details)
		}
	}
	return entries
}

// TestPayerOfAConfirmedRegistrationChangesWithItsContribution is the case of
// the issue: two siblings are confirmed as paid by the family, the notice on
// benefits comes later. Lia (67,50 €) is the second child and pays half, Ben
// pays 90,00 €.
func TestPayerOfAConfirmedRegistrationChangesWithItsContribution(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Zahlerwechsel")
	billing := traegerColleague(t, f, identityaccess.TraegerRoleBilling)
	foreign := newTraegerOffice(t, f.db, f.traeger, "Träger Zahlerwechsel Fremd", identityaccess.TraegerRoleAdministration)
	createContributionRule(t, f, billing, siblingHalf())
	createContributionRule(t, f, billing, benefitsExemption())
	office := createCostBearer(t, f, billing, youthOffice())
	takeover := map[string]any{"cost_bearer_id": fmt.Sprint(office.ID)}

	// A received registration chooses its payer at the confirmation.
	rec := f.payerPreview(t, f.office.token, f.siblings, payerQuery(takeover))
	assertRefusedWith(t, rec, http.StatusConflict, "enrollment.holiday_registration_state_conflict")
	require.Equal(t, http.StatusOK, f.confirmWith(t, f.siblings, map[string]any{"benefits_exemption": false}).Code)
	assert.Equal(t, int64(12375), f.contribution(t, f.siblings).TotalCents)

	// The family brings the notice after the confirmation: the office
	// uploads it and changes the payer of the confirmed registration.
	proof := uploadOfficeProof(t, f, f.office.token, f.siblings, "bescheid.pdf", proofPDF)
	require.Equal(t, http.StatusCreated, proof.Code, proof.Body.String())
	rec = f.payerPreview(t, f.office.token, f.siblings, payerQuery(takeover))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	preview := decodeSchoolPortalData[payerPreviewBody](t, rec.Body.Bytes())
	assert.Equal(t, "family", preview.Current.Kind)
	assert.Equal(t, "cost_bearer", preview.Chosen.Kind)
	assert.Equal(t, office.Name, preview.Chosen.CostBearerName)
	assert.True(t, preview.Changed)
	assert.True(t, preview.ExemptionAvailable)
	assert.False(t, preview.Invoiced)
	assert.Equal(t, []string{"family 3375>0 bearer 0>3375", "family 9000>0 bearer 0>9000"}, payerEffects(preview),
		"the cost bearer pays what is left after the sibling discount")
	assert.Equal(t, int64(12375), f.contribution(t, f.siblings).TotalCents, "the preview stores nothing")

	path := holidayPayerPath(int64(f.period.ID), f.siblings)
	saved := map[string]any{"cost_bearer_id": fmt.Sprint(office.ID), "reason": "Bescheid nachgereicht", "expected_fingerprint": preview.Fingerprint}
	for name, refused := range map[string]struct {
		change map[string]any
		status int
		code   string
	}{
		"no reason":              {map[string]any{"reason": " "}, http.StatusBadRequest, "general.input"},
		"a reason of 501 signs":  {map[string]any{"reason": strings.Repeat("a", 501)}, http.StatusBadRequest, "general.input"},
		"an older preview":       {map[string]any{"expected_fingerprint": "another-preview"}, http.StatusConflict, "general.changed_since_read"},
		"no preview":             {map[string]any{"expected_fingerprint": ""}, http.StatusConflict, "general.changed_since_read"},
		"exemption and takeover": {map[string]any{"benefits_exemption": true}, http.StatusConflict, "parent_billing.cost_takeover_with_exemption"},
	} {
		body := map[string]any{}
		for key, value := range saved {
			body[key] = value
		}
		for key, value := range refused.change {
			body[key] = value
		}
		rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, path, body)
		require.Equal(t, refused.status, rec.Code, "%s: %s", name, rec.Body.String())
		assert.Equal(t, refused.code, refusalCode(t, rec), name)
	}
	// The right "Anmeldung verwalten" changes the payer, and only of the
	// own Träger.
	rec = traegerJSON(t, f.traeger, billing, http.MethodPut, path, saved)
	assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
	rec = traegerJSON(t, f.traeger, foreign.token, http.MethodPut, path, saved)
	assert.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
	assert.Equal(t, http.StatusNotFound, f.payerPreview(t, foreign.token, f.siblings, "").Code)
	assert.Equal(t, []int64{12375}, f.contributionVersions(t, f.siblings), "every refusal was rolled back")
	assert.Empty(t, f.payerHistory(t, f.siblings))

	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, path, saved)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	frozen := decodeSchoolPortalData[takeoverContributionBody](t, rec.Body.Bytes())
	assert.True(t, frozen.Frozen)
	assert.Equal(t, int64(0), frozen.TotalCents, "the family pays nothing")
	require.NotNil(t, frozen.CostBearerID)
	assert.Equal(t, office.ID, *frozen.CostBearerID)
	assert.Equal(t, []string{"base:6750", "sibling:-3375", "cost_takeover:-3375"}, lineKinds(f.contribution(t, f.siblings).Children[0].Lines))
	assert.Equal(t, []int64{12375, 0}, f.contributionVersions(t, f.siblings), "the change is a new version; the old one stays")
	assert.Equal(t, "confirmed", f.debtorNumberDetail(t, f.siblings).Status, "the registration stays confirmed")
	history := f.payerHistory(t, f.siblings)
	require.Len(t, history, 1)
	assert.Equal(t, "Bescheid nachgereicht", history[0]["reason"])
	assert.Equal(t, map[string]any{
		"before": map[string]any{"kind": "family"},
		"after":  map[string]any{"kind": "cost_bearer", "cost_bearer_name": office.Name},
	}, history[0]["payer"], "the history names the payer before and after")

	// The same payer again changes and records nothing.
	require.Equal(t, http.StatusOK, f.changePayer(t, f.siblings, takeover, "Noch einmal").Code)
	assert.Len(t, f.contributionVersions(t, f.siblings), 2)
	assert.Len(t, f.payerHistory(t, f.siblings), 1)

	// The exemption is no claim on a cost bearer: nobody pays.
	rec = f.payerPreview(t, f.office.token, f.siblings, "?benefits_exemption=true")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, []string{"family 0>0 bearer 3375>0", "family 0>0 bearer 9000>0"},
		payerEffects(decodeSchoolPortalData[payerPreviewBody](t, rec.Body.Bytes())))
	require.Equal(t, http.StatusOK, f.changePayer(t, f.siblings, map[string]any{"benefits_exemption": true}, "Befreiung statt Erstattung").Code)
	exempt := f.contribution(t, f.siblings)
	assert.True(t, exempt.BenefitsExemption)
	assert.Equal(t, []string{"base:6750", "sibling:-3375", "benefits_exemption:-3375"}, lineKinds(exempt.Children[0].Lines))

	// Taking it back lets the family pay what the confirmation froze.
	require.Equal(t, http.StatusOK, f.changePayer(t, f.siblings, map[string]any{}, "Bescheid abgelaufen").Code)
	family := f.contribution(t, f.siblings)
	assert.False(t, family.BenefitsExemption)
	assert.Equal(t, int64(12375), family.TotalCents)
	assert.Equal(t, []string{"base:6750", "sibling:-3375"}, lineKinds(family.Children[0].Lines))
	assert.Equal(t, []int64{12375, 0, 0, 12375}, f.contributionVersions(t, f.siblings))
	assert.Len(t, f.payerHistory(t, f.siblings), 3)
}

// TestPayerChangeReachesTheOpenRunAndLeavesAnIssuedInvoice follows the
// change through the billing: an open run bills the new payer at once, an
// issued invoice keeps its positions until the office cancels it, and the
// reimbursement list of the cost bearer follows the invoices.
func TestPayerChangeReachesTheOpenRunAndLeavesAnIssuedInvoice(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Zahlerwechsel Lauf")
	billing := traegerColleague(t, f, identityaccess.TraegerRoleBilling)
	createContributionRule(t, f, billing, siblingHalf())
	office := createCostBearer(t, f, billing, youthOffice())
	takeover := map[string]any{"cost_bearer_id": fmt.Sprint(office.ID)}
	require.Equal(t, http.StatusOK, f.confirmWith(t, f.siblings, nil).Code)
	require.Equal(t, http.StatusOK, f.confirmWith(t, f.again, nil).Code)
	setNumberRange(t, f, billing, "FE-{NNNN}")

	run := billingRun(t, f, billing, int64(startBillingRun(t, f, billing, int64(f.period.ID)).ID))
	assert.Equal(t, int64(16875), run.PreviewCents, "both families pay")
	require.Equal(t, http.StatusOK, f.changePayer(t, f.siblings, takeover, "Bescheid nachgereicht").Code)
	run = billingRun(t, f, billing, int64(run.ID))
	assert.Equal(t, int64(4500), run.PreviewCents, "the open run bills the new payer")
	rec := traegerJSON(t, f.traeger, billing, http.MethodPost, billingRunPath(int64(run.ID), "/release"), releaseBody(run))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	listPath := func(runID int64) string {
		return billingRunPath(runID, fmt.Sprintf("/cost-takeovers/%d/export?format=csv", office.ID))
	}
	rec = traegerJSON(t, f.traeger, billing, http.MethodGet, listPath(int64(run.ID)), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "Summe;;;123,75", "the cost bearer owes what the invoice names")

	// The invoice is issued: the change is allowed and says so.
	rec = f.payerPreview(t, f.office.token, f.siblings, "")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	preview := decodeSchoolPortalData[payerPreviewBody](t, rec.Body.Bytes())
	assert.True(t, preview.Invoiced)
	assert.Equal(t, []string{"family 0>3375 bearer 3375>0", "family 0>9000 bearer 9000>0"}, payerEffects(preview))
	require.Equal(t, http.StatusOK, f.changePayer(t, f.siblings, map[string]any{}, "Bescheid gilt nicht für die Ferien").Code)
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodGet, holidayContributionPath(int64(f.period.ID), f.siblings), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	changed := decodeSchoolPortalData[struct {
		TotalCents       int64 `json:"total_cents"`
		Invoiced         bool  `json:"invoiced"`
		CorrectionNeeded bool  `json:"correction_needed"`
	}](t, rec.Body.Bytes())
	assert.Equal(t, int64(12375), changed.TotalCents)
	assert.True(t, changed.Invoiced)
	assert.True(t, changed.CorrectionNeeded, "the page says that the invoice billed another amount")
	invoice := documentByNumber(t, correctedRun(t, f, billing, int64(run.ID)), "FE-0001")
	assert.Equal(t, int64(0), invoice.TotalCents, "the issued invoice keeps its amount")
	rec = traegerJSON(t, f.traeger, billing, http.MethodGet, listPath(int64(run.ID)), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "Summe;;;123,75", "and the list of the cost bearer follows the invoice")

	// Storno and a new run: the family gets an invoice over the new amount,
	// the cost bearer owes nothing.
	rec = traegerJSON(t, f.traeger, billing, http.MethodPost, cancellationPath(int64(run.ID), int64(invoice.ID)),
		map[string]any{"reason": "Zahler geändert"})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	rec = traegerJSON(t, f.traeger, billing, http.MethodGet, listPath(int64(run.ID)), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "Summe;;;0,00")
	next := billingRun(t, f, billing, int64(startBillingRun(t, f, billing, int64(f.period.ID)).ID))
	assert.Equal(t, int64(12375), next.PreviewCents, "the next run bills the family the new amount")
}

// TestPayerChangeTakesTheCostBearerBeforeTheDiscount pins the setting of
// the Träger (#5664): with "before_discount" the cost bearer pays the full
// price of each child, and the second child gets no sibling discount.
func TestPayerChangeTakesTheCostBearerBeforeTheDiscount(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Zahlerwechsel Vor Rabatt")
	billing := traegerColleague(t, f, identityaccess.TraegerRoleBilling)
	createContributionRule(t, f, billing, siblingHalf())
	office := createCostBearer(t, f, billing, youthOffice())
	setHolidayChoice(t, f, configModels.KeyParentBillingCostTakeoverOrder, "before_discount")
	require.Equal(t, http.StatusOK, f.confirmWith(t, f.siblings, nil).Code)
	assert.Equal(t, int64(12375), f.contribution(t, f.siblings).TotalCents, "the family pays with the sibling discount")

	rec := f.payerPreview(t, f.office.token, f.siblings, fmt.Sprintf("?cost_bearer_id=%d", office.ID))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	preview := decodeSchoolPortalData[payerPreviewBody](t, rec.Body.Bytes())
	assert.False(t, preview.ExemptionAvailable)
	assert.Equal(t, []string{"family 3375>0 bearer 0>6750", "family 9000>0 bearer 0>9000"}, payerEffects(preview))
	require.Equal(t, http.StatusOK, f.changePayer(t, f.siblings, map[string]any{"cost_bearer_id": fmt.Sprint(office.ID)}, "Bescheid").Code)
	assert.Equal(t, []string{"base:6750", "cost_takeover:-6750"}, lineKinds(f.contribution(t, f.siblings).Children[0].Lines))

	rec = f.payerPreview(t, f.office.token, f.siblings, "?benefits_exemption=true")
	assertRefusedWith(t, rec, http.StatusConflict, "parent_billing.benefits_exemption_unavailable")
}

// TestPayerChangeLeavesTheOtherRegistrationsOfTheGroup pins that the payer
// of one registration moves no sibling from another registration: Mara
// (67,50 €) stays the first child and Tom keeps his half, whoever pays.
func TestPayerChangeLeavesTheOtherRegistrationsOfTheGroup(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Zahlerwechsel Gruppe")
	billing := traegerColleague(t, f, identityaccess.TraegerRoleBilling)
	createContributionRule(t, f, billing, siblingHalf())
	office := createCostBearer(t, f, billing, youthOffice())
	dearer := f.submitChild(t, f.period, f.offer, "zahler.eins@example.org", "Mara", 1)
	cheaper := f.submitChild(t, f.period, f.offer, "zahler.zwei@example.org", "Tom", 0)
	require.Equal(t, http.StatusOK, f.merge(t, f.office.token, dearer, cheaper).Code)
	require.Equal(t, http.StatusOK, f.confirmWith(t, dearer, map[string]any{}).Code)
	require.Equal(t, http.StatusOK, f.confirmWith(t, cheaper, map[string]any{}).Code)
	before := f.contributionVersions(t, dearer)

	rec := f.payerPreview(t, f.office.token, cheaper, fmt.Sprintf("?cost_bearer_id=%d", office.ID))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, []string{"family 2250>0 bearer 0>2250"}, payerEffects(decodeSchoolPortalData[payerPreviewBody](t, rec.Body.Bytes())),
		"Tom stays the second child of the group")
	require.Equal(t, http.StatusOK, f.changePayer(t, cheaper, map[string]any{"cost_bearer_id": fmt.Sprint(office.ID)}, "Bescheid").Code)
	assert.Equal(t, []string{"base:4500", "sibling:-2250", "cost_takeover:-2250"}, lineKinds(f.contribution(t, cheaper).Children[0].Lines))
	assert.Equal(t, before, f.contributionVersions(t, dearer), "the sibling of the other registration keeps its version")
	assert.Empty(t, f.payerHistory(t, dearer), "and its history names no payer change")
}
