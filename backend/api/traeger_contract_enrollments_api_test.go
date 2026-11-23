package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	auditCompose "github.com/moto-ogs/project-phoenix/modules/auditlog/compose"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	careContractCompose "github.com/moto-ogs/project-phoenix/modules/carecontract/compose"
	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	enrollmentOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// The enrollment of the children of imported care contracts through its
// routes and the real composition (#7760, ADR 0309 section 4): import, link,
// preview, run, and what follows for care, contract and billing.

const (
	contractEnrollmentPath        = "/traeger/contract-enrollments/"
	contractEnrollmentPreviewPath = "/traeger/contract-enrollments/preview"
)

// contractEnrollmentDay is the day the plan, the school's enrollment and the
// amendment run on in these suites: a Monday within the service of the
// phase, after both contracts began.
func contractEnrollmentDay() calendar.Date { return calendar.NewDate(2027, time.September, 6) }

func contractEnrollmentNow() time.Time {
	return contractEnrollmentDay().BerlinMidnight().Add(10 * time.Hour)
}

type contractEnrollmentRowBody struct {
	ContractID    wireID `json:"contract_id"`
	SchoolID      wireID `json:"school_id"`
	Status        string `json:"status"`
	Reason        string `json:"reason"`
	Action        string `json:"action"`
	PhaseName     string `json:"phase_name"`
	ContractChild struct {
		FirstName string `json:"first_name"`
	} `json:"contract_child"`
	Student *struct {
		StudentID wireID `json:"student_id"`
		FirstName string `json:"first_name"`
		BirthDate string `json:"birth_date"`
	} `json:"student"`
	Bookings []struct {
		CareOfferingID wireID   `json:"care_offering_id"`
		Days           []string `json:"days"`
		ValidFrom      string   `json:"valid_from"`
		ValidUntil     string   `json:"valid_until"`
	} `json:"bookings"`
	RequestChildID wireID `json:"request_child_id"`
}

type contractEnrollmentBody struct {
	Fingerprint string `json:"fingerprint"`
	Changed     bool   `json:"changed"`
	Counts      struct {
		Ready, Done, Unlinked, Held, Stuck, Changed int
	} `json:"counts"`
	Rows []contractEnrollmentRowBody `json:"rows"`
}

func (b contractEnrollmentBody) row(t *testing.T, contractID int64) contractEnrollmentRowBody {
	t.Helper()
	for _, row := range b.Rows {
		if int64(row.ContractID) == contractID {
			return row
		}
	}
	require.Failf(t, "row missing", "contract %d", contractID)
	return contractEnrollmentRowBody{}
}

// contractEnrollmentFixture is a Träger whose school has a care offering
// that feeds a roster, three imported contracts (Mia from 1 August, Ben
// from 1 September, Ida from 1 August) and the child records of the three.
// Mia and Ben are linked to their child records; Ida is not.
type contractEnrollmentFixture struct {
	childLinkFixture
	benStudent, idaStudent int64
	ida                    int64
	group                  int64
	enroll                 http.Handler
	// afterSchoolList runs once after the workflow listed the schools of the
	// Träger: what an operator does between that check and the school's
	// tenant transaction.
	afterSchoolList *func()
}

// listedSchools is Organisation & Tenancy for the workflow, with a moment
// after the list of the Träger's schools.
type listedSchools struct {
	ContractEnrollmentOrganizations
	after *func()
}

func (s listedSchools) ListSchoolsByOrganization(ctx context.Context, organizationID int64) ([]organizationtenancy.School, error) {
	schools, err := s.ContractEnrollmentOrganizations.ListSchoolsByOrganization(ctx, organizationID)
	if after := *s.after; after != nil {
		*s.after = nil
		after()
	}
	return schools, err
}

func newContractEnrollmentFixture(t *testing.T, name string) contractEnrollmentFixture {
	t.Helper()
	f, _ := newContractEnrollmentFixtureWithAmendments(t, name)
	return f
}

