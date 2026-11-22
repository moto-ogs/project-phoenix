package api

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	dataImportCompose "github.com/moto-ogs/project-phoenix/modules/dataimport/compose"
	importAPI "github.com/moto-ogs/project-phoenix/modules/dataimport/http"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// traegerImportBearer opens the school the way the Träger-Büro does through
// the Absprung (ADR 0084 section 5): the school's admin role, no person and
// no staff record at the school (#7818).
func traegerImportBearer(t *testing.T, tc *testContext) testutil.RequestOption {
	t.Helper()
	return staffBearer(t, tc, true)
}

// staffBearer signs the admin session of an account without person and
// staff record, opened through the Absprung or not.
func staffBearer(t *testing.T, tc *testContext, viaTraeger bool) testutil.RequestOption {
	t.Helper()
	account := testpkg.CreateTestAccount(t, tc.db, fmt.Sprintf("staffless-import-%d@example.com", testpkg.UniqueSuffix()))
	claims := testutil.AdminTestClaims(int(account.ID))
	claims.ViaTraeger = viaTraeger
	return testutil.WithJWTBearer(testutil.MintTestJWT(t, claims))
}

// importedStudentID reads the student the import created from its last name.
func importedStudentID(t *testing.T, tc *testContext, lastName string) int64 {
	t.Helper()
	var id int64
	err := tc.db.NewSelect().
		ColumnExpr(`"student".id`).
		TableExpr(`users.student_profiles AS "student"`).
		Join(`JOIN users.persons AS "person" ON "person".id = "student".person_id`).
		Where(`"student".tenant_id = ?`, testpkg.Tenant(t)).
		Where(`"person".last_name = ?`, lastName).
		Scan(context.Background(), &id)
	require.NoError(t, err, "imported student %q should exist", lastName)
	return id
}

// scheduleAuthors counts the rows of a weekly schedule table by their author.
func scheduleAuthors(t *testing.T, tc *testContext, table string, studentID int64) (traeger, other int) {
	t.Helper()
	var rows []struct {
		CreatedBy        *int64 `bun:"created_by"`
		EnteredByTraeger bool   `bun:"entered_by_traeger"`
	}
	err := tc.db.NewSelect().
		ColumnExpr("created_by, entered_by_traeger").
		TableExpr(table).
		Where("student_id = ?", studentID).
		Scan(context.Background(), &rows)
	require.NoError(t, err)
	for _, row := range rows {
		if row.CreatedBy == nil && row.EnteredByTraeger {
			traeger++
		} else {
			other++
		}
	}
	return traeger, other
}

// TestTraegerSchoolSessionImportsStudentsWithWeeklyTimes pins #7818: the
// Träger-Büro may preview and import children with weekly arrival and pickup
// times. The times carry its mark instead of a staff author.
func TestTraegerSchoolSessionImportsStudentsWithWeeklyTimes(t *testing.T) {
	t.Parallel()
	tc := setupImportRoute(t)
	router := tc.resource.Router()
	bearer := traegerImportBearer(t, tc)
	csvContent := "Vorname,Nachname,Klasse,Ankunft.Mo,Ankunft.Di,Abholung.Mo,Abholung.Di\n" +
		"Tara,TraegerZeiten,1a,08:00,08:15,15:30,16:00"

	preview := testutil.ExecuteRequest(router, testutil.NewMultipartRequest(t, http.MethodPost, "/students/preview",
		"file", "traeger.csv", csvContent, bearer))
	require.Equal(t, http.StatusOK, preview.Code, "preview: %s", preview.Body.String())

	imported := testutil.ExecuteRequest(router, testutil.NewMultipartRequest(t, http.MethodPost, "/students/import",
		"file", "traeger.csv", csvContent, bearer))
	require.Equal(t, http.StatusOK, imported.Code, "import: %s", imported.Body.String())

	studentID := importedStudentID(t, tc, "TraegerZeiten")
	traeger, other := scheduleAuthors(t, tc, "schedule.student_arrival_schedules", studentID)
	assert.Equal(t, 2, traeger, "arrival times carry the mark of the Träger-Büro and no staff author")
	assert.Zero(t, other)
	traeger, other = scheduleAuthors(t, tc, "schedule.student_pickup_schedules", studentID)
	assert.Equal(t, 2, traeger, "pickup times carry the mark of the Träger-Büro and no staff author")
	assert.Zero(t, other)
}

// TestTraegerSchoolSessionImportsStudentsWithoutTimes pins that a plain
// import of the Träger-Büro writes no schedule at all and succeeds.
func TestTraegerSchoolSessionImportsStudentsWithoutTimes(t *testing.T) {
	t.Parallel()
	tc := setupImportRoute(t)
	rr := testutil.ExecuteRequest(tc.resource.Router(), testutil.NewMultipartRequest(t, http.MethodPost, "/students/import",
		"file", "traeger.csv", "Vorname,Nachname,Klasse\nTim,TraegerOhneZeiten,1a", traegerImportBearer(t, tc)))
	require.Equal(t, http.StatusOK, rr.Code, "import: %s", rr.Body.String())
	importedStudentID(t, tc, "TraegerOhneZeiten")
}

// assertStaffProfileRequired checks the refusal of an account that is neither
// staff of the school nor the Träger-Büro.
func assertStaffProfileRequired(t *testing.T, code int, body string) {
	t.Helper()
	assert.Equal(t, http.StatusForbidden, code, body)
	assert.Contains(t, body, fmt.Sprintf("%q:%q", "code", common.CodeImportStaffProfileRequired))
}

// TestOpeningBalancesRefuseAccountsWithoutStaffProfile pins #7818: the
// opening balance records the staff member who decided it, so it stays with
// staff, also in a session of the Träger-Büro. A session without staff
// record is refused with its code, not treated as unauthenticated.
func TestOpeningBalancesRefuseAccountsWithoutStaffProfile(t *testing.T) {
	t.Parallel()
	db, svc, people, membership := setupImportModule(t)
	tc := &testContext{db: db}
	router := importAPI.NewResource(importAPI.Dependencies{Students: svc.Import, Staff: svc.StaffImport, ClassList: svc.ClassListImport,
		Files: dataImportCompose.NewFileDecoder(), Runtime: dataImportHTTPRuntime(people, membership, svc.OpeningBalanceImport)}).Router()
	for _, viaTraeger := range []bool{true, false} {
		for _, action := range []string{"preview", "import"} {
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			file, err := form.CreateFormFile("file", "salden.csv")
			require.NoError(t, err)
			_, err = io.WriteString(file, "Personalnummer,Vorname,Nachname,Stundensaldo\nP-100,Anna,Lehmann,2\n")
			require.NoError(t, err)
			require.NoError(t, form.WriteField("effective_date", "2026-11-20"))
			require.NoError(t, form.WriteField("note", "Übernahme"))
			require.NoError(t, form.Close())
			req := httptest.NewRequest(http.MethodPost, "/opening-balances/"+action, &body)
			req.Header.Set("Content-Type", form.FormDataContentType())
			staffBearer(t, tc, viaTraeger)(req)

			rr := testutil.ExecuteRequest(router, req)

			assert.Equal(t, http.StatusForbidden, rr.Code, "%s via_traeger=%v: %s", action, viaTraeger, rr.Body.String())
			assert.Contains(t, rr.Body.String(), fmt.Sprintf("%q:%q", "code", common.CodeWorkforceNoStaffProfile))
		}
	}
}
