package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	carePlanCompose "github.com/moto-ogs/project-phoenix/modules/careplan/compose"
	"github.com/moto-ogs/project-phoenix/modules/communication"
	communicationCompose "github.com/moto-ogs/project-phoenix/modules/communication/composition"
	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	"github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	settingsValues "github.com/moto-ogs/project-phoenix/modules/settings"
	settingsCompose "github.com/moto-ogs/project-phoenix/modules/settings/compose"
	observabilityCompose "github.com/moto-ogs/project-phoenix/observability/compose"
	deliveryPolicy "github.com/moto-ogs/project-phoenix/roots/communicationtest"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	portalCompose "github.com/moto-ogs/project-phoenix/workflows/parentportal/compose"
	parentHTTP "github.com/moto-ogs/project-phoenix/workflows/parentportal/http"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The guardians' portal answers through one catalog proxy that checks every
// answer against the contract (#2352). These tests drive the routes the
// other suites leave out through the /parent mount, on a real database with
// the root's ports for the account (profile, push, app usage, the bell), the
// Elternsprechtag, the messages and the news.

type parentPortalRoutes struct {
	*guardRig
	router chi.Router
}

func newParentPortalRoutes(t *testing.T, db *bun.DB) parentPortalRoutes {
	t.Helper()
	routes, _ := newParentPortalRoutesWithSurveys(t, db)
	return routes
}

// newParentPortalRoutesWithSurveys also answers the surveys that publish the
// Umfragen the parents answer in their feed.
func newParentPortalRoutesWithSurveys(t *testing.T, db *bun.DB) (parentPortalRoutes, communication.SurveyCapability) {
	t.Helper()
	database, unit := testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db)
	organizations, err := owners.NewOrganizationTenancy(database)
	require.NoError(t, err)
	settings, err := owners.NewSettingsTestModule(database, unit)
	require.NoError(t, err)
	// The guard rig's helpers, without its gates and its markers: every
	// owner command of these routes runs for real.
	rig := &guardRig{checked: newRequestGate(), guarded: newRequestGate(), locked: newLockGate(), settings: settings.Settings}
	surveys := newParentPortalSurveys(t, db, settings.Settings)
	rig.childReadRig = newChildReadRigOn(t, db, func(deps *portalCompose.Dependencies) {
		deps.Signatures = owners.ParentDeclarationSignatures{Ledger: owners.SignatureLedger()}
		_, schedules, _, _, _, _, err := NewTestCareRequests(database, slog.Default())
		require.NoError(t, err)
		deps.ArrivalSchedules = owners.NewParentArrivalSchedules(schedules.Arrivals)
		deps.PickupSchedules = owners.NewParentPickupSchedules(schedules.Pickups)
		composeParentMessaging(t, db, deps)
		composeParentDeclarations(t, db, deps)
		deps.Surveys = owners.BindParentSurveys(surveys)
		// The news and the school picker read the account's enrollments and
		// the open phases of every school, as the root binds them.
		rows := NewCarePlanSuiteRepositories(database).WithSchoolProjections(organizations)
		deps.EnrollmentRequestRepo = rows.ParentEnrollmentReads()
		deps.EnrollablePhaseRepo = owners.NewParentPhaseReads(carePlanCompose.NewParentPhaseQueries(rows.ParentEnrollablePhase))
		deps.EnrollmentSettings = settings.Settings
	})
	delivery, err := NewDeliveryTestModule(database, unit)
	require.NoError(t, err)
	// The test configuration carries no Web Push keys; the routes need a pair.
	delivery.PushSubscriptions, err = NewPushSubscriptionTestService(database, unit,
		deliveryCompose.VAPIDConfig{PublicKey: "pub", PrivateKey: "priv", Subscriber: "mailto:test@example.org"})
	require.NoError(t, err)
	identity, err := NewIdentityAccessForTests(database)
	require.NoError(t, err)
	usage, err := deliveryCompose.NewTenantPWAUsageService(unit, db, observabilityCompose.NewPWAStandaloneUsageRepository(db),
		noPWAUsageCounts{}, identity, settings.Settings, slog.Default(), rig.now)
	require.NoError(t, err)
	calendar, err := NewCalendarTestModule(database, unit)
	require.NoError(t, err)
	// The form of a phase loads through Enrollment's intake, as the root
	// binds it for the parents portal.
	enrollment, err := NewEnrollmentTestRepositories(database, owners.NewTestAuditStore(database))
	require.NoError(t, err)
	members := owners.MustNewMembershipTestRepositories(database)
	careRows, err := NewParentRouteTestRepositories(database, members)
	require.NoError(t, err)
	intake := owners.NewEnrollmentIntake(owners.EnrollmentIntakeSources{
		Now: rig.now, Requests: enrollment.Enrollment(), ParentChanges: enrollment.Enrollment(), Children: enrollment.Enrollment(),
		Guardians: enrollment.Enrollment(), Catalog: enrollment.Enrollment(), CareOfferingRepo: enrollmentCompose.NewCareOfferingRecords(careRows.CareExceptions),
		Settings: settings.Settings, ParentsURL: "http://parents.localhost:3000", Logger: slog.Default(),
	})
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Use(RequestSettingsCacheMiddleware, RequestIdentityCacheMiddleware)
	router.Mount("/parent", parentHTTP.NewResource(parentHTTP.ResourceConfig{
		Now: rig.now, Parent: rig.portal, Conferences: calendar.Calendar,
		Push: bindParentPushSubscriptions(delivery.PushSubscriptions), Preferences: bindParentPreferences(delivery.NotificationPreferences),
		Feed: bindParentNotificationFeed(delivery.GuardianFeed), PWAUsage: usage, SupportedLocale: bindParentLocale(delivery.NotificationPreferences),
		MessageAttachmentFiles: NewMemoryMessageAttachmentStorageForTests(),
		Enrollment:             enrollmentAPI.ParentForms{Requests: enrollmentAPI.NewRequestService(intake)},
		Schools:                parentSchoolDirectory{schools: organizations},
	}).Router(ParentSessionChain))
	return parentPortalRoutes{guardRig: rig, router: router}, surveys
}