// newContractEnrollmentFixtureWithAmendments is newContractEnrollmentFixture
// with the amendment that follows approved bookings (AmendFromBookings).
func newContractEnrollmentFixtureWithAmendments(t *testing.T, name string) (contractEnrollmentFixture, carecontract.Conclusion) {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	unit := testpkg.TenantRuntime(t, db)
	traeger := traegerPortalWithDaysOn(t, db, unit, owners.HolidayTestSchoolCalendar{}, contractEnrollmentDay, time.Now)
	office := newTraegerOffice(t, db, traeger, name, identityaccess.TraegerRoleAdministration)
	testpkg.OwnTraegerCareContracts(t, db, office.organization)
	school := office.schools[0]
	ctx := context.Background()
	var phaseID int64
	require.NoError(t, db.NewRaw(`INSERT INTO enrollment.phases (tenant_id, name, kind, service_start_date, service_end_date,
			care_overflow_mode, care_offering_selection_mode, is_active)
		VALUES (?, 'Schuljahr 2027/28', 'school_year', DATE '2027-08-01', DATE '2028-07-31', 'waitlist', 'optional', true) RETURNING id`,
		school).Scan(ctx, &phaseID))
	group := testpkg.CreateTestActivityGroupForTenant(t, db, school, "Ganztag")
	offering := &testpkg.CareOffering{PhaseID: phaseID, Name: "Offene Ganztagsschule", DaysOfWeekMode: "fixed",
		AvailableDays: []string{"mon", "tue", "wed"}, AutoAddGradeLevels: []int{}, IsActive: true, CountsAsCare: true,
		ActivityGroupID: &group.ID, PickupTimes: map[string]string{"mon": "14:00", "tue": "16:30", "wed": "16:30"}}
	offering.TenantID = school
	testpkg.InsertTestCareOffering(t, db, testpkg.TenantContext(school), offering)
	care := careContractFixture{reviewFixture: reviewFixture{holidayRegistrationFixture: holidayRegistrationFixture{db: db, traeger: traeger}, office: office},
		school: school, phase: phaseID, offering: offering.ID}
	setTraegerLetterhead(t, care.reviewFixture, traegerTestLetterhead)
	require.Equal(t, http.StatusOK, traegerJSON(t, traeger, office.token, http.MethodPut, templatePath(school, offering.ID), careContractTemplate).Code)
	rec := applyContractImport(t, care, office.token, "bestand.csv", contractImportFile(contractImportSchoolName(t, care),
		"Mia;Beispiel;03.05.2019;{school};Offene Ganztagsschule;01.08.2027;Eva Beispiel;eva.beispiel@example.org;",
		"Ben;Beispiel;11.11.2020;{school};Offene Ganztagsschule;01.09.2027;Eva Beispiel;eva.beispiel@example.org;",
		"Ida;Muster;07.02.2019;{school};Offene Ganztagsschule;01.08.2027;Erika Muster;erika.muster@example.org;"))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	imported := decodeSchoolPortalData[contractImportBody](t, rec.Body.Bytes())
	require.Equal(t, 3, imported.Counts.Imported, rec.Body.String())
	student := func(first, last, birthday string) int64 {
		record := testpkg.CreateTestStudentForTenant(t, db, school, first, last, "1a")
		_, err := db.ExecContext(ctx, `UPDATE users.persons SET birthday = ?::date WHERE id = ?`, birthday, record.PersonID)
		require.NoError(t, err)
		return record.ID
	}
	f := contractEnrollmentFixture{childLinkFixture: childLinkFixture{careContractFixture: care, mia: int64(imported.Rows[0].ContractID),
		ben: int64(imported.Rows[1].ContractID), miaStudent: student("Mia", "Beispiel", "2019-05-03")},
		ida: int64(imported.Rows[2].ContractID), benStudent: student("Ben", "Beispiel", "2020-11-11"),
		idaStudent: student("Ida", "Muster", "2019-02-07"), group: group.ID, afterSchoolList: new(func())}
	f.link(t, [2]int64{f.mia, f.miaStudent}, [2]int64{f.ben, f.benStudent})
	enroll, conclusion := contractEnrollmentRoutes(t, f, unit)
	f.enroll = enroll
	return f, conclusion
}

