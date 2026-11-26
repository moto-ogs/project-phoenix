// Router-level tests for the photo consent of a holiday guest (#4721, ADR
// 0120 addendum of 2026-11-24): the hosting school reads live whether the
// home school holds a photo consent, so a withdrawal in the parents portal
// of the home school counts at the hosting school with its next read, and a
// holiday guest never holds a photo at the hosting school.
package api

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type holidayGuestPhotoConsentBody struct {
	HomePhotoConsent       *bool `json:"home_photo_consent"`
	HomeRoomHistoryStopped *bool `json:"home_room_history_stopped"`
	ReadOnly               bool  `json:"read_only"`
}

// hostedHolidayGuests is a holiday week the OGS Nord hosts with two guests:
// Tom, whose registration names the OGS Süd as his home school, and Ben
// without a school of the Träger.
type hostedHolidayGuests struct {
	f               holidayGuestFixture
	lead            string
	tom, ben        int64
	tomRegistration int64
}

func newHostedHolidayGuests(t *testing.T, traeger string) hostedHolidayGuests {
	t.Helper()
	f := newHolidayGuestFixture(t, traeger)
	g := hostedHolidayGuests{f: f, lead: f.staffOf(t, f.nord, permissions.ConfigRead, permissions.UsersCreate, permissions.UsersRead)}
	require.NoError(t, f.db.NewRaw(`SELECT id FROM enrollment.holiday_registrations WHERE id <> ? AND organization_id =
		(SELECT organization_id FROM enrollment.holiday_registrations WHERE id = ?)`, f.siblings, f.siblings).Scan(t.Context(), &g.tomRegistration))
	f.confirm(t, f.siblings, "confirm")
	f.confirm(t, g.tomRegistration, "confirm")
	f.today.Store(calendar.NewDate(2099, 7, 6))
	require.Equal(t, http.StatusOK, f.assign(t, g.lead, int64(f.offer.Weeks[0].ID), f.group).Code)
	guests := f.roster(t, calendar.NewDate(2099, 7, 8))
	g.tom, g.ben = guests["Tom Beispiel"], guests["Ben Muster"]
	require.NotZero(t, g.tom)
	require.NotZero(t, g.ben)
	return g
}

func (g hostedHolidayGuests) exec(t *testing.T) func(query string, args ...any) {
	return func(query string, args ...any) {
		t.Helper()
		_, err := g.f.db.NewRaw(query, args...).Exec(t.Context())
		require.NoError(t, err, query)
	}
}

func (g hostedHolidayGuests) sheet(t *testing.T, student int64) holidayGuestPhotoConsentBody {
	t.Helper()
	rec := g.f.sheet(t, g.lead, student)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[holidayGuestPhotoConsentBody](t, rec.Body.Bytes())
}

// homeFamily gives Tom a family at his home school, with a parents portal
// account. The family fixture lives in its own school; that school joins the
// Träger and becomes the home school the registration names.
func (g hostedHolidayGuests) homeFamily(t *testing.T) (*guardRig, childReadFamily) {
	t.Helper()
	rig := newGuardRig(t, g.f.db)
	family := rig.family(t)
	exec := g.exec(t)
	exec(`UPDATE platform.schools SET organization_id = (SELECT organization_id FROM platform.schools WHERE id = ?) WHERE id = ?`, g.f.nord, family.TenantID)
	exec(`UPDATE users.persons SET first_name = ' tom', last_name = 'BEISPIEL', birthday = '2017-05-20' WHERE id = ?`, family.PersonID)
	exec(`UPDATE enrollment.holiday_registration_children SET home_school_id = ? WHERE holiday_registration_id = ?`, family.TenantID, g.tomRegistration)
	return rig, family
}

// homeConsentAs asks the database function as the tenant school, the way a
// tenant transaction of that school would: the statement sets the school for
// itself before it calls the function.
func homeConsentAs(t *testing.T, f holidayGuestFixture, school, student int64) *bool {
	t.Helper()
	var consent *bool
	require.NoError(t, f.db.NewRaw(`WITH scope AS MATERIALIZED (SELECT set_config('app.current_tenant_id', ?, true))
		SELECT enrollment.holiday_guest_home_photo_consent(?) FROM scope`, fmt.Sprint(school), student).Scan(t.Context(), &consent))
	return consent
}