// newParentPortalSurveys composes Communication's surveys over the parent
// announcements, as the root binds them for the parents' feed.
func newParentPortalSurveys(t *testing.T, db *bun.DB, settings settingsCompose.BatchSettingsService) communication.SurveyCapability {
	t.Helper()
	database := testpkg.NewDatabase(t, db)
	organizations, err := owners.NewOrganizationTenancy(database)
	require.NoError(t, err)
	repos := NewParentMessagingSuiteRepositories(database).WithSchoolProjections(organizations)
	objectBackend, err := objects.SealedPrivateUploadsBackend(objects.FileKeys{})
	require.NoError(t, err)
	files, _, err := NewFileStoreTestModule(database, testpkg.TenantRuntime(t, db), objectBackend)
	require.NoError(t, err)
	announcements, err := communicationCompose.NewParentAnnouncementsWithAttachments(communicationCompose.ParentAnnouncementConfig{
		Repo: repos.ParentAnnouncement, Settings: settingsValues.NewParentAnnouncementValues(settings), Logger: slog.Default(),
		SurveyStaff: repos.StaffMessageRead, Now: time.Now,
	}, files, owners.CommunicationRequestRuntime{}, deliveryPolicy.NewParentDeliveryPolicy())
	require.NoError(t, err)
	surveys, err := communication.SurveysOf(announcements)
	require.NoError(t, err)
	return surveys
}

// noPWAUsageCounts is the dashboard count a report does not read.
type noPWAUsageCounts struct{}

func (noPWAUsageCounts) PWAUsage(context.Context, int64, time.Duration) ([]deliveryCompose.PWAUsageRow, error) {
	return nil, nil
}

// call answers one request through the /parent mount and decodes its data.
func (r parentPortalRoutes) call(t *testing.T, method, path, token string, body, data any) *httptest.ResponseRecorder {
	t.Helper()
	rec := testutil.ExecuteRequest(r.router, testutil.NewAuthenticatedRequest(t, method, path, body, testutil.WithJWTBearer(token)))
	require.Less(t, rec.Code, 300, "%s %s: %s", method, path, rec.Body.String())
	if data != nil {
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope), rec.Body.String())
		require.NoError(t, json.Unmarshal(envelope.Data, data), rec.Body.String())
	}
	return rec
}

