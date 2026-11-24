package enrollmenthttp_test

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	nativeUploads "github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	transactionFailures "github.com/moto-ogs/project-phoenix/modules/transactionruntime"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// contractConditions is the school's own consent to the contract
// conditions, the block the Betreuungsvertrag reads as proof (#4680).
const contractConditions = "Vertragsbedingungen für die Betreuung\nLaufzeit:\n  bis zum Ende des Schuljahres"

// consentEditNow is the fixed clock of the intake in these tests, a
// Wednesday 10:00 in Berlin inside the phase's service year (#7104).
var consentEditNow = calendar.NewDate(2026, time.November, 18).BerlinMidnight().Add(10 * time.Hour)

// setupContractConsentTest builds one school whose form asks for the
// school's own, required consent to the contract conditions, with the
// public intake and the parents' edit behind the real routes.
func setupContractConsentTest(t *testing.T, tenantID int64) (*signatureEnv, int64) {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	testpkg.EnsureTestTenant(t, db, tenantID)
	ctx := testpkg.TenantContext(tenantID)
	repos, err := api.NewEnrollmentTestRepositories(testpkg.NewDatabase(t, db), owners.NewTestAuditStore(testpkg.NewDatabase(t, db)))
	require.NoError(t, err)
	reposCare := api.NewEnrollmentCarePlanRows(testpkg.NewDatabase(t, db))
	reposSchools := api.NewOrganizationTestRows(testpkg.NewDatabase(t, db))
	settings := stubTakeoverSettings{}

	_, author := testpkg.CreateTestPersonWithAccount(t, db, "Clara", "Vertrag")
	schema, err := testpkg.TenantQuery5(t, ctx, db, NewTestFormSchemas(repos.Enrollment()).CreateSchemaWithLegal,
		"Formular mit Vertrag "+t.Name(), []capability.FormField(nil), author.ID, capability.CoreRequirements{},
		[]capability.FormLegalBlock{{Key: "care_contract", Kind: capability.LegalBlockKindTerms, Title: "Betreuungsvertrag",
			Label: "Ich stimme den Vertragsbedingungen zu.", Text: contractConditions, Required: true, Enabled: true,
			Source: capability.LegalBlockSourceCustom}})
	require.NoError(t, err)
	phase := &capability.Phase{
		Name: "contract-" + t.Name(), Kind: capability.PhaseKindSchoolYear,
		ServiceStartDate: capability.Date(calendar.NewDate(2026, 9, 1)),
		ServiceEndDate:   capability.Date(calendar.NewDate(2027, 7, 31)),
		IsActive:         true, FormSchemaID: &schema.ID, CareOverflowMode: capability.PhaseCareOverflowWaitlist,
	}
	phase.TenantID = tenantID
	require.NoError(t, testpkg.TenantCommand1(t, ctx, db, repos.Enrollment().InsertPhase, phase))

	offerings := enrollmentCompose.NewCareOfferingRecords(reposCare.CarePlan)
	requests := newFixtureRequestRoot(owners.NewEnrollmentIntake(owners.EnrollmentIntakeSources{
		Requests: repos.Enrollment(), ParentChanges: repos.Enrollment(), Children: repos.Enrollment(), Guardians: repos.Enrollment(),
		CareOfferingRepo: offerings, Capacity: owners.NewEnrollmentOfferingCapacity(offerings, repos.Enrollment(), settings, calendar.TodayDate),
		Catalog: repos.Enrollment(), SchoolRepo: capabilitySchools{schools: reposSchools.School},
		Notifications: NewTestNotifications(repos.Enrollment(), notifyModeSettings{settings: settings}, discardingOutbox{}, capabilitySchools{schools: reposSchools.School}),
		RateLimitRepo: repos.Enrollment(), OutboxEnqueuer: discardingOutbox{}, Settings: settings,
		FrontendURL: "http://localhost:3000", ParentsURL: "http://parents.localhost:3000", Logger: slog.Default(),
		Now: func() time.Time { return consentEditNow },
	}))
	resource := enrollmentAPI.NewResource(
		nil, nil, requests, nil, nil, nil, nil, nil, nil,
		nil, nil, nil,
		nativeUploads.UploadFiles{}, enrollmentAPI.DatabaseFailures{Transient: transactionFailures.IsTransientDatabaseError, Constraint: transactionFailures.IsConstraintViolation}, func() time.Time { return consentEditNow })
	return &signatureEnv{
		db: db, router: testpkg.TenantRuntimeMiddleware(t, db)(resource.Router(api.TenantSessionChain)),
		tenantID: tenantID, phaseID: phase.ID, requests: requests,
	}, schema.ID
}

