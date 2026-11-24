// Router-level test for the employer at the Einsatzorte of a staff record
// of the Träger (#4811): the responsibility "Personal" of each school names
// the Träger, the Schulträger or the Gemeinde; the Personalakte names that
// body at the Einsatzort once its master data are stored.
package api

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func TestTraegerStaffRecordNamesTheEmployerOfEachEinsatzort(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	router, _, _, _, office := newTraegerStaffFixture(t, db)
	testpkg.OwnTraegerMasterData(t, db, office.organization)
	north, south := office.schools[0], office.schools[1]
	miraNorth, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Mira", "Sommer")
	miraSouth := testpkg.CreateTestStaffForExistingAccountInTenant(t, db, south, account.ID, "Mira", "Sommer")
	staffRelease(t, db, office.organization)
	rec := traegerLink(t, router, office.token, map[string]any{"members": []map[string]string{
		{"school_id": fmt.Sprint(north), "staff_id": fmt.Sprint(miraNorth.ID)}, {"school_id": fmt.Sprint(south), "staff_id": fmt.Sprint(miraSouth.ID)},
	}})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	recordID := int64(decode[staffRecordBody](t, rec).ID)

	employers := func() map[int64]string {
		t.Helper()
		rec := traegerJSON(t, router, office.token, http.MethodGet, fmt.Sprintf("/traeger/staff-records/%d", recordID), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		detail := decode[struct {
			Employments []struct {
				SchoolID     wireID `json:"school_id"`
				EmployerName string `json:"employer_name"`
			} `json:"employments"`
		}](t, rec)
		require.Len(t, detail.Employments, 2)
		bySchool := map[int64]string{}
		for _, employment := range detail.Employments {
			bySchool[int64(employment.SchoolID)] = employment.EmployerName
		}
		return bySchool
	}
	assert.Equal(t, map[int64]string{north: "", south: ""}, employers(), "without a value the Träger employs everywhere")

	// The Gemeinde employs the staff of the southern school; without its
	// master data the Träger stays the employer.
	setSchoolResponsibility(t, db, south, "responsibility.staff", "gemeinde")
	assert.Equal(t, map[int64]string{north: "", south: ""}, employers(), "a Gemeinde without master data employs nobody")
	_, err := db.ExecContext(context.Background(), `INSERT INTO platform.school_responsible_parties
		(organization_id, school_id, kind, name, street, postal_code, city)
		VALUES (?, ?, 'gemeinde', 'Gemeinde Hardt', 'Rathausplatz 1', '41749', 'Viersen')`, office.organization, south)
	require.NoError(t, err)
	assert.Equal(t, map[int64]string{north: "", south: "Gemeinde Hardt"}, employers(), "each Einsatzort names its own employer")
}