// A guardian reads the pages of a child: what the school allows, the weekly
// care plan, the courses, the pickup permissions and the Elternsprechtage.
func TestParentPortalChildPagesAnswerThroughTheParentMount(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	r := newParentPortalRoutes(t, db)
	f := r.family(t)
	r.set(t, map[string]any{"operations.parent_notes_enabled": true})

	var features parentHTTP.ChildFeaturesResponse
	r.call(t, http.MethodGet, childPath(f, "/features"), f.token, nil, &features)
	assert.True(t, features.NotesEnabled, "the school's setting reaches the child's page")

	r.set(t, map[string]any{"operations.parent_master_data_edit_enabled": true})
	var masterData parentHTTP.MasterDataResponse
	r.call(t, http.MethodPatch, childPath(f, "/master-data/student/health_info"), f.token, map[string]any{"value": "Allergie: Nüsse"}, &masterData)
	require.NotNil(t, masterData.HealthInfo)
	assert.Equal(t, "Allergie: Nüsse", *masterData.HealthInfo, "the direct edit is stored and shown")

	var schedule parentHTTP.CareScheduleResponse
	r.call(t, http.MethodGet, childPath(f, "/care-schedule"), f.token, nil, &schedule)
	assert.Len(t, schedule.Weekdays, 5, "Monday to Friday")

	var courses parentHTTP.CoursesResponse
	r.call(t, http.MethodGet, childPath(f, "/courses"), f.token, nil, &courses)
	assert.False(t, courses.Enabled, "the school offers no course requests")

	var pickups []json.RawMessage
	r.call(t, http.MethodGet, childPath(f, "/pickup-permission-requests"), f.token, nil, &pickups)
	assert.Empty(t, pickups)

	var conferences []json.RawMessage
	r.call(t, http.MethodGet, childPath(f, "/parent-conferences"), f.token, nil, &conferences)
	assert.Empty(t, conferences, "the child's class has no Elternsprechtag")
}

// The account's own routes: the language of the portal, the key of the push
// subscriptions, the report of the installed app and the bell.
func TestParentPortalAccountRoutesAnswerThroughTheParentMount(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	r := newParentPortalRoutes(t, db)
	f := r.family(t)

	var profile parentHTTP.ParentProfileResponse
	r.call(t, http.MethodPut, "/parent/me/profile", f.token, map[string]any{"portal_locale": "en"}, &profile)
	require.NotNil(t, profile.PortalLocale)
	assert.Equal(t, "en", *profile.PortalLocale)
	profile = parentHTTP.ParentProfileResponse{}
	r.call(t, http.MethodGet, "/parent/me/profile", f.token, nil, &profile)
	require.NotNil(t, profile.PortalLocale, "the chosen language is stored")
	assert.Equal(t, "en", *profile.PortalLocale)

	r.openEnrollment(t)
	var schools []parentHTTP.EnrollablePhaseResponse
	r.call(t, http.MethodGet, "/parent/me/enrollable-schools", f.token, nil, &schools)
	require.NotEmpty(t, schools, "the open phase of the child's school")
	assert.Equal(t, ident.ID(f.TenantID), schools[0].SchoolID)

	var key parentHTTP.PushPublicKeyResponse
	r.call(t, http.MethodGet, "/parent/me/push/public-key", f.token, nil, &key)
	assert.Equal(t, "pub", key.PublicKey)

	rec := r.call(t, http.MethodPost, "/parent/me/pwa-usage", f.token, nil, nil)
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Equal(t, int64(1), r.scalar(t, `SELECT count(*) FROM iot.pwa_standalone_usage WHERE account_id = ? AND tenant_id = ?`, f.AccountID, f.TenantID),
		"the app usage is recorded at the child's school")

	_, err := db.ExecContext(context.Background(), `INSERT INTO platform.notification_feed_entries
		(tenant_id, account_id, type, title, body, deep_link, related_type, related_id, student_ids)
		VALUES (?, ?, 'parent_care_cancelled', 'Fußball-AG fällt aus', 'Die AG am Dienstag fällt aus.', '/news', 'parent_announcement', 1, ARRAY[?]::bigint[])`,
		f.TenantID, f.AccountID, f.StudentID)
	require.NoError(t, err)
	var count struct {
		UnreadCount int `json:"unread_count"`
	}
	r.call(t, http.MethodGet, "/parent/me/notifications/feed/unread-count", f.token, nil, &count)
	assert.Equal(t, 1, count.UnreadCount)
}

