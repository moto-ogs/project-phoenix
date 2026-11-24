// Router-level tests for the two holiday contribution saves that rest on a
// read (#7904, ADR 0311): the change of the children's debtor numbers sends
// the version of the numbers the office read, and the confirmation the
// fingerprint of the preview it read. A changed or missing token is 409
// general.changed_since_read and writes nothing; the current one saves.
package api

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

// numbersOf names each child's number by first name.
func numbersOf(read holidayChildNumbersBody) map[string]string {
	numbers := map[string]string{}
	for _, child := range read.Children {
		numbers[child.FirstName] = child.DebtorNumber
	}
	return numbers
}

func TestHolidayChildNumbersSaveOnlyOverTheNumbersTheOfficeRead(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Kindernummern gelesen")
	setTraegerSetting(t, f, configModels.KeyParentBillingDebtorNumberScope, "child")
	proposal := holidayChildNumbers(t, f, f.siblings)
	require.Len(t, proposal.Children, 2)
	first, second := proposal.Children[0], proposal.Children[1]
	rec := f.confirmWith(t, f.siblings, map[string]any{"child_debtor_numbers": []map[string]any{
		{"child_id": first.ChildID, "debtor_number": "60101"}, {"child_id": second.ChildID, "debtor_number": "60102"},
	}})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	read := holidayChildNumbers(t, f, f.siblings)
	require.NotEmpty(t, read.Version)

	// A colleague changes Lia's number in the list of families, another
	// writer of the same numbers.
	billing := traegerColleague(t, f, identityaccess.TraegerRoleBilling)
	rec = traegerJSON(t, f.traeger, billing, http.MethodPut, childDebtorNumberPath, map[string]any{"family_email": "eva.muster@example.org",
		"child_first_name": "Lia", "child_last_name": "Muster", "child_birth_date": "2018-03-01", "debtor_number": "60109"})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	stored := numbersOf(holidayChildNumbers(t, f, f.siblings))
	require.Equal(t, "60109", stored["Lia"])

	path := holidayContributionPath(int64(f.period.ID), f.siblings) + "/child-debtor-numbers"
	inputs := []map[string]any{{"child_id": first.ChildID, "debtor_number": "60101"}, {"child_id": second.ChildID, "debtor_number": "60103"}}
	for name, version := range map[string]string{"an older read": read.Version, "no read": ""} {
		rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, path, map[string]any{"children": inputs, "expected_version": version})
		require.Equal(t, http.StatusConflict, rec.Code, "%s: %s", name, rec.Body.String())
		assert.Equal(t, "general.changed_since_read", refusalCode(t, rec), name)
		assert.Equal(t, stored, numbersOf(holidayChildNumbers(t, f, f.siblings)), "%s writes nothing", name)
	}

	current := holidayChildNumbers(t, f, f.siblings)
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, path, map[string]any{"children": inputs, "expected_version": current.Version})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	answer := decodeSchoolPortalData[holidayChildNumbersBody](t, rec.Body.Bytes())
	assert.Equal(t, map[string]string{"Lia": "60101", "Ben": "60103"}, numbersOf(holidayChildNumbers(t, f, f.siblings)))
	assert.Equal(t, holidayChildNumbers(t, f, f.siblings).Version, answer.Version, "the answer carries the version a read gives")
	inputs[1]["debtor_number"] = "60104"
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, path, map[string]any{"children": inputs, "expected_version": answer.Version})
	require.Equal(t, http.StatusOK, rec.Code, "a second save over the answer is no refusal: %s", rec.Body.String())

	// A confirmation that sends the numbers sends their version too.
	repeated := f.submitChild(t, f.period, f.offer, "eva.muster@example.org", "Lia", 0)
	shown := holidayChildNumbers(t, f, repeated)
	require.Len(t, shown.Children, 1)
	rec = traegerJSON(t, f.traeger, billing, http.MethodPut, childDebtorNumberPath, map[string]any{"family_email": "eva.muster@example.org",
		"child_first_name": "Lia", "child_last_name": "Muster", "child_birth_date": "2018-03-01", "debtor_number": "60110"})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	body := withHolidayPreview(t, f.traeger, f.office.token, int64(f.period.ID), repeated, map[string]any{"child_debtor_numbers": []map[string]any{
		{"child_id": shown.Children[0].ChildID, "debtor_number": shown.Children[0].DebtorNumber},
	}})
	body["expected_child_debtor_numbers_version"] = shown.Version
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPost, holidayConfirmPath(int64(f.period.ID), repeated), body)
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Equal(t, "general.changed_since_read", refusalCode(t, rec))
	assert.Equal(t, "received", f.detail(t, traegerJSON(t, f.traeger, f.office.token, http.MethodGet, f.registrationPath(repeated, ""), nil)).Status)
	assert.Equal(t, "60110", numbersOf(holidayChildNumbers(t, f, repeated))["Lia"], "the refused confirmation keeps the colleague's number")
	rec = f.confirmWith(t, repeated, map[string]any{"child_debtor_numbers": []map[string]any{
		{"child_id": shown.Children[0].ChildID, "debtor_number": "60110"},
	}})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}

func TestHolidayConfirmationFreezesOnlyThePreviewTheOfficeRead(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Vorschau gelesen")
	billing := traegerColleague(t, f, identityaccess.TraegerRoleBilling)
	read := f.contribution(t, f.siblings)
	require.NotEmpty(t, read.Fingerprint)

	// The Abrechnung adds a sibling discount after the office read the
	// preview: the confirmation would freeze another amount.
	createContributionRule(t, f, billing, siblingHalf())
	contributions := func() int {
		var rows int
		require.NoError(t, f.db.NewRaw(`SELECT count(*) FROM parent_billing.holiday_contributions WHERE holiday_registration_id = ?`, f.siblings).
			Scan(context.Background(), &rows))
		return rows
	}
	for name, fingerprint := range map[string]string{"an older preview": read.Fingerprint, "no preview": ""} {
		rec := traegerJSON(t, f.traeger, f.office.token, http.MethodPost, holidayConfirmPath(int64(f.period.ID), f.siblings),
			map[string]any{"expected_fingerprint": fingerprint})
		require.Equal(t, http.StatusConflict, rec.Code, "%s: %s", name, rec.Body.String())
		assert.Equal(t, "general.changed_since_read", refusalCode(t, rec), name)
		assert.Equal(t, "received", f.detail(t, traegerJSON(t, f.traeger, f.office.token, http.MethodGet, f.registrationPath(f.siblings, ""), nil)).Status,
			"%s confirms nothing", name)
		assert.Zero(t, contributions(), "%s freezes nothing", name)
	}

	current := f.contribution(t, f.siblings)
	require.NotEqual(t, read.TotalCents, current.TotalCents)
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodPost, holidayConfirmPath(int64(f.period.ID), f.siblings),
		map[string]any{"expected_fingerprint": current.Fingerprint})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, current.TotalCents, decodeSchoolPortalData[confirmationBody](t, rec.Body.Bytes()).Contribution.TotalCents,
		"the confirmation freezes the amount it read")
	assert.Empty(t, f.contribution(t, f.siblings).Fingerprint, "a frozen contribution is no preview")
}