// TestContractConsentSurvivesTheParentsEdit: parents agree to the contract
// conditions, edit their enrollment on the edit page and the school accepts
// it afterwards. The Betreuungsvertrag must still read the agreement as
// proof, so Weg b concludes the contract (#4680). The edit page sends the
// form version and the terms_fingerprint it showed, like the enrollment
// form; an edit without them proves nothing and is refused (ADR 0311).
func TestContractConsentSurvivesTheParentsEdit(t *testing.T) {
	t.Parallel()
	for name, version := range map[string]string{"edit page names its version": "shown", "outdated edit page": ""} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			env, schemaID := setupContractConsentTest(t, testpkg.UniqueTestTenantID(t))
			ctx := testpkg.TenantContext(env.tenantID)
			submitted, err := env.requests.Submit(ctx, enrollmentAPI.SubmitRequest{
				TenantID: env.tenantID, PhaseID: env.phaseID, DisplayedFormSchemaID: schemaID,
				GuardianFirstName: "Erika", GuardianLastName: "Muster", GuardianEmail: "erika.muster@example.com",
				ConsentFlags: testFormValues(map[string]any{"agb": true, "data_processing": true, "email_contact": true, "care_contract": true}),
				Children: []enrollmentAPI.SubmitChild{{
					FirstName: "Lina", LastName: "Muster", DateOfBirth: calendar.NewDate(2018, 4, 15), TargetGradeLevel: testpkg.Int16Ptr(1),
				}},
			})
			require.NoError(t, err)
			require.Len(t, submitted.Children, 1)
			childID := submitted.Children[0].ID

			formVersion := ""
			if version != "" {
				formVersion = `"form_schema_id":"` + strconv.FormatInt(schemaID, 10) + `",`
			}
			edit := `{"phase_id":"` + strconv.FormatInt(env.phaseID, 10) + `",` + formVersion +
				`"guardian_first_name":"Erika","guardian_last_name":"Muster-Berg","guardian_email":"erika.muster@example.com",` +
				`"consent_flags":{"agb":true,"data_processing":true,"email_contact":true,"care_contract":true},` +
				`"children":[{"id":"` + strconv.FormatInt(childID, 10) + `","first_name":"Lina","last_name":"Muster","date_of_birth":"2018-04-15","target_grade_level":1}]}`
			if version == "" {
				// An edit page read before the school changed its form proves
				// no agreement to the form in force: it is refused and changes
				// nothing (ADR 0311).
				outdated := strings.Replace(edit, `{"phase_id"`, `{"expected_terms_fingerprint":"outdated","phase_id"`, 1)
				rec := env.do(t, http.MethodPut, "/requests/"+submitted.Request.StatusToken, "", outdated)
				require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
				assert.Contains(t, rec.Body.String(), readstate.ChangedCode)
				assert.Equal(t, childID, editedChild(t, env, submitted.Request.ID), "the refused edit keeps the child")
				return
			}
			edit = withShownTerms(t, env.router, "/requests/"+submitted.Request.StatusToken+"/edit-bootstrap", edit)
			rec := env.do(t, http.MethodPut, "/requests/"+submitted.Request.StatusToken, "", edit)
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			childID = editedChild(t, env, submitted.Request.ID)

			// The school accepts the child afterwards, the way a decision leaves it:
			// on the clock the intake stamped the agreement with (#7104).
			_, err = env.db.ExecContext(ctx, `UPDATE enrollment.request_children
  SET status = ?, reviewed_at = ? WHERE id = ?`, capability.ChildStatusApproved, consentEditNow.Add(time.Minute), childID)
			require.NoError(t, err)

			read := enrollmentCompose.NewContractApplications(securityruntime.Fingerprint)
			found, err := testpkg.TenantQuery1(t, ctx, env.db, read.AcceptedContractApplications, []int64{childID})
			require.NoError(t, err)
			require.Len(t, found, 1)
			require.NotNil(t, found[0].AcceptedAt, "the school accepted the child")
			assert.True(t, found[0].AcceptedAt.After(time.Time{}))
			require.Len(t, found[0].Acceptances, 1, "the agreement survives the parents' edit")
			assert.Equal(t, "care_contract", found[0].Acceptances[0].Key)
			assert.Equal(t, contractConditions, found[0].Acceptances[0].Text)
			assert.Equal(t, "Muster-Berg", found[0].GuardianLastName, "the proof belongs to the edited request")
		})
	}
}