func TestPhotoConsentWithdrawnAtTheHomeSchoolCountsAtTheHostingSchoolAtOnce(t *testing.T) {
	t.Parallel()
	g := newHostedHolidayGuests(t, "Träger Foto-Einwilligung")
	f, lead, tom, ben := g.f, g.lead, g.tom, g.ben
	sheet := func(token string, student int64) holidayGuestPhotoConsentBody {
		t.Helper()
		rec := f.sheet(t, token, student)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return decodeSchoolPortalData[holidayGuestPhotoConsentBody](t, rec.Body.Bytes())
	}

	assert.Nil(t, sheet(lead, ben).HomePhotoConsent, "a guest without a home school of the Träger has no answer")
	consent := sheet(lead, tom).HomePhotoConsent
	require.NotNil(t, consent, "a guest of a school of the Träger has an answer")
	assert.False(t, *consent, "the home school knows no child of that name yet")

	rig, family := g.homeFamily(t)
	exec := g.exec(t)

	assert.False(t, *sheet(lead, tom).HomePhotoConsent, "the child of the home school has no photo consent")
	rig.givePhoto(t, family)
	assert.True(t, *sheet(lead, tom).HomePhotoConsent, "the consent of the home school counts at the hosting school")

	// The parent withdraws in the parents portal of the home school. No
	// reconciliation runs in between: the next read of the hosting school
	// already answers without consent.
	rig.do(t, photoConsent(http.MethodDelete, family.StudentID), family.token)
	assert.False(t, *sheet(lead, tom).HomePhotoConsent, "the withdrawal counts at the hosting school at once")
	const photosEnabled = "operations.student_photos_enabled"
	rig.set(t, map[string]any{photosEnabled: true})
	rig.do(t, photoConsent(http.MethodPut, family.StudentID), family.token)
	assert.True(t, *sheet(lead, tom).HomePhotoConsent, "a consent given again counts at once, too")

	t.Run("only the hosting school gets an answer", func(t *testing.T) {
		assert.True(t, *homeConsentAs(t, f, f.nord, tom))
		assert.Nil(t, homeConsentAs(t, f, family.TenantID, tom), "the home school hosts nothing")
		assert.Nil(t, homeConsentAs(t, f, int64(f.offer.Schools[1].ID), tom), "another school of the Träger hosts nothing")
		stranger := newHolidayGuestFixture(t, "Fremder Träger")
		assert.Nil(t, homeConsentAs(t, f, stranger.nord, tom), "a school of another Träger gets no answer")
		exec(`UPDATE platform.schools SET organization_id = (SELECT organization_id FROM platform.schools WHERE id = ?) WHERE id = ?`, stranger.nord, family.TenantID)
		consent := homeConsentAs(t, f, f.nord, tom)
		assert.Nil(t, consent, "a home school that left the Träger answers nothing")
		exec(`UPDATE platform.schools SET organization_id = (SELECT organization_id FROM platform.schools WHERE id = ?) WHERE id = ?`, f.nord, family.TenantID)

		// A hosting school that left the Träger gets no answer any more,
		// although its week and its guest copies still stand.
		var traeger int64
		require.NoError(t, f.db.NewRaw(`SELECT organization_id FROM platform.schools WHERE id = ?`, f.nord).Scan(t.Context(), &traeger))
		exec(`UPDATE platform.schools SET organization_id = (SELECT organization_id FROM platform.schools WHERE id = ?) WHERE id = ?`, stranger.nord, f.nord)
		assert.Nil(t, homeConsentAs(t, f, f.nord, tom), "a hosting school that left the Träger gets no answer")
		exec(`UPDATE platform.schools SET organization_id = ? WHERE id = ?`, traeger, f.nord)
		assert.True(t, *homeConsentAs(t, f, f.nord, tom))
	})

	t.Run("the answer ends with the booking", func(t *testing.T) {
		for name, change := range map[string][2]string{
			"guest ended early":       {`UPDATE enrollment.holiday_guests SET ended_on = '2099-07-06' WHERE student_id = ?`, `UPDATE enrollment.holiday_guests SET ended_on = NULL WHERE student_id = ?`},
			"booking on the waitlist": {`UPDATE enrollment.holiday_registration_bookings SET placement = 'waitlisted' WHERE holiday_registration_child_id = (SELECT holiday_registration_child_id FROM enrollment.holiday_guests WHERE student_id = ?)`, `UPDATE enrollment.holiday_registration_bookings SET placement = 'placed' WHERE holiday_registration_child_id = (SELECT holiday_registration_child_id FROM enrollment.holiday_guests WHERE student_id = ?)`},
			"registration cancelled":  {`UPDATE enrollment.holiday_registrations SET status = 'cancelled' WHERE id = (SELECT child.holiday_registration_id FROM enrollment.holiday_guests AS guest JOIN enrollment.holiday_registration_children AS child ON child.id = guest.holiday_registration_child_id WHERE guest.student_id = ?)`, `UPDATE enrollment.holiday_registrations SET status = 'confirmed' WHERE id = (SELECT child.holiday_registration_id FROM enrollment.holiday_guests AS guest JOIN enrollment.holiday_registration_children AS child ON child.id = guest.holiday_registration_child_id WHERE guest.student_id = ?)`},
		} {
			exec(change[0], tom)
			assert.Nil(t, homeConsentAs(t, f, f.nord, tom), name)
			exec(change[1], tom)
			assert.True(t, *homeConsentAs(t, f, f.nord, tom), name)
		}
	})

	t.Run("two children of that name leave the answer without consent", func(t *testing.T) {
		twin := testpkg.CreateTestStudentForTenant(t, f.db, family.TenantID, "Tom", "Beispiel", "1a")
		exec(`UPDATE users.persons SET birthday = '2017-05-20' WHERE id = ?`, twin.PersonID)
		exec(`UPDATE users.student_profiles SET photo_consent_given_at = now() WHERE id = ?`, twin.ID)
		assert.False(t, *sheet(lead, tom).HomePhotoConsent, "the registration must fit exactly one child")
		// A child that left the home school before the week does not count.
		exec(`UPDATE users.student_school_memberships SET enrolled_from = '2090-01-01', enrolled_until = '2098-12-31' WHERE student_profile_id = ?`, twin.ID)
		assert.True(t, *sheet(lead, tom).HomePhotoConsent, "only children of the home school in that week count")
	})

	t.Run("the permissions of the sheet apply", func(t *testing.T) {
		assert.Equal(t, http.StatusForbidden, f.sheet(t, f.staffOf(t, f.nord, permissions.ConfigRead), tom).Code)
		sued := f.staffOf(t, int64(f.offer.Schools[1].ID), permissions.UsersRead)
		assert.Equal(t, http.StatusNotFound, f.sheet(t, sued, tom).Code, "another school of the Träger reads no sheet")
	})

	t.Run("after the week the sheet names no consent", func(t *testing.T) {
		f.today.Store(calendar.NewDate(2099, 7, 12))
		after := sheet(lead, tom)
		assert.True(t, after.ReadOnly)
		assert.Nil(t, after.HomePhotoConsent)
	})
}