// link links contracts to child records through the file of the link
// (ADR 0307).
func (f contractEnrollmentFixture) link(t *testing.T, rows ...[2]int64) {
	t.Helper()
	file := childLinkFile(rows...)
	rec := importForm(t, f.traeger, f.office.token, childLinkPreviewPath, "k.csv", file, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	preview := decodeSchoolPortalData[childLinkingBody](t, rec.Body.Bytes())
	rec = importForm(t, f.traeger, f.office.token, childLinkPath, "k.csv", file, map[string]string{"fingerprint": preview.Fingerprint})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	require.Equal(t, len(rows), decodeSchoolPortalData[childLinkingBody](t, rec.Body.Bytes()).Counts.Stored, rec.Body.String())
}

// contractEnrollmentRoutes mounts /traeger/contract-enrollments as the
// serving root does, over the decision flow of the student graph, and
// composes the amendment that follows approved bookings.
func contractEnrollmentRoutes(t *testing.T, f contractEnrollmentFixture, unit tenant.UnitOfWork) (http.Handler, carecontract.Conclusion) {
	t.Helper()
	database := testpkg.NewDatabase(t, f.db)
	organizations, err := owners.NewOrganizationTenancy(database)
	require.NoError(t, err)
	audit, err := auditCompose.NewTenantPersistence(f.db, time.Now)
	require.NoError(t, err)
	feedback, err := NewFeedbackTestModule(database, unit)
	require.NoError(t, err)
	_, _, _, _, decisions, _, err := NewStudentTestModule(database, unit, feedback.Feedback, contractEnrollmentNow)
	require.NoError(t, err)
	schoolEnrollments, ok := decisions.(enrollmentOwner.ContractEnrollments)
	require.True(t, ok, "the decision flow serves the enrollment of contract children")
	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(tenant.WithUnitOfWork(r.Context(), unit)))
		})
	})
	require.NoError(t, mountContractEnrollmentRoutes(router, listedSchools{organizations, f.afterSchoolList}, schoolEnrollments, audit.DataAccessLog, contractEnrollmentDay, contractEnrollmentNow))

	settings, err := owners.BuildTraegerSettings(database, unit, slog.Default(), organizations, nil)
	require.NoError(t, err)
	schoolSettings, err := owners.NewSettingsTestModule(database, unit)
	require.NoError(t, err)
	delivery, err := deliveryCompose.NewModule(deliveryCompose.ModuleDependencies{
		DB: f.db, People: owners.EnrollmentFlowGuardianDirectory{}, Observe: func(deliveryContract.Observation) {},
	})
	require.NoError(t, err)
	contractPorts, intakePorts := careContractPorts(organizations, settings, schoolSettings.Settings, delivery.Module,
		providerBlockOutcomes{delivery.EmailOutcomes}, audit.DataAccessLog, owners.CareContractTestHolidays{}, "http://parents.localhost:3000", contractEnrollmentNow)
	return testpkg.SessionVerifier(router), careContractCompose.NewConclusion(contractPorts, intakePorts, contractEnrollmentNow)
}

func (f contractEnrollmentFixture) preview(t *testing.T) contractEnrollmentBody {
	t.Helper()
	rec := traegerJSON(t, f.enroll, f.office.token, http.MethodPost, contractEnrollmentPreviewPath, map[string]any{"school_id": f.school})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[contractEnrollmentBody](t, rec.Body.Bytes())
}

func (f contractEnrollmentFixture) run(t *testing.T, fingerprint string) *httptest.ResponseRecorder {
	t.Helper()
	return traegerJSON(t, f.enroll, f.office.token, http.MethodPost, contractEnrollmentPath, map[string]any{"school_id": f.school, "fingerprint": fingerprint})
}

// runPreviewed previews and runs what the preview shows.
func (f contractEnrollmentFixture) runPreviewed(t *testing.T) contractEnrollmentBody {
	t.Helper()
	rec := f.run(t, f.preview(t).Fingerprint)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[contractEnrollmentBody](t, rec.Body.Bytes())
}

func contractEnrollmentUnbindPath(contractID, requestChildID int64) string {
	return fmt.Sprintf("%s%d?request_child_id=%d", contractEnrollmentPath, contractID, requestChildID)
}

// silentSchoolTables are the rows of the school a run must leave as they
// are: the child records, persons, guardians, their relationships and
// accesses, accounts, invitations and everything that sends.
var silentSchoolTables = []string{
	"users.student_profiles", "users.student_school_memberships", "users.student_care_profiles", "users.persons",
	"users.guardian_profiles", "users.student_guardian_relationships", "auth.guardian_student_access", "auth.account_tenants",
	"auth.guardian_invitations", "auth.invitation_tokens", "platform.email_outbox", "platform.push_outbox",
}

func (f contractEnrollmentFixture) silentRows(t *testing.T) map[string]string {
	t.Helper()
	rows := make(map[string]string, len(silentSchoolTables))
	for _, table := range silentSchoolTables {
		var text string
		require.NoError(t, f.db.NewRaw(`SELECT COALESCE(string_agg(row.text, E'\n' ORDER BY row.text), '') FROM (
			SELECT t::text AS text FROM `+table+` AS t WHERE t.tenant_id = ?) AS row`, f.school).Scan(context.Background(), &text), table)
		rows[table] = text
	}
	return rows
}

// billed is what the Elternabrechnung reads of the contracts for the months
// from August to October 2027: each version in force with its services.
func (f contractEnrollmentFixture) billed(t *testing.T) string {
	t.Helper()
	var periods []carecontract.VersionPeriod
	ctx := tenant.WithUnitOfWork(context.Background(), testpkg.TenantRuntime(t, f.db))
	require.NoError(t, tenant.WithinTraeger(ctx, f.office.organization, func(ctx context.Context) error {
		var err error
		periods, err = careContractCompose.NewContractVersions().VersionsInForce(ctx, f.office.organization,
			calendar.NewDate(2027, time.August, 1), calendar.NewDate(2027, time.October, 31))
		return err
	}))
	encoded, err := json.Marshal(periods)
	require.NoError(t, err)
	return string(encoded)
}

