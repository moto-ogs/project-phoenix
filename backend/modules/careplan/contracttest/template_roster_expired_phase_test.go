package contracttest_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	enrollmentTest "github.com/moto-ogs/project-phoenix/modules/enrollment/enrollmenttest"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	timetableCompose "github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestTemplateRosterMaintenance_ExpiredPhaseSourceIsNamedUntilConnected
// (#8203): a Regeltermin keeps its source offering of last school year's
// phase after the rollover cloned the catalog. Bookings of the new phase's
// offering of the same name do not reach it, and the indicator says so with
// the new offering as suggestion. Once the Regeltermin is connected with the
// new offering, its bookings arrive and the indicator is automatic again.
func TestTemplateRosterMaintenance_ExpiredPhaseSourceIsNamedUntilConnected(t *testing.T) {
	t.Parallel()

	env := setupDecisionTest(t)
	ctx := testpkg.Ctx(t)

	// Last school year's phase ended on 31 July 2026; the planning period
	// starts on 1 August and holds the current phase (from 1 September).
	oldPhase := *env.sourcePhase
	oldPhase.ID = 0
	oldPhase.Name = uniqueSchemaName("Schuljahr-alt-" + t.Name())
	oldPhase.ServiceStartDate = enrollmentTest.Date(calendar.NewDate(2025, 9, 1))
	oldPhase.ServiceEndDate = enrollmentTest.Date(calendar.NewDate(2026, 7, 31))
	require.NoError(t, testpkg.TenantCommand1(t, ctx, env.db, env.reposEnrollment.Enrollment().InsertPhase, &oldPhase))
	period := api.CreateCareOfferingCalendarPeriod(func(err error) { require.NoError(t, err) },
		testpkg.NewDatabase(t, env.db), ctx, testpkg.Tenant(t), uniqueSchemaName(t.Name()),
		calendar.NewDate(2026, 8, 1), calendar.Date(env.sourcePhase.ServiceEndDate).AddDays(31))

	current := createSourceOffering(t, env, "Randstunde", nil)
	expired := createSourceOffering(t, env, "Randstunde-alt", nil)
	_, err := env.db.NewRaw(`UPDATE enrollment.care_offerings SET phase_id = ?, name = ? WHERE id = ?`,
		oldPhase.ID, current.Name, expired.ID).Exec(ctx)
	require.NoError(t, err)
	template := createSourcedTemplate(t, env, "Randstunde", expired.ID, nil, period.ID)

	reader, ok := env.bookings.(careplan.OfferingSourceEditor)
	require.True(t, ok)
	maintenance := func() careplan.TemplateRosterMaintenance {
		t.Helper()
		stored, err := timetableCompose.NativeGroupRecords(testTimetableRepositories(env.db).Timetable).FindByID(ctx, template.ID)
		require.NoError(t, err)
		feeds, err := reader.TemplateRosterMaintenanceFeeds(ctx, []careplan.TemplateRosterFeedQuery{{
			TemplateID: template.ID, CalendarPeriodID: &period.ID, SourceCareOfferingIDs: stored.SourceCareOfferingIDs,
		}})
		require.NoError(t, err)
		return careplan.DeriveTemplateRosterMaintenance(careplan.TemplateRosterMaintenanceInput{
			SourceCareOfferingIDs: stored.SourceCareOfferingIDs,
			Feeds:                 feeds[template.ID],
		})
	}

	before := maintenance()
	assert.Equal(t, careplan.RosterMaintenanceManual, before.Mode)
	assert.Equal(t, []careplan.RosterMaintenanceExpiredOffering{{
		ID: expired.ID, Name: current.Name,
		Successor: &careplan.RosterMaintenanceOffering{ID: current.ID, Name: current.Name},
	}}, before.ExpiredOfferings, "the indicator names the old offering and suggests the new one")

	// A booking of the new offering does not reach the Regeltermin by
	// itself: nothing switches the source automatically.
	first, _ := submitAndApproveOfferingChild(t, env, current.ID, "expired-phase-a@example.com", "Ada", 2)
	assert.Empty(t, loadTemplateEnrollments(t, env, template.ID))
	assert.Equal(t, before.ExpiredOfferings, maintenance().ExpiredOfferings)

	// „Mit neuem Angebot verbinden“ stores the new source and resyncs, as
	// POST /templates/{id}/offering-connection does.
	template.SourceCareOfferingIDs = []int64{current.ID}
	require.NoError(t, timetableCompose.NativeGroupRecords(testTimetableRepositories(env.db).Timetable).Update(ctx, template))
	require.NoError(t, offeringResyncer(t, env).ResyncTemplateOfferingRoster(ctx, timetable.OfferingRosterResyncInput{
		TemplateID: template.ID, OfferingIDs: []int64{current.ID}, CalendarPeriodID: &period.ID, EffectiveFrom: offeringResyncToday,
	}))
	second, _ := submitAndApproveOfferingChild(t, env, current.ID, "expired-phase-b@example.com", "Ben", 2)

	planned := make([]int64, 0, 2)
	for _, row := range loadTemplateEnrollments(t, env, template.ID) {
		planned = append(planned, row.StudentID)
	}
	assert.ElementsMatch(t, []int64{first, second}, planned,
		"after connecting, the new offering's bookings reach the Regeltermin")
	after := maintenance()
	assert.Equal(t, careplan.RosterMaintenanceAutomatic, after.Mode)
	assert.Empty(t, after.ExpiredOfferings)
	assert.Empty(t, after.InvalidOfferings)
}
