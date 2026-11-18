package api

import (
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImportStudents_ClassChangePreservesCarePlaceStatus(t *testing.T) {
	t.Parallel()
	for _, withoutPlace := range []bool{false, true} {
		t.Run(map[bool]string{false: "with care place", true: "without care place"}[withoutPlace], func(t *testing.T) {
			testpkg.OwnTenant(t)
			tc := setupImportRoute(t)
			_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Import", "Admin")
			claims := adminBearer(t, account.ID)
			router := tc.resource.Router()
			first := "Vorname,Nachname,Klasse,Geburtstag,Datenschutz\nLea,Lang,1A,03.02.2018,Ja\n"
			rr := testutil.ExecuteRequest(router, newMultipartRequestWithMode(t, "/students/import", "k.csv", first, "create", claims))
			require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
			require.Contains(t, rr.Body.String(), `"CreatedCount":1`)

			var studentID int64
			require.NoError(t, tc.db.NewRaw(`SELECT student_profile_id FROM users.student_school_memberships
				WHERE tenant_id = ? AND deleted_at IS NULL`, testpkg.Tenant(t)).Scan(testpkg.Ctx(t), &studentID))
			if withoutPlace {
				testpkg.MarkTestStudentWithoutCarePlace(t, tc.db, studentID)
			}

			second := "Vorname,Nachname,Klasse,Geburtstag,Datenschutz\nLea,Lang,2A,03.02.2018,Ja\n"
			rr = testutil.ExecuteRequest(router, newMultipartRequestWithMode(t, "/students/import", "k.csv", second, "upsert", claims))
			require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
			require.Contains(t, rr.Body.String(), `"UpdatedCount":1`)
			var stored struct {
				SchoolClass      string `bun:"school_class"`
				WithoutCarePlace bool   `bun:"without_care_place"`
			}
			require.NoError(t, tc.db.NewRaw(`SELECT school_class, without_care_place FROM users.student_school_memberships
				WHERE tenant_id = ? AND student_profile_id = ? AND deleted_at IS NULL`, testpkg.Tenant(t), studentID).Scan(testpkg.Ctx(t), &stored))
			assert.Equal(t, "2A", stored.SchoolClass)
			assert.Equal(t, withoutPlace, stored.WithoutCarePlace, "an administrative class change keeps the OGS status")
		})
	}
}