// openCareMonth prices the module of the contracts and opens the monthly run
// of the Elternabrechnung for October 2027 as a colleague of the billing
// office; it answers that colleague's session and the run.
func (f contractEnrollmentFixture) openCareMonth(t *testing.T) (string, int64) {
	t.Helper()
	billing := traegerColleague(t, f.reviewFixture, identityaccess.TraegerRoleBilling)
	rec := traegerJSON(t, f.traeger, billing, http.MethodPut, numberRangesPath+"/care", map[string]any{"pattern": "MB-{JJJJ}-{NNNN}"})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	prices := []map[string]any{}
	for _, weekday := range []string{"mon", "tue", "wed"} {
		prices = append(prices, map[string]any{"care_offering_id": f.offering, "module_name": "Offene Ganztagsschule", "weekday": weekday, "monthly_cents": 3200})
	}
	rec = traegerJSON(t, f.traeger, billing, http.MethodPut, careTariffsPath, map[string]any{"school_id": f.school, "valid_from": "2027-08-01", "prices": prices})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rec = traegerJSON(t, f.traeger, billing, http.MethodPost, careRunsPath, map[string]any{"billing_month": "2027-10-01"})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	return billing, int64(decodeSchoolPortalData[careRunBody](t, rec.Body.Bytes()).ID)
}

