// Router-level tests for the voluntary consents of a holiday registration
// at the hosting school (#8038, ADR 0321): the participant list and the
// sheet of a holiday guest read them live from the registration, so a
// withdrawal in the parents portal counts with the next read, and only the
// hosting school of a confirmed, placed booking reads them.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// hostConsentBlocks is a form version with a notice and two voluntary
// consents; the hosting school sees only the consents.
const hostConsentBlocks = `[
	{"key": "hinweise", "kind": "terms", "title": "Hinweise", "label": "Ich habe die Hinweise gelesen.", "enabled": true, "required": true, "sort_order": 1},
	{"key": "fotos", "kind": "consent", "title": "Fotos in der Ferienbetreuung", "label": "Mein Kind darf auf Erinnerungsfotos zu sehen sein.", "text": "Die Fotos bleiben in der OGS.", "enabled": true, "sort_order": 2},
	{"key": "ausfluege", "kind": "consent", "title": "Ausflüge", "label": "Mein Kind darf mit dem Bus fahren.", "enabled": true, "sort_order": 3}
]`

type hostConsentBody struct {
	Key       string     `json:"key"`
	Title     string     `json:"title"`
	Label     string     `json:"label"`
	Text      string     `json:"text"`
	Given     bool       `json:"given"`
	ChangedAt *time.Time `json:"changed_at"`
}

