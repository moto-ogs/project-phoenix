package parent_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	parentHTTP "github.com/moto-ogs/project-phoenix/workflows/parentportal/http"
)

// holidayConsentBlocks is a form version with a required notice, two
// voluntary consents in the order of sort_order and a disabled consent.
const holidayConsentBlocks = `[
	{"key": "hinweise", "kind": "terms", "title": "Hinweise", "label": "Ich habe die Hinweise gelesen.", "enabled": true, "required": true, "sort_order": 5},
	{"key": "fotos", "kind": "consent", "title": "Fotos in der Ferienbetreuung", "label": "Mein Kind darf auf Erinnerungsfotos zu sehen sein.", "text": "Die Fotos bleiben in der OGS.", "enabled": true, "sort_order": 20},
	{"key": "ausfluege", "kind": "consent", "title": "Ausflüge mit dem Bus", "label": "Mein Kind darf mit dem Bus fahren.", "enabled": true, "sort_order": 10},
	{"key": "alt", "kind": "consent", "title": "Alte Einwilligung", "label": "Nicht mehr gefragt.", "enabled": false, "sort_order": 30}
]`

type consentEntry struct {
	ID       string                                          `json:"id"`
	Consents []parentHTTP.HolidayRegistrationConsentResponse `json:"consents"`
}