// careMonth is what the open monthly run would charge: per contract its
// positions and its total, the bookings without a price and the children
// with two contracts.
func (f contractEnrollmentFixture) careMonth(t *testing.T, billing string, runID int64) (string, careRunBody) {
	t.Helper()
	rec := traegerJSON(t, f.traeger, billing, http.MethodGet, careRunPath(runID, ""), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	run := decodeSchoolPortalData[careRunBody](t, rec.Body.Bytes())
	charged := map[int64]any{}
	for _, invoice := range run.Invoices {
		charged[int64(invoice.ContractID)] = []any{invoice.TotalCents, invoice.Positions}
	}
	encoded, err := json.Marshal([]any{charged, run.PreviewCount, run.PreviewCents, len(run.Unpriced), run.DuplicateChildren})
	require.NoError(t, err)
	return string(encoded), run
}

func (f contractEnrollmentFixture) versions(t *testing.T, contractID int64) int {
	t.Helper()
	return f.count(t, `SELECT COUNT(*) FROM care_contract.contract_versions WHERE contract_id = ?`, contractID)
}

func (f contractEnrollmentFixture) silentRequests(t *testing.T) int {
	t.Helper()
	return f.count(t, `SELECT COUNT(*) FROM enrollment.requests WHERE tenant_id = ? AND submission_source = ?`, f.school,
		enrollmentOwner.RequestSourceContractImport)
}

// The acceptance case of #7760: an imported contract linked to its child
// record gets its enrollment and is bound to it. The preview shows the child
// of the contract beside the child record and writes nothing; the run takes
// only the confirmed preview. Afterwards the school has the child as an
// approved child with the bookings of the contract and its roster from the
// contract's first day, the contract follows its bookings without a new
// version, the Elternabrechnung reads what it read before, and nothing was
// sent. A second run does nothing twice, and an approved change of the
// bookings then makes version 2 like for any contract.
func TestContractEnrollmentEnrollsBindsAndKeepsCareContractAndBillingInStep(t *testing.T) {
	t.Parallel()
	f, conclusion := newContractEnrollmentFixtureWithAmendments(t, "Träger Anmeldung nachtragen")
	ctx := tenant.WithUnitOfWork(context.Background(), testpkg.TenantRuntime(t, f.db))
	// The real calculation of the Elternabrechnung, before anything runs:
	// each of the three contracts is charged its three weekdays once.
	billing, careRun := f.openCareMonth(t)
	charged, month := f.careMonth(t, billing, careRun)
	require.Len(t, month.Invoices, 3, charged)
	require.Equal(t, int64(3*3*3200), month.PreviewCents, charged)
	require.Zero(t, month.DuplicateChildren)
	effects, silent, billed := f.sideEffects(t), f.silentRows(t), f.billed(t)

	preview := f.preview(t)
	assert.Equal(t, 2, preview.Counts.Ready)
	assert.Equal(t, 1, preview.Counts.Unlinked)
	mia, ben := preview.row(t, f.mia), preview.row(t, f.ben)
	assert.Equal(t, "ready", mia.Status)
	assert.Equal(t, "enroll", mia.Action)
	assert.Equal(t, f.school, int64(mia.SchoolID))
	assert.Equal(t, "Schuljahr 2027/28", mia.PhaseName)
	assert.Equal(t, "Mia", mia.ContractChild.FirstName)
	require.NotNil(t, mia.Student, "the child record stands beside the child of the contract before anything runs")
	assert.Equal(t, f.miaStudent, int64(mia.Student.StudentID))
	assert.Equal(t, "2019-05-03", mia.Student.BirthDate)
	require.Len(t, mia.Bookings, 1)
	assert.Equal(t, f.offering, int64(mia.Bookings[0].CareOfferingID))
	assert.Equal(t, []string{"mon", "tue", "wed"}, mia.Bookings[0].Days)
	assert.Equal(t, "2027-08-01", mia.Bookings[0].ValidFrom)
	assert.Equal(t, "2028-08-01", mia.Bookings[0].ValidUntil, "the booking holds to the end of the phase, exclusive")
	require.Len(t, ben.Bookings, 1)
	assert.Equal(t, "2027-09-01", ben.Bookings[0].ValidFrom, "no child is booked before its contract")
	assert.Equal(t, "unlinked", preview.row(t, f.ida).Status)
	assert.Zero(t, f.silentRequests(t), "a preview enrolls nobody")
	assert.Zero(t, f.events(t, "bind_application"))
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM audit.data_access_log WHERE tenant_id = ? AND metadata->>'view' = 'contract_enrollment'
		AND metadata->'student_ids' @> ?::jsonb`, f.school, fmt.Sprintf("[%d,%d]", f.miaStudent, f.benStudent)), "the preview names the child records in the school's log")

	rec := f.run(t, "stale")
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "care_contract.enrollment_preview_changed")
	assert.Zero(t, f.silentRequests(t), "a run without the confirmed preview writes nothing")

	rec = f.run(t, preview.Fingerprint)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	run := decodeSchoolPortalData[contractEnrollmentBody](t, rec.Body.Bytes())
	assert.Equal(t, 2, run.Counts.Done)
	assert.True(t, run.Changed, "the run enrolled and bound: it counts as the core action")
	assert.Equal(t, "done", run.row(t, f.mia).Status)
	assert.Equal(t, "enroll", run.row(t, f.mia).Action)
	assert.Equal(t, "unlinked", run.row(t, f.ida).Status)
	miaChild, benChild := int64(run.row(t, f.mia).RequestChildID), int64(run.row(t, f.ben).RequestChildID)
	require.NotZero(t, miaChild)
	require.NotZero(t, benChild)

	// Care: the school has both as approved children of their child records,
	// with the bookings of the contract and the roster from its first day.
	var applications, ofMia, ofNobody []enrollmentOwner.ContractApplication
	schoolID, err := tenant.NewTenantID(f.school)
	require.NoError(t, err)
	require.NoError(t, tenant.WithinTenant(ctx, schoolID, func(ctx context.Context) error {
		read := enrollmentCompose.NewContractApplications(securityruntime.Fingerprint)
		var err error
		if applications, err = read.AcceptedContractApplications(ctx, []int64{miaChild, benChild}); err != nil {
			return err
		}
		if ofMia, err = read.AcceptedStudentApplications(ctx, []int64{f.miaStudent}); err != nil {
			return err
		}
		ofNobody, err = read.AcceptedStudentApplications(ctx, nil)
		return err
	}))
	require.Len(t, ofMia, 1, "the plan reads the applications of the linked child records only")
	assert.Equal(t, miaChild, ofMia[0].RequestChildID)
	assert.Empty(t, ofNobody, "no child record, no application: never the whole school")
	require.Len(t, applications, 2)
	accepted, madeFor := map[int64]int64{}, map[int64]int64{}
	for _, application := range applications {
		require.NotNil(t, application.StudentID)
		accepted[application.RequestChildID] = *application.StudentID
		require.NotNil(t, application.SourceContractID, "the enrollment names the contract it was made for")
		madeFor[application.RequestChildID] = *application.SourceContractID
		assert.Equal(t, enrollmentOwner.RequestSourceContractImport, application.Source)
		assert.Empty(t, application.GuardianEmail, "the enrollment names no parent")
	}
	assert.Equal(t, map[int64]int64{miaChild: f.miaStudent, benChild: f.benStudent}, accepted)
	assert.Equal(t, map[int64]int64{miaChild: f.mia, benChild: f.ben}, madeFor)
	bookings := `SELECT COUNT(*) FROM enrollment.care_offering_bookings WHERE tenant_id = ? AND request_child_id = ? AND care_offering_id = ?
		AND valid_from = ?::date AND valid_until = DATE '2028-08-01'`
	assert.Equal(t, 1, f.count(t, bookings, f.school, miaChild, f.offering, "2027-08-01"))
	assert.Equal(t, 1, f.count(t, bookings, f.school, benChild, f.offering, "2027-09-01"))
	rosters := `SELECT COUNT(*) FROM activities.student_enrollments WHERE tenant_id = ? AND student_id = ? AND activity_group_id = ?`
	assert.Equal(t, 1, f.count(t, rosters+` AND valid_from = DATE '2027-08-01'`, f.school, f.miaStudent, f.group))
	assert.Equal(t, 1, f.count(t, rosters+` AND valid_from = DATE '2027-09-01'`, f.school, f.benStudent, f.group),
		"the roster starts with the contract, not with the phase")
	assert.Zero(t, f.count(t, rosters, f.school, f.idaStudent, f.group), "a child without a linked contract is not enrolled")

	// Contract: bound, and the amendment that follows the bookings writes
	// nothing.
	bound := `SELECT COUNT(*) FROM care_contract.contracts WHERE id = ? AND request_child_id = ? AND import_origin IS NOT NULL`
	assert.Equal(t, 1, f.count(t, bound, f.mia, miaChild))
	assert.Equal(t, 1, f.count(t, bound, f.ben, benChild))
	assert.Equal(t, 2, f.events(t, "bind_application"))
	amended, err := conclusion.AmendFromBookings(ctx, f.office.organization)
	require.NoError(t, err)
	assert.Empty(t, amended.Amended, "the bookings are the contract: the amendment makes no version")
	assert.Equal(t, 1, f.versions(t, f.mia))
	assert.Equal(t, 1, f.versions(t, f.ben))

	// Billing and silence.
	assert.Equal(t, billed, f.billed(t), "the Elternabrechnung reads the same versions: nothing is charged twice")
	after, month := f.careMonth(t, billing, careRun)
	assert.Equal(t, charged, after, "the monthly run charges every contract the same positions and amounts as before the run")
	assert.Zero(t, month.DuplicateChildren, "the enrollment gives no child a second contract to charge")
	assert.Equal(t, effects, f.sideEffects(t), "a run sends nothing and starts no billing")
	assert.Equal(t, silent, f.silentRows(t), "child records, guardians, accounts, invitations and outboxes stay as they are")

	// A second run does nothing twice.
	again := f.runPreviewed(t)
	assert.Equal(t, 2, again.Counts.Done)
	assert.False(t, again.Changed, "a run that finds everything done changed nothing and is not counted")
	assert.Empty(t, again.row(t, f.mia).Action, "a contract that was bound before is done, not done again")
	assert.Equal(t, 2, f.silentRequests(t))
	assert.Equal(t, 2, f.events(t, "bind_application"))
	rec = f.run(t, preview.Fingerprint)
	assert.Equal(t, http.StatusConflict, rec.Code, "the preview of the first run is no longer the state of the school")

	// The link of a bound contract stays.
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodDelete, unlinkPath(f.mia, f.miaStudent), nil)
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "care_contract.child_link_bound")

	// The normal way: an approved change of the bookings makes version 2.
	late := &testpkg.CareOffering{PhaseID: f.phase, Name: "Spätbetreuung", DaysOfWeekMode: "fixed", AvailableDays: []string{"thu"},
		AutoAddGradeLevels: []int{}, IsActive: true, CountsAsCare: true, PickupTimes: map[string]string{"thu": "17:00"}}
	late.TenantID = f.school
	testpkg.InsertTestCareOffering(t, f.db, testpkg.TenantContext(f.school), late)
	_, err = f.db.ExecContext(ctx, `INSERT INTO enrollment.care_offering_bookings (tenant_id, request_child_id, care_offering_id,
			manual_selected_days, valid_from) VALUES (?, ?, ?, '[]'::jsonb, DATE '2027-10-01')`, f.school, miaChild, late.ID)
	require.NoError(t, err)
	amended, err = conclusion.AmendFromBookings(ctx, f.office.organization)
	require.NoError(t, err)
	require.Len(t, amended.Amended, 1, "a bound imported contract follows its bookings like any other")
	assert.Equal(t, f.mia, amended.Amended[0].ContractID)
	assert.Equal(t, 2, amended.Amended[0].VersionNumber)
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM care_contract.contract_versions WHERE contract_id = ? AND version_number = 2
		AND source = ? AND effective_from = DATE '2027-10-01'`, f.mia, carecontract.SourceBookingChange))
}

