package api

import (
	"context"
	"fmt"
	"log/slog"
	"testing"

	email "github.com/moto-ogs/project-phoenix/modules/delivery/mail"
	peopleValues "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	workforceCompose "github.com/moto-ogs/project-phoenix/modules/workforce/compose"
	"github.com/moto-ogs/project-phoenix/realtime"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// settleMail moves the outbox entries of one related entity to a reported
// outcome, the way the provider's events do.
func settleWorkforceMail(t *testing.T, db *bun.DB, relatedType string, relatedID int64, deliveryState string) {
	t.Helper()
	_, err := db.NewRaw(`UPDATE platform.email_outbox SET status = 'sent', sent_at = now(), delivery_state = ?, delivery_state_at = now()
		WHERE related_entity_type = ? AND related_entity_id = ?`, deliveryState, relatedType, relatedID).Exec(testpkg.Ctx(t))
	require.NoError(t, err)
}

// Both sides of an absence request see what became of its mails (#7058): the
// applicant the notice of the latest round to the Leitung, the Leitung the
// newest decision mail. Real decisions, real outbox, real outcome read.
func TestAbsenceMailsShowWhatBecameOfThem(t *testing.T) {
	t.Parallel()
	testpkg.OwnTenant(t)
	db, ctx, outbox := mailTransactionFixture(t)
	database := testpkg.NewDatabase(t, db)
	members := owners.MustNewMembershipTestRepositories(database)
	rows, err := NewWorkSessionTestRepositoriesWithMembers(database, members)
	require.NoError(t, err)
	timetable, err := owners.NewTimetableTestRepositoriesWithMembers(database, members)
	require.NoError(t, err)
	presence, err := NewTimetablePresenceRows(database, timetable, members)
	require.NoError(t, err)
	settings, err := owners.NewSettingsTestModule(database, testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	people, err := NewRFIDTestPeople(database)
	require.NoError(t, err)
	requester, requesterAccount := testpkg.CreateTestStaffWithAccount(t, db, "Mail", "Requester")
	approver, approverAccount := testpkg.CreateTestStaffWithAccount(t, db, "Mail", "Approver")
	contacts := absenceMailContacts{
		requester: workforceCompose.AbsenceEmailContact{StaffID: requester.ID, FirstName: "Mail", LastName: "Requester", Email: requesterAccount.Email},
		approver:  workforceCompose.AbsenceEmailContact{StaffID: approver.ID, FirstName: "Mail", LastName: "Approver", Email: approverAccount.Email},
	}
	audits := owners.NewTestAuditPersistence(database, nil)
	service, err := newTimeTrackingTestModule(database, rows, members.Staff, presence, settings.Settings, timeTrackingTestGraph{
		Audits: owners.TimeTrackingAudits{WorkSessionEdit: audits.WorkSessionEdit, TimeTrackingDeletion: audits.TimeTrackingDeletion, DataAccessLog: audits.DataAccessLog, TimeTrackingAuditLog: audits.TimeTrackingAuditLog},
		Events: owners.TimeTrackingEvents(realtime.NewHub(slog.Default())), People: people, Holidays: noHolidays{}, StatutoryHolidays: noHolidays{}, Logger: slog.Default(),
		MailOutcomes: owners.WorkforceMails{Outcomes: outbox.Runtime.EmailOutcomes},
	}, &workforceCompose.AbsenceEmailDeps{Settings: absenceMailEnabled{}, Dispatcher: owners.AbsenceEmailDispatcher{Durable: outbox, From: email.NewEmail("moto", "no-reply@example.test")},
		StaffRepo: contacts, SchoolRepo: absenceMailSchool{}, FrontendURL: "http://localhost:3000", Logger: slog.Default(),
	})
	require.NoError(t, err)
	// The status the time tracking composes over the same outbox.
	status := service.AbsenceMails
	require.NotNil(t, status)

	var absenceID int64
	day := calendar.NewDate(2099, 2, 3)
	require.NoError(t, db.NewRaw(`INSERT INTO active.staff_absences (tenant_id, staff_id, absence_type, date_start, date_end, status, created_by, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW()) RETURNING id`,
		testpkg.Tenant(t), requester.ID, workforce.AbsenceTypeOther, day, day, workforce.AbsenceStatusQuestion, requester.ID).Scan(ctx, &absenceID))
	inTenant := func(fn func(context.Context) error) {
		t.Helper()
		require.NoError(t, inSchool(ctx, db, testpkg.Tenant(t), fn))
	}
	read := func(tenantCtx func(func(context.Context) error)) (map[int64]map[string]int, map[int64]string) {
		t.Helper()
		var requests map[int64]map[string]int
		var decisions map[int64]string
		tenantCtx(func(txCtx context.Context) error {
			var err error
			if requests, err = status.AbsenceRequestMails(txCtx, []int64{absenceID}); err != nil {
				return err
			}
			decisions, err = status.AbsenceDecisionMails(txCtx, []int64{absenceID})
			return err
		})
		return requests, decisions
	}

	// First round: the answer to a question tells the Leitung; the mail bounces.
	inTenant(func(txCtx context.Context) error {
		_, err := service.StaffAbsences.ResubmitAbsence(txCtx, requester.ID, requesterAccount.ID, absenceID, "Erste Antwort")
		return err
	})
	settleWorkforceMail(t, db, workforce.AbsenceMailRequestReceived, absenceID, "failed")
	requests, decisions := read(inTenant)
	require.Equal(t, map[int64]map[string]int{absenceID: {"undeliverable": 1}}, requests)
	require.Empty(t, decisions, "no decision yet")

	// The Leitung asks again, the applicant answers: only the new round counts.
	inTenant(func(txCtx context.Context) error {
		_, err := service.StaffAbsences.QuestionAbsence(txCtx, absenceID, approverAccount.ID, "Welche Tage genau?")
		return err
	})
	inTenant(func(txCtx context.Context) error {
		_, err := service.StaffAbsences.ResubmitAbsence(txCtx, requester.ID, requesterAccount.ID, absenceID, "Zweite Antwort")
		return err
	})
	requests, decisions = read(inTenant)
	require.Equal(t, map[int64]map[string]int{absenceID: {"queued": 1}}, requests, "the bounced first round is history")
	require.Equal(t, map[int64]string{absenceID: "queued"}, decisions, "the question mail")

	// The approval mail replaces the question and reaches the applicant.
	inTenant(func(txCtx context.Context) error {
		_, _, err := service.StaffAbsences.ApproveAbsence(txCtx, absenceID, approverAccount.ID, approver.ID, "Passt")
		return err
	})
	settleWorkforceMail(t, db, workforce.AbsenceMailRequestApproved, absenceID, "delivered")
	_, decisions = read(inTenant)
	require.Equal(t, map[int64]string{absenceID: "delivered"}, decisions)

	// Another school reads none of it.
	foreign, _ := testpkg.CreateTestTenant(t, db)
	requests, decisions = read(func(fn func(context.Context) error) {
		require.NoError(t, inSchool(testpkg.WithTenantRuntime(t, testpkg.TenantContext(foreign), db), db, foreign, fn))
	})
	require.Empty(t, requests)
	require.Empty(t, decisions)
}

type payrollMailTestExport struct{}

func (payrollMailTestExport) ExportStaffTime(_ context.Context, request workforce.TimeExportRequest, _ int64, _ string) (*workforce.ExportFile, error) {
	return &workforce.ExportFile{Data: []byte("Zeiten"), Filename: "zeiterfassung_alle." + request.Format, ContentType: "text/csv"}, nil
}

func (payrollMailTestExport) DatevReport(context.Context, workforce.TimeExportRequest) (*workforce.DatevExportReport, error) {
	return &workforce.DatevExportReport{}, nil
}

type payrollMailTestManagers struct {
	rows []*peopleValues.StaffWithRoleInfo
}

func (m payrollMailTestManagers) ListStaffWithPermission(context.Context, string) ([]*peopleValues.StaffWithRoleInfo, error) {
	return m.rows, nil
}

// /payroll shows whether the link mail reached the Lohnbüro and what became of
// the notices to the managers (#7058), from the dispatch's real mails.
func TestPayrollDispatchShowsWhatBecameOfItsMails(t *testing.T) {
	t.Parallel()
	testpkg.OwnTenant(t)
	// The overview's budget counts statements: no other test shares the clone.
	testpkg.SetupIsolatedTestDB(t)
	db, ctx, outbox := mailTransactionFixture(t)
	database := testpkg.NewDatabase(t, db)
	settings, err := owners.NewSettingsTestModule(database, testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	organizations, err := owners.NewOrganizationTenancy(database)
	require.NoError(t, err)
	transfer, err := owners.BuildExportTransfer(settings.Settings, database, slog.Default())
	require.NoError(t, err)
	managers := payrollMailTestManagers{rows: []*peopleValues.StaffWithRoleInfo{
		{StaffID: 1, FirstName: "Lea", LastName: "Leitung", Email: fmt.Sprintf("lea-%d@example.test", testpkg.UniqueSuffix())},
		{StaffID: 2, FirstName: "Max", LastName: "Leitung", Email: fmt.Sprintf("max-%d@example.test", testpkg.UniqueSuffix())},
	}}
	dispatch, err := owners.BuildPayrollDispatch(database, settings.Settings, payrollMailTestExport{}, transfer, outbox,
		email.NewEmail("moto", "no-reply@example.test"), nil, organizations, managers, "https://moto.example", slog.Default())
	require.NoError(t, err)
	testpkg.SetTestTenantSetting(t, db, testpkg.Tenant(t), "payroll.dispatch_auto", `true`)
	testpkg.SetTestTenantSetting(t, db, testpkg.Tenant(t), "payroll.dispatch_channel", `"email"`)
	testpkg.SetTestTenantSetting(t, db, testpkg.Tenant(t), "payroll.dispatch_format", `"csv"`)
	overview := func() workforce.PayrollDispatchOverview {
		t.Helper()
		var out workforce.PayrollDispatchOverview
		require.NoError(t, inSchool(ctx, db, testpkg.Tenant(t), func(txCtx context.Context) error {
			var err error
			out, err = dispatch.Overview(txCtx)
			return err
		}))
		require.NotNil(t, out.Latest)
		return out
	}
	closeMonth := func(month int) {
		t.Helper()
		require.NoError(t, inSchool(ctx, db, testpkg.Tenant(t), func(txCtx context.Context) error {
			return dispatch.QueueAfterMonthClose(txCtx, workforce.PayrollDispatchTrigger{Year: 2026, Month: month, ClosedStaff: 3, ActorAccountID: 1, ActorName: "Lea Leitung"})
		}))
	}

	// Without the Lohnbüro's address the dispatch is blocked and both
	// managers get a notice; there is no link mail.
	testpkg.SetTestTenantSetting(t, db, testpkg.Tenant(t), "payroll.dispatch_email", `""`)
	closeMonth(8)
	blocked := overview().Latest
	require.Equal(t, workforce.PayrollDispatchBlocked, blocked.State)
	require.Empty(t, blocked.LinkMail)
	require.Equal(t, map[string]int{"queued": 2}, blocked.NoticeMails)

	// With it the worker mails the link; the Lohnbüro's server refuses it.
	testpkg.SetTestTenantSetting(t, db, testpkg.Tenant(t), "payroll.dispatch_email", `"lohn@example.test"`)
	closeMonth(9)
	_, err = dispatch.RunDue(ctx)
	require.NoError(t, err)
	mailed := overview().Latest
	require.Equal(t, 9, mailed.Month)
	require.Equal(t, "queued", mailed.LinkMail)
	require.Empty(t, mailed.NoticeMails)
	var dispatchID int64
	require.NoError(t, db.NewRaw(`SELECT related_entity_id FROM platform.email_outbox WHERE tenant_id = ? AND related_entity_type = 'payroll_export_link'`, testpkg.Tenant(t)).Scan(ctx, &dispatchID))
	settleWorkforceMail(t, db, "payroll_export_link", dispatchID, "failed")

	counter := testpkg.CaptureQueries(t, db)
	refused := overview().Latest
	counter.Stop()
	require.Equal(t, "undeliverable", refused.LinkMail)
	querybudgets.AssertQueryBudget(t, "workforce.payroll_dispatch.overview", counter.Measurement(counter.Queries()))
}

// inSchool runs fn in a transaction of the school.
func inSchool(ctx context.Context, db *bun.DB, tenantID int64, fn func(context.Context) error) error {
	return tenant.WithTenantTx(ctx, db, tenantID, func(txCtx context.Context, _ bun.Tx) error { return fn(txCtx) })
}