// editedChild is the child row of the request after the parents' edit.
func editedChild(t *testing.T, env *signatureEnv, requestID int64) int64 {
	t.Helper()
	var ids []int64
	require.NoError(t, env.db.NewRaw(`SELECT id FROM enrollment.request_children WHERE request_id = ?`, requestID).
		Scan(testpkg.TenantContext(env.tenantID), &ids))
	require.Len(t, ids, 1)
	return ids[0]
}

func TestAcceptedContractApplicationsExcludeOfficeMatches(t *testing.T) {
	t.Parallel()
	env, schemaID := setupContractConsentTest(t, testpkg.Tenant(t))
	ctx := testpkg.Ctx(t)
	submitted, err := env.requests.Submit(ctx, enrollmentAPI.SubmitRequest{
		TenantID: testpkg.Tenant(t), PhaseID: env.phaseID, DisplayedFormSchemaID: schemaID,
		GuardianFirstName: "Erika", GuardianLastName: "Muster", GuardianEmail: "erika.muster@example.com",
		ConsentFlags: testFormValues(map[string]any{"agb": true, "data_processing": true, "email_contact": true, "care_contract": true}),
		Children: []enrollmentAPI.SubmitChild{
			{FirstName: "Lina", LastName: "Muster", DateOfBirth: existingChildBirthday, TargetGradeLevel: testpkg.Int16Ptr(1)},
			{FirstName: "Paul", LastName: "Offen", DateOfBirth: existingChildBirthday, TargetGradeLevel: testpkg.Int16Ptr(1)},
		},
	})
	require.NoError(t, err)
	require.Len(t, submitted.Children, 2)
	// The school accepts a minute after the intake's agreement (#7104).
	owner := enrollmentCompose.NewClocked(func() time.Time { return consentEditNow.Add(time.Minute) })
	_, reviewer := testpkg.CreateTestPersonWithAccount(t, env.db, "Contract", "Reviewer")
	for i, child := range submitted.Children {
		student := enrolledChild(t, env.db, child.FirstName, child.LastName, existingChildBirthday)
		require.NoError(t, testpkg.TenantCommand2(t, ctx, env.db, owner.LinkCreatedStudent, child.ID, student.ID))
		if i == 1 {
			require.NoError(t, testpkg.TenantCommand2(t, ctx, env.db, owner.PinOfficeChosenStudent, child.ID, student.ID))
		}
		require.NoError(t, testpkg.TenantCommand4(t, ctx, env.db, owner.UpdateChildStatus, child.ID, capability.ChildStatusApproved, nil, reviewer.ID))
	}
	read := enrollmentCompose.NewContractApplications(securityruntime.Fingerprint)
	for _, ids := range [][]int64{nil, {submitted.Children[0].ID, submitted.Children[1].ID}} {
		found, err := testpkg.TenantQuery1(t, ctx, env.db, read.AcceptedContractApplications, ids)
		require.NoError(t, err)
		require.Len(t, found, 1, "office matches must not supply an unauthorized contract party")
		assert.Equal(t, submitted.Children[0].ID, found[0].RequestChildID)
		require.Len(t, found[0].Acceptances, 1, "legitimate contract evidence remains available")
		assert.Equal(t, "erika.muster@example.com", found[0].GuardianEmail)
	}
	found, err := testpkg.TenantQuery1(t, ctx, env.db, read.AcceptedContractApplications, []int64{submitted.Children[1].ID})
	require.NoError(t, err)
	assert.Empty(t, found, "explicit child selection must not bypass the party restriction")
}