// Messages and news: the conversations, the group threads, the news feed with
// its counter, read and acknowledged, and the proof of a declaration.
func TestParentPortalMessagesAndNewsAnswerThroughTheParentMount(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	r := newParentPortalRoutes(t, db)
	f := r.family(t)
	r.set(t, map[string]any{"operations.parent_notes_enabled": true})
	r.do(t, childWrite{http.MethodPost, fmt.Sprintf("/parent/me/messages/children/%d", f.StudentID), map[string]any{"body": "Felix kommt heute später."}}, f.token)

	var threads []parentHTTP.ThreadSummaryResponse
	r.call(t, http.MethodGet, "/parent/me/messages", f.token, nil, &threads)
	require.Len(t, threads, 1)
	assert.Equal(t, fmt.Sprint(f.StudentID), threads[0].StudentID.String())
	var unread parentHTTP.UnreadCountResponse
	r.call(t, http.MethodGet, "/parent/me/messages/unread-count", f.token, nil, &unread)
	assert.Zero(t, unread.UnreadCount, "the guardian's own message is no unread one")
	var groups []json.RawMessage
	r.call(t, http.MethodGet, "/parent/me/messages/group-threads", f.token, nil, &groups)
	assert.Empty(t, groups)

	letterID := r.letterToAcknowledge(t, f)
	var news []parentHTTP.AnnouncementResponse
	r.call(t, http.MethodGet, "/parent/me/news", f.token, nil, &news)
	require.Len(t, news, 1)
	r.call(t, http.MethodGet, "/parent/me/news/unread-count", f.token, nil, &unread)
	assert.Equal(t, 1, unread.UnreadCount)
	stamp := map[string]any{"published_at": news[0].PublishedAt}
	newsPath := fmt.Sprintf("/parent/me/news/%d", letterID)
	var read parentHTTP.AnnouncementReadResponse
	r.call(t, http.MethodPost, newsPath+"/read", f.token, stamp, &read)
	assert.True(t, read.Read)
	var acknowledged parentHTTP.AnnouncementAcknowledgedResponse
	r.call(t, http.MethodPost, newsPath+"/acknowledge", f.token, stamp, &acknowledged)
	assert.True(t, acknowledged.Acknowledged)
	r.call(t, http.MethodGet, "/parent/me/news/unread-count", f.token, nil, &unread)
	assert.Zero(t, unread.UnreadCount, "the read news item counts no more")

	declaration := r.declaration(t, f)
	r.do(t, declarationAnswer(f, declaration, "agreed"), f.token)
	var proof struct {
		Submissions []json.RawMessage `json:"submissions"`
	}
	r.call(t, http.MethodGet, fmt.Sprintf("/parent/me/news/%d/declaration/proof?student_id=%d", declaration.announcementID, f.StudentID), f.token, nil, &proof)
	assert.Len(t, proof.Submissions, 1, "the proof carries the guardian's answer")
}

// letterToAcknowledge publishes a letter to the family's child that the
// guardians have to confirm.
func (r parentPortalRoutes) letterToAcknowledge(t *testing.T, f childReadFamily) int64 {
	t.Helper()
	r.set(t, map[string]any{"operations.parent_news_enabled": true})
	fixtures := NewParentAnnouncementFixtures(NewParentMessagingSuiteRepositories(testpkg.NewDatabase(t, r.db)).ParentAnnouncement)
	ctx := tenant.WithTenantID(testpkg.WithTenantRuntime(t, context.Background(), r.db), f.TenantID)
	a := &ParentAnnouncementFixture{
		Title: "Elternabend", Body: "Der Elternabend ist am Donnerstag.", Priority: "info",
		RequiresAcknowledgement: true, Active: true, CreatedBy: f.AccountID,
	}
	a.TenantID = f.TenantID
	require.NoError(t, testpkg.TenantCommand1(t, ctx, r.db, fixtures.Create, a))
	require.NoError(t, testpkg.TenantCommand3(t, ctx, r.db, fixtures.ReplaceTargets, f.TenantID, a.ID,
		[]*ParentAnnouncementTargetFixture{{TargetType: "student", TargetRefID: &f.StudentID}}))
	published := r.now().Add(-time.Minute)
	require.NoError(t, testpkg.TenantCommand2(t, ctx, r.db, fixtures.SetPublished, a.ID, &published))
	return a.ID
}