// The way back (ADR 0309 section 4): the office takes the application child
// it saw off a bound imported contract. The enrollment stays at the school;
// the contract is an imported one linked to its child record again, the
// next preview offers to bind it, and its link can be removed.
func TestContractEnrollmentBindingIsTakenOffAndSetAgain(t *testing.T) {
	t.Parallel()
	f := newContractEnrollmentFixture(t, "Träger Bindung lösen")
	run := f.runPreviewed(t)
	benChild := int64(run.row(t, f.ben).RequestChildID)
	effects := f.sideEffects(t)

	rec := traegerJSON(t, f.enroll, f.office.token, http.MethodDelete, contractEnrollmentUnbindPath(f.ben, benChild+1), nil)
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "care_contract.enrollment_binding_changed")
	rec = traegerJSON(t, f.enroll, f.office.token, http.MethodDelete, contractEnrollmentUnbindPath(f.ida, benChild), nil)
	assert.Equal(t, http.StatusConflict, rec.Code, "a contract that is not bound has no binding to take off")
	assert.Zero(t, f.events(t, "unbind"))

	rec = traegerJSON(t, f.enroll, f.office.token, http.MethodDelete, contractEnrollmentUnbindPath(f.ben, benChild), nil)
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM care_contract.contracts WHERE id = ? AND request_child_id IS NULL AND student_id = ?`,
		f.ben, f.benStudent), "the contract is unbound and still linked")
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM care_contract.contract_events WHERE contract_id = ? AND action = 'unbind'
		AND (details->>'request_child_id')::bigint = ?`, f.ben, benChild))
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM enrollment.request_children WHERE tenant_id = ? AND id = ? AND status = 'approved'`,
		f.school, benChild), "the enrollment stays at the school")
	assert.Equal(t, effects, f.sideEffects(t), "taking a binding off sends nothing")

	preview := f.preview(t)
	ben := preview.row(t, f.ben)
	assert.Equal(t, "ready", ben.Status)
	assert.Equal(t, "bind", ben.Action, "the next run binds the enrollment that exists; the child gets no second one")
	assert.Equal(t, benChild, int64(ben.RequestChildID))
	rec = f.run(t, preview.Fingerprint)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	again := decodeSchoolPortalData[contractEnrollmentBody](t, rec.Body.Bytes())
	assert.Equal(t, "done", again.row(t, f.ben).Status)
	assert.Equal(t, "bind", again.row(t, f.ben).Action)
	assert.Equal(t, 2, f.silentRequests(t), "nothing is enrolled twice")

	// Unbound, the link of part 1 can be corrected again.
	rec = traegerJSON(t, f.enroll, f.office.token, http.MethodDelete, contractEnrollmentUnbindPath(f.ben, benChild), nil)
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	// The school ends the stored bookings early: they are no longer the
	// contract's. The row hangs on the enrollment that was made for it.
	_, err := f.db.ExecContext(context.Background(), `UPDATE enrollment.care_offering_bookings SET valid_until = DATE '2027-12-01'
		WHERE tenant_id = ? AND request_child_id = ?`, f.school, benChild)
	require.NoError(t, err)
	stuck := f.preview(t).row(t, f.ben)
	assert.Equal(t, "stuck", stuck.Status)
	assert.Equal(t, benChild, int64(stuck.RequestChildID), "the stuck row names the enrollment of its own contract")
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodDelete, unlinkPath(f.ben, f.benStudent), nil)
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	assert.Equal(t, "unlinked", f.preview(t).row(t, f.ben).Status)
}

// The routes need the right "Verträge verwalten" and a school of the Träger.
func TestContractEnrollmentNeedsTheRightAndASchoolOfTheTraeger(t *testing.T) {
	t.Parallel()
	f := newContractEnrollmentFixture(t, "Träger Anmeldung Recht")
	billing := traegerColleague(t, f.reviewFixture, identityaccess.TraegerRoleBilling)
	body := map[string]any{"school_id": f.school, "fingerprint": "x"}
	assert.Equal(t, http.StatusForbidden, traegerJSON(t, f.enroll, billing, http.MethodPost, contractEnrollmentPreviewPath, body).Code)
	assert.Equal(t, http.StatusForbidden, traegerJSON(t, f.enroll, billing, http.MethodPost, contractEnrollmentPath, body).Code)
	assert.Equal(t, http.StatusForbidden, traegerJSON(t, f.enroll, billing, http.MethodDelete, contractEnrollmentUnbindPath(f.mia, 1), nil).Code)

	other := newTraegerOffice(t, f.db, f.traeger, "Träger Anmeldung Fremd", identityaccess.TraegerRoleAdministration)
	foreign := map[string]any{"school_id": other.schools[0], "fingerprint": "x"}
	for _, path := range []string{contractEnrollmentPreviewPath, contractEnrollmentPath} {
		rec := traegerJSON(t, f.enroll, f.office.token, http.MethodPost, path, foreign)
		require.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		assert.Contains(t, rec.Body.String(), "care_contract.school_outside_traeger")
	}
	rec := traegerJSON(t, f.enroll, other.token, http.MethodPost, contractEnrollmentPreviewPath, body)
	assert.Equal(t, http.StatusForbidden, rec.Code, "another Träger does not preview this school")
	rec = traegerJSON(t, f.enroll, other.token, http.MethodDelete, contractEnrollmentUnbindPath(f.mia, 1), nil)
	assert.Equal(t, http.StatusNotFound, rec.Code, "another Träger does not find this contract")
	rec = traegerJSON(t, f.enroll, f.office.token, http.MethodPost, contractEnrollmentPreviewPath, map[string]any{})
	assert.Equal(t, http.StatusBadRequest, rec.Code, "a preview names its school")
	assert.Zero(t, f.silentRequests(t))

	// An operator gives the school to the other Träger while a request is
	// under way: after the list of the Träger's schools, before the school's
	// tenant transaction. That transaction is scoped by the school alone, so
	// the workflow holds the school there and refuses.
	preview := f.preview(t)
	require.Equal(t, 2, preview.Counts.Ready)
	accessed := `SELECT COUNT(*) FROM audit.data_access_log WHERE tenant_id = ? AND metadata->>'view' = 'contract_enrollment'`
	before := f.count(t, accessed, f.school)
	for _, path := range []string{contractEnrollmentPreviewPath, contractEnrollmentPath} {
		*f.afterSchoolList = func() {
			_, err := f.db.ExecContext(context.Background(), `UPDATE platform.schools SET organization_id = ? WHERE id = ?`, other.organization, f.school)
			require.NoError(t, err)
		}
		rec := traegerJSON(t, f.enroll, f.office.token, http.MethodPost, path, map[string]any{"school_id": f.school, "fingerprint": preview.Fingerprint})
		require.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		assert.Contains(t, rec.Body.String(), "care_contract.school_outside_traeger")
		_, err := f.db.ExecContext(context.Background(), `UPDATE platform.schools SET organization_id = ? WHERE id = ?`, f.office.organization, f.school)
		require.NoError(t, err)
	}
	assert.Zero(t, f.silentRequests(t), "the former Träger enrolls nobody")
	assert.Equal(t, before, f.count(t, accessed, f.school), "and reads nothing of the school")
}

// contractEnrollmentResidual is what one more child adds to a run through
// the route: the statements of Care Plan's building blocks of an approval
// per child (bookings 3, the roster of the directly linked offering with
// its occurrences 11, multi-source rosters 4) and the resync of its pickup
// auto excusals without a coming pickup exception (2). ADR 0309 section 2
// documents this residual; everything else of a run is flat.
const contractEnrollmentResidual = 20

// The preview reads the same statements for any number of contracts, and a
// run grows per enrolled child only by the documented residual of Care
// Plan's per-child building blocks.
func TestContractEnrollmentQueryBudgets(t *testing.T) {
	t.Parallel()
	f := newContractEnrollmentFixture(t, "Träger Anmeldung Budget")
	// One linked contract first: Ben is taken off again.
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodDelete, unlinkPath(f.ben, f.benStudent), nil)
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	measure := func(path string, body map[string]any) (testpkg.QueryMeasurement, contractEnrollmentBody) {
		payload, err := json.Marshal(body)
		require.NoError(t, err)
		counter := testpkg.CaptureQueriesForContext(t, f.db)
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+f.office.token)
		testpkg.MeasuredHTTPRequest(counter, f.enroll, recorder, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
		return counter.Measurement(counter.Queries()), decodeSchoolPortalData[contractEnrollmentBody](t, recorder.Body.Bytes())
	}
	school := map[string]any{"school_id": f.school}
	onePreview, preview := measure(contractEnrollmentPreviewPath, school)
	require.Equal(t, 1, preview.Counts.Ready)
	oneRun, run := measure(contractEnrollmentPath, map[string]any{"school_id": f.school, "fingerprint": preview.Fingerprint})
	require.Equal(t, 1, run.Counts.Done)

	f.link(t, [2]int64{f.ben, f.benStudent}, [2]int64{f.ida, f.idaStudent})
	twoPreview, preview := measure(contractEnrollmentPreviewPath, school)
	require.Equal(t, 2, preview.Counts.Ready)
	assert.Len(t, twoPreview.Statements, len(onePreview.Statements), "the preview reads the same statements for any number of contracts")
	twoRun, run := measure(contractEnrollmentPath, map[string]any{"school_id": f.school, "fingerprint": preview.Fingerprint})
	require.Equal(t, 3, run.Counts.Done)
	assert.Equal(t, contractEnrollmentResidual, len(twoRun.Statements)-len(oneRun.Statements),
		"one more child adds exactly Care Plan's per-child statements of an approval (ADR 0309 section 2)")

	querybudgets.AssertQueryBudget(t, "api.traeger.contract_enrollments.preview", onePreview)
	querybudgets.AssertQueryBudget(t, "api.traeger.contract_enrollments.run", oneRun)
}