func TestHostingSchoolReadsTheVoluntaryConsentsOfAHolidayRegistrationLive(t *testing.T) {
	t.Parallel()
	f := newHolidayGuestFixture(t, "Träger Ferien-Einwilligungen")
	week := int64(f.offer.Weeks[0].ID)
	lead := f.staffOf(t, f.nord, permissions.ConfigRead, permissions.UsersCreate, permissions.UsersRead)
	exec := func(query string, args ...any) {
		t.Helper()
		_, err := f.db.NewRaw(query, args...).Exec(t.Context())
		require.NoError(t, err, query)
	}
	exec(`UPDATE enrollment.holiday_period_forms AS form SET legal_blocks = ?::jsonb
		FROM enrollment.holiday_registrations AS registration
		WHERE registration.id = ? AND form.organization_id = registration.organization_id
			AND form.holiday_period_id = registration.holiday_period_id AND form.version = registration.form_version`, hostConsentBlocks, f.siblings)
	parent := testpkg.CreateTestAccount(t, f.db, "ferien-einwilligung-gast")
	exec(`UPDATE enrollment.holiday_registrations
		SET parent_account_id = ?, legal_acceptances = legal_acceptances || jsonb_build_object('hinweise', submitted_at, 'fotos', submitted_at)
		WHERE id = ?`, parent.ID, f.siblings)

	type participant struct {
		FirstName string            `json:"first_name"`
		Consents  []hostConsentBody `json:"consents"`
	}
	participants := func(token string) (int, map[string][]hostConsentBody) {
		t.Helper()
		rec := f.do(t, token, http.MethodGet, fmt.Sprintf("/api/holiday-weeks/%d/participants", week), nil)
		if rec.Code != http.StatusOK {
			return rec.Code, nil
		}
		list := decodeSchoolPortalData[struct {
			Participants []participant `json:"participants"`
		}](t, rec.Body.Bytes())
		consents := map[string][]hostConsentBody{}
		for _, child := range list.Participants {
			consents[child.FirstName] = child.Consents
		}
		return rec.Code, consents
	}
	_, unconfirmed := participants(lead)
	assert.NotContains(t, unconfirmed, "Ben", "a registration before its confirmation lists nobody")

	f.confirm(t, f.siblings, "confirm")
	_, listed := participants(lead)
	require.Contains(t, listed, "Ben")
	ben := listed["Ben"]
	require.Len(t, ben, 2, "the hosting school sees the consents, never the notice")
	assert.Equal(t, "fotos", ben[0].Key)
	assert.Equal(t, "Fotos in der Ferienbetreuung", ben[0].Title)
	assert.Equal(t, "Mein Kind darf auf Erinnerungsfotos zu sehen sein.", ben[0].Label)
	assert.Empty(t, ben[0].Text, "the explanation stays with the parents and the Träger")
	assert.True(t, ben[0].Given)
	assert.False(t, ben[1].Given, "a consent the parents did not give")
	assert.Nil(t, ben[1].ChangedAt)
	assert.Equal(t, ben, listed["Lia"], "an own child of the school reads the same consents of its registration")

	f.today.Store(calendar.NewDate(2099, 7, 6))
	require.Equal(t, http.StatusOK, f.assign(t, lead, week, f.group).Code)
	guest := f.roster(t, calendar.NewDate(2099, 7, 8))["Ben Muster"]
	require.NotZero(t, guest)
	sheet := func(token string) []hostConsentBody {
		t.Helper()
		rec := f.sheet(t, token, guest)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return decodeSchoolPortalData[struct {
			Consents []hostConsentBody `json:"consents"`
		}](t, rec.Body.Bytes()).Consents
	}
	require.Len(t, sheet(lead), 2)
	assert.True(t, sheet(lead)[0].Given, "the sheet of the guest names the consent")

	// The parents withdraw in the parents portal. Nothing is copied: the
	// next read of the hosting school already says so.
	setConsent := func(given bool) {
		t.Helper()
		ctx := tenant.WithUnitOfWork(context.Background(), testpkg.TenantRuntime(t, f.db))
		require.NoError(t, tenant.WithinAdmin(ctx, func(adminCtx context.Context) error {
			found, err := enrollmentCompose.NewHolidayParentRegistrations(time.Now).
				SetHolidayRegistrationConsent(adminCtx, parent.ID, f.siblings, "fotos", given)
			assert.True(t, found)
			return err
		}))
	}
	setConsent(false)
	withdrawn := sheet(lead)
	assert.False(t, withdrawn[0].Given, "the withdrawal counts at the hosting school at once")
	require.NotNil(t, withdrawn[0].ChangedAt, "it names when the parents withdrew")
	_, listed = participants(lead)
	assert.False(t, listed["Ben"][0].Given, "in the participant list too")
	setConsent(true)
	assert.True(t, sheet(lead)[0].Given, "a consent given again counts at once, too")

	t.Run("the office records a withdrawal the parents declared outside moto", func(t *testing.T) {
		withdraw := func(key string) int {
			path := fmt.Sprintf("%s/registrations/%d/consents/%s/withdraw", holidayPeriodPath(f.periodID(t)), f.siblings, key)
			return traegerJSON(t, f.traeger, f.office.token, http.MethodPost, path, nil).Code
		}
		require.Equal(t, http.StatusOK, withdraw("fotos"))
		withdrawn := sheet(lead)
		assert.False(t, withdrawn[0].Given, "the hosting school reads the office's entry at once")
		require.NotNil(t, withdrawn[0].ChangedAt)
		assert.Equal(t, http.StatusConflict, withdraw("fotos"), "a consent already withdrawn is no change")
		assert.Equal(t, http.StatusConflict, withdraw("ausfluege"), "a consent never given cannot be withdrawn")
		assert.Equal(t, http.StatusConflict, withdraw("hinweise"), "a notice is no consent")
		var authors []int64
		require.NoError(t, f.db.NewRaw(`SELECT actor_account_id FROM enrollment.holiday_registration_audit
			WHERE holiday_registration_id = ? AND action = 'consent' ORDER BY id`, f.siblings).Scan(t.Context(), &authors))
		require.Len(t, authors, 3, "the parents twice, the office once")
		assert.NotEqual(t, parent.ID, authors[2], "the office is the author of its entry")
		var evidence struct {
			AcceptedAt  *string `json:"accepted_at"`
			FormVersion int     `json:"form_version"`
		}
		var raw string
		require.NoError(t, f.db.NewRaw(`SELECT details::text FROM enrollment.holiday_registration_audit
			WHERE holiday_registration_id = ? AND action = 'consent' ORDER BY id DESC LIMIT 1`, f.siblings).Scan(t.Context(), &raw))
		require.NoError(t, json.Unmarshal([]byte(raw), &evidence))
		assert.NotNil(t, evidence.AcceptedAt, "the office's entry keeps when the consent had been given")
		assert.Positive(t, evidence.FormVersion, "and in which form version")
		setConsent(true)
	})

	t.Run("the export names each consent", func(t *testing.T) {
		rec := f.do(t, lead, http.MethodGet, fmt.Sprintf("/api/holiday-weeks/%d/participants/export?format=csv", week), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Contains(t, rec.Body.String(), "Einwilligung: Fotos in der Ferienbetreuung")
		assert.Contains(t, rec.Body.String(), "Einwilligung: Ausflüge")
	})

	t.Run("only the hosting school reads them", func(t *testing.T) {
		var organization, child int64
		require.NoError(t, f.db.NewRaw(`SELECT organization_id FROM enrollment.holiday_registrations WHERE id = ?`, f.siblings).Scan(t.Context(), &organization))
		require.NoError(t, f.db.NewRaw(`SELECT holiday_registration_child_id FROM enrollment.holiday_guests WHERE student_id = ?`, guest).Scan(t.Context(), &child))
		consentsAs := func(school int64) *string {
			t.Helper()
			var consents *string
			require.NoError(t, f.db.NewRaw(`WITH scope AS MATERIALIZED (SELECT set_config('app.current_tenant_id', ?, true))
				SELECT enrollment.holiday_host_registration_consents(?, ?, ?) FROM scope`, fmt.Sprint(school), organization, week, child).Scan(t.Context(), &consents))
			return consents
		}
		assert.NotEmpty(t, consentsAs(f.nord))
		assert.Nil(t, consentsAs(int64(f.offer.Schools[1].ID)), "another school of the Träger hosts nothing")
		stranger := newHolidayGuestFixture(t, "Fremder Träger Einwilligungen")
		assert.Nil(t, consentsAs(stranger.nord), "a school of another Träger reads nothing")
		exec(`UPDATE enrollment.holiday_registration_bookings SET placement = 'waitlisted' WHERE holiday_registration_child_id = ?`, child)
		assert.Nil(t, consentsAs(f.nord), "a booking on the waiting list gives no access")
		exec(`UPDATE enrollment.holiday_registration_bookings SET placement = 'placed' WHERE holiday_registration_child_id = ?`, child)
		exec(`UPDATE enrollment.holiday_registrations SET status = 'cancelled' WHERE id = ?`, f.siblings)
		assert.Nil(t, consentsAs(f.nord), "a cancelled registration gives no access")
		exec(`UPDATE enrollment.holiday_registrations SET status = 'confirmed' WHERE id = ?`, f.siblings)
		assert.NotEmpty(t, consentsAs(f.nord))
	})

	t.Run("the sheet needs the right to read children", func(t *testing.T) {
		assert.Equal(t, http.StatusForbidden, f.sheet(t, f.staffOf(t, f.nord, permissions.ConfigRead), guest).Code)
	})

	t.Run("after the week the sheet names no consent", func(t *testing.T) {
		f.today.Store(calendar.NewDate(2099, 7, 12))
		rec := f.sheet(t, lead, guest)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Nil(t, decodeSchoolPortalData[struct {
			Consents []hostConsentBody `json:"consents"`
		}](t, rec.Body.Bytes()).Consents)
	})
}