// A guardian asks the OGS for a course and takes the request back (#3075):
// the course is an AG a care offering of the child's phase leads to.
func TestParentPortalCourseRequestIsWithdrawnThroughTheParentMount(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	r := newParentPortalRoutes(t, db)
	f := r.family(t)
	r.set(t, map[string]any{"enrollment.parent_course_requests_enabled": true})
	phase := r.scalar(t, `SELECT q.phase_id FROM enrollment.request_children AS c JOIN enrollment.requests AS q ON q.id = c.request_id
		WHERE c.created_student_id = ?`, f.StudentID)
	group := testpkg.CreateTestActivityGroup(t, db, fmt.Sprintf("Fußball-AG %d", testpkg.UniqueSuffix()))
	_, err := db.ExecContext(context.Background(), `UPDATE activities.groups SET type = 'activity' WHERE id = ?`, group.ID)
	require.NoError(t, err)
	course := testpkg.CreateTestCareOffering(t, db, phase, "Fußball")
	_, err = db.ExecContext(context.Background(), `UPDATE enrollment.care_offerings SET activity_group_id = ?, available_days = '["mon"]'::jsonb WHERE id = ?`, group.ID, course.ID)
	require.NoError(t, err)

	var requested parentHTTP.CoursesResponse
	r.call(t, http.MethodPost, childPath(f, "/courses/requests"), f.token, map[string]any{"course_id": fmt.Sprint(course.ID), "note": "Felix möchte Fußball spielen."}, &requested)
	require.Len(t, requested.Items, 1)
	request := r.scalar(t, `SELECT id FROM enrollment.offering_change_requests WHERE student_id = ? AND status = 'pending'`, f.StudentID)

	var withdrawn parentHTTP.CoursesResponse
	r.call(t, http.MethodPost, childPath(f, fmt.Sprintf("/courses/requests/%d/withdraw", request)), f.token, nil, &withdrawn)
	assert.Empty(t, withdrawn.PendingRequestID, "nothing waits any more")
	assert.Equal(t, "withdrawn", r.scalarText(t, `SELECT status FROM enrollment.offering_change_requests WHERE id = ?`, request))
}

func (r parentPortalRoutes) scalarText(t *testing.T, query string, args ...any) string {
	t.Helper()
	var value string
	require.NoError(t, r.db.NewRaw(query, args...).Scan(context.Background(), &value), query)
	return value
}

// A logged-in guardian loads the form of an open phase of the child's
// school; the school is named by its subdomain, as the enrollment links do.
func TestParentPortalEnrollmentFormLoadsThroughTheParentMount(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	r := newParentPortalRoutes(t, db)
	f := r.family(t)
	phase := r.scalar(t, `SELECT q.phase_id FROM enrollment.request_children AS c JOIN enrollment.requests AS q ON q.id = c.request_id
		WHERE c.created_student_id = ?`, f.StudentID)
	subdomain := r.scalarText(t, `SELECT subdomain FROM platform.schools WHERE id = ?`, f.TenantID)
	r.openEnrollment(t)

	var form struct {
		Phase struct {
			ID string `json:"id"`
		} `json:"phase"`
	}
	r.call(t, http.MethodGet, fmt.Sprintf("/parent/enrollments/%s/bootstrap/%d", subdomain, phase), f.token, nil, &form)
	assert.Equal(t, fmt.Sprint(phase), form.Phase.ID)
}

// openEnrollment books the online enrollment of the test's school and opens
// it; the form opens only with a privacy notice shown (#7176).
func (r parentPortalRoutes) openEnrollment(t *testing.T) {
	t.Helper()
	r.set(t, map[string]any{"module.online_anmeldung": true, "enrollment.legal_dsgvo_text": "Wir verarbeiten die Angaben zur Anmeldung."})
	r.set(t, map[string]any{"enrollment.legal_dsgvo_enabled": true})
	r.set(t, map[string]any{"enrollment.enabled": true})
}