// TestParentsWithdrawAndGiveAgainTheVoluntaryConsentsOfTheirHolidayRegistration
// pins #8038 (ADR 0321) for the parents portal: the list names the enabled
// consents of the registration's form version in the order of the form, the
// parents withdraw one as easily as they gave it and give it again, each
// change stands once in the registration's audit trail with the account as
// its author, a withdrawn consent is no acceptance for any other reader, and
// no other account, notice or unknown key can be changed.
func TestParentsWithdrawAndGiveAgainTheVoluntaryConsentsOfTheirHolidayRegistration(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	_, router := holidayEntriesPortal(t, db)
	ctx := context.Background()
	organization, school := holidayTraeger(t, db, "Träger Einwilligungen")
	eva := testpkg.CreateTestAccount(t, db, "ferien-einwilligung-eva")
	tom := testpkg.CreateTestAccount(t, db, "ferien-einwilligung-tom")
	registration := testpkg.CreateTestHolidayRegistration(t, db, organization, school, "Herbstferien 2029", eva.Email, "Lia")
	exec := func(query string, args ...any) {
		t.Helper()
		_, err := db.NewRaw(query, args...).Exec(ctx)
		require.NoError(t, err, query)
	}
	exec(`UPDATE enrollment.holiday_period_forms SET legal_blocks = ?::jsonb WHERE organization_id = ? AND holiday_period_id = ? AND version = 1`,
		holidayConsentBlocks, organization, registration.PeriodID)
	exec(`UPDATE enrollment.holiday_registrations SET parent_account_id = ?, form_version = 1,
		legal_acceptances = jsonb_build_object('hinweise', submitted_at, 'fotos', submitted_at) WHERE id = ?`, eva.ID, registration.RegistrationID)

	tokenOf := func(account *testpkg.AccountFixture) string {
		return testutil.MintTestJWT(t, sessiontoken.AppClaims{ID: int(account.ID), Sub: account.Email, Roles: []string{"parent"}, Scope: "parent"})
	}
	call := func(account *testpkg.AccountFixture, method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+tokenOf(account))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	consents := func() []parentHTTP.HolidayRegistrationConsentResponse {
		t.Helper()
		rec := call(eva, http.MethodGet, "/me/holiday-registration-entries", "")
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var envelope struct {
			Data struct {
				Registrations []consentEntry `json:"registrations"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope))
		require.Len(t, envelope.Data.Registrations, 1)
		return envelope.Data.Registrations[0].Consents
	}
	path := func(key string) string {
		return fmt.Sprintf("/me/holiday-registration-entries/%d/consents/%s", registration.RegistrationID, key)
	}
	audit := func() []map[string]any {
		t.Helper()
		var rows []struct {
			Actor   int64           `bun:"actor_account_id"`
			Details json.RawMessage `bun:"details,type:jsonb"`
		}
		require.NoError(t, db.NewRaw(`SELECT actor_account_id, details FROM enrollment.holiday_registration_audit
			WHERE holiday_registration_id = ? AND action = 'consent' ORDER BY id`, registration.RegistrationID).Scan(ctx, &rows))
		entries := make([]map[string]any, len(rows))
		for i, row := range rows {
			assert.Equal(t, eva.ID, row.Actor, "the parents' account is the author of the change")
			require.NoError(t, json.Unmarshal(row.Details, &entries[i]))
		}
		return entries
	}
	accepted := func(key string) bool {
		t.Helper()
		var given bool
		require.NoError(t, db.NewRaw(`SELECT legal_acceptances->? IS NOT NULL FROM enrollment.holiday_registrations WHERE id = ?`,
			key, registration.RegistrationID).Scan(ctx, &given))
		return given
	}

	listed := consents()
	require.Len(t, listed, 2, "only the enabled consents; a notice is no consent")
	assert.Equal(t, "ausfluege", listed[0].Key, "in the order of the form")
	assert.False(t, listed[0].Given)
	assert.Nil(t, listed[0].ChangedAt, "never given")
	assert.Equal(t, "fotos", listed[1].Key)
	assert.Equal(t, "Fotos in der Ferienbetreuung", listed[1].Title)
	assert.Equal(t, "Mein Kind darf auf Erinnerungsfotos zu sehen sein.", listed[1].Label)
	assert.Equal(t, "Die Fotos bleiben in der OGS.", listed[1].Text)
	assert.True(t, listed[1].Given)
	require.NotNil(t, listed[1].ChangedAt)
	givenAt := *listed[1].ChangedAt

	rec := call(eva, http.MethodPut, path("fotos"), `{"given": false}`)
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	listed = consents()
	assert.False(t, listed[1].Given, "the withdrawal holds at once")
	require.NotNil(t, listed[1].ChangedAt)
	assert.True(t, listed[1].ChangedAt.After(givenAt), "it names when the parents withdrew")
	assert.False(t, accepted("fotos"), "a withdrawn consent is no acceptance for the record, the export or the review")
	assert.True(t, accepted("hinweise"), "the other acceptances stay")
	entries := audit()
	require.Len(t, entries, 1)
	assert.Equal(t, "fotos", entries[0]["key"])
	assert.Equal(t, false, entries[0]["given"])
	assert.NotNil(t, entries[0]["accepted_at"], "the trail keeps when the consent had been given")

	require.Equal(t, http.StatusNoContent, call(eva, http.MethodPut, path("fotos"), `{"given": false}`).Code)
	assert.Len(t, audit(), 1, "a consent already withdrawn records nothing")

	require.Equal(t, http.StatusNoContent, call(eva, http.MethodPut, path("fotos"), `{"given": true}`).Code)
	listed = consents()
	assert.True(t, listed[1].Given, "the parents give it again")
	assert.True(t, accepted("fotos"))
	var withdrawn bool
	require.NoError(t, db.NewRaw(`SELECT legal_withdrawals->'fotos' IS NOT NULL FROM enrollment.holiday_registrations WHERE id = ?`,
		registration.RegistrationID).Scan(ctx, &withdrawn))
	assert.False(t, withdrawn, "giving again ends the withdrawal")
	require.Equal(t, http.StatusNoContent, call(eva, http.MethodPut, path("ausfluege"), `{"given": true}`).Code)
	assert.True(t, consents()[0].Given, "a consent never given can be given later")
	assert.Len(t, audit(), 3)

	refused := func(t *testing.T, rec *httptest.ResponseRecorder) {
		t.Helper()
		require.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
		assert.Contains(t, rec.Body.String(), `"code":"enrollment.holiday_registration_entry_not_found"`)
	}
	t.Run("only the account's own enabled consents", func(t *testing.T) {
		refused(t, call(tom, http.MethodPut, path("fotos"), `{"given": false}`))
		refused(t, call(eva, http.MethodPut, path("hinweise"), `{"given": false}`))
		refused(t, call(eva, http.MethodPut, path("alt"), `{"given": true}`))
		refused(t, call(eva, http.MethodPut, path("unbekannt"), `{"given": true}`))
		refused(t, call(eva, http.MethodPut, "/me/holiday-registration-entries/999999999/consents/fotos", `{"given": false}`))
		assert.True(t, accepted("fotos"), "nothing changed")
		assert.True(t, accepted("hinweise"))
		assert.Len(t, audit(), 3)
	})
	t.Run("the request names the state", func(t *testing.T) {
		require.Equal(t, http.StatusBadRequest, call(eva, http.MethodPut, path("fotos"), `{}`).Code)
		assert.True(t, accepted("fotos"))
	})
}
