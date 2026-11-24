// Router-level test for the payroll file per employer (#8041, ADR 0319):
// the Gemeinde employs the staff of the southern school. In the one file of
// the Träger its lines carry its Kostenstelle; in the form per employer it
// gets a file of its own with its DATEV client, and a person may have
// another personnel number with it. The Personalverwaltung keeps those
// values; no role without the right and no other Träger reaches them.
package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/text/encoding/charmap"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

type payrollEmployerBody struct {
	SchoolID         wireID `json:"school_id"`
	Body             string `json:"body"`
	Name             string `json:"name"`
	ConsultantNumber string `json:"consultant_number"`
	ClientNumber     string `json:"client_number"`
	CostCenter       string `json:"cost_center"`
	Version          string `json:"version"`
}

type payrollFilesBody struct {
	Form  string `json:"form"`
	Ready bool   `json:"ready"`
	Files []struct {
		Key              string `json:"key"`
		ConsultantNumber string `json:"consultant_number"`
		ClientNumber     string `json:"client_number"`
		LineCount        int    `json:"line_count"`
		MissingClient    bool   `json:"missing_client"`
		Ready            bool   `json:"ready"`
		Employers        []struct {
			Body string `json:"body"`
			Name string `json:"name"`
		} `json:"employers"`
	} `json:"files"`
	Employers []struct {
		Name              string `json:"name"`
		MissingClient     bool   `json:"missing_client"`
		MissingCostCenter bool   `json:"missing_cost_center"`
	} `json:"employers"`
	InSeveralFiles []struct {
		LastName string `json:"last_name"`
	} `json:"in_several_files"`
}

type employerEmploymentBody struct {
	SchoolID                wireID  `json:"school_id"`
	EmployerBody            string  `json:"employer_body"`
	EmployerPersonnelNumber *string `json:"employer_personnel_number"`
	EmployerNumberVersion   string  `json:"employer_number_version"`
}

func TestTraegerPayrollFollowsTheEmployerOfEachEinsatzort(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	today := time.Date(2026, time.November, 18, 12, 0, 0, 0, calendar.Berlin)
	router, portal, _, _, office := newTraegerStaffFixtureAt(t, db, func() time.Time { return today })
	north, south := office.schools[0], office.schools[1]
	staffRelease(t, db, office.organization)
	ctx := context.Background()

	miraNorth, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Mira", "Sommer")
	miraSouth := testpkg.CreateTestStaffForExistingAccountInTenant(t, db, south, account.ID, "Mira", "Sommer")
	jonas := testpkg.CreateTestStaffForTenant(t, db, south, "Jonas", "Winter")
	for _, session := range []struct {
		school, staff int64
		day, in, out  string
	}{
		{north, miraNorth.ID, "2026-10-05", "2026-10-05T06:00:00Z", "2026-10-05T10:00:00Z"},
		{south, miraSouth.ID, "2026-10-06", "2026-10-06T12:00:00Z", "2026-10-06T14:00:00Z"},
		{south, jonas.ID, "2026-10-07", "2026-10-07T05:00:00Z", "2026-10-07T06:00:00Z"},
	} {
		_, err := db.ExecContext(ctx, `INSERT INTO active.work_sessions (tenant_id, staff_id, date, check_in_time, check_out_time, created_by)
			VALUES (?, ?, ?, ?, ?, ?)`, session.school, session.staff, session.day, session.in, session.out, session.staff)
		require.NoError(t, err)
	}
	mira := linkStaffRecord(t, router, office, map[int64]int64{north: miraNorth.ID, south: miraSouth.ID})
	jonasRecord := linkStaffRecord(t, router, office, map[int64]int64{south: jonas.ID})
	setPersonnelNumber(t, router, office, mira, "417")
	setPersonnelNumber(t, router, office, jonasRecord, "523")
	addContract(t, router, office, mira, "part_time", north, miraNorth.ID, 0)
	addContract(t, router, office, mira, "part_time", south, miraSouth.ID, 0)
	addContract(t, router, office, jonasRecord, "part_time", south, jonas.ID, 0)
	setTraegerPayrollValues(t, db, office.organization, map[string]string{
		configModels.KeyTraegerPayrollConsultantNumber:                                       "29098",
		configModels.KeyTraegerPayrollClientNumber:                                           "55003",
		configModels.TraegerPayrollWageTypeKey(workforce.TraegerPayrollRegular, "part_time"): "100",
	})

	// The Gemeinde Hardt employs the staff of the southern school.
	setSchoolResponsibility(t, db, south, "responsibility.staff", "gemeinde")
	_, err := db.ExecContext(ctx, `INSERT INTO platform.school_responsible_parties
		(organization_id, school_id, kind, name, street, postal_code, city)
		VALUES (?, ?, 'gemeinde', 'Gemeinde Hardt', 'Rathausplatz 1', '41749', 'Viersen')`, office.organization, south)
	require.NoError(t, err)

	report := func(token string) payrollFilesBody {
		t.Helper()
		rec := traegerJSON(t, router, token, http.MethodGet, "/traeger/staff-exports/payroll?year=2026&month=10&format=datev_lodas", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return decode[payrollFilesBody](t, rec)
	}
	download := func(file string) string {
		t.Helper()
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-exports/payroll/export?year=2026&month=10&format=datev_lodas&file="+file, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		decoded, err := charmap.Windows1252.NewDecoder().Bytes(rec.Body.Bytes())
		require.NoError(t, err)
		return strings.ReplaceAll(string(decoded), "\r\n", "\n")
	}
	employers := func() []payrollEmployerBody {
		t.Helper()
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-exports/payroll/employers", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return decode[struct {
			Employers []payrollEmployerBody `json:"employers"`
		}](t, rec).Employers
	}
	saveEmployer := func(values map[string]any) *payrollEmployerBody {
		t.Helper()
		rec := traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/staff-exports/payroll/employers/%d", south), values)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		body := decode[payrollEmployerBody](t, rec)
		return &body
	}

	t.Run("the one file waits for the Kostenstelle of the Gemeinde", func(t *testing.T) {
		body := report(office.token)
		assert.Equal(t, workforce.TraegerPayrollFormTraeger, body.Form)
		require.Len(t, body.Files, 1)
		assert.False(t, body.Ready)
		require.Len(t, body.Employers, 1)
		assert.Equal(t, "Gemeinde Hardt", body.Employers[0].Name)
		assert.True(t, body.Employers[0].MissingCostCenter)
		assertStaffRefusal(t, traegerJSON(t, router, office.token, http.MethodGet,
			"/traeger/staff-exports/payroll/export?year=2026&month=10&format=datev_lodas", nil), http.StatusConflict, "workforce.traeger_payroll_not_ready")
	})

	var stored *payrollEmployerBody
	t.Run("the Personalverwaltung keeps the payroll values of the Gemeinde", func(t *testing.T) {
		list := employers()
		require.Len(t, list, 1, "only the school a body employs at")
		assert.Equal(t, south, int64(list[0].SchoolID))
		assert.Equal(t, "gemeinde", list[0].Body)
		assert.Equal(t, "Gemeinde Hardt", list[0].Name)
		assert.Equal(t, "absent", list[0].Version)

		rec := traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/staff-exports/payroll/employers/%d", south),
			map[string]any{"body": "gemeinde", "cost_center": "12a", "expected_version": "absent"})
		assertStaffRefusal(t, rec, http.StatusBadRequest, "workforce.traeger_payroll_employer_invalid")
		rec = traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/staff-exports/payroll/employers/%d", south),
			map[string]any{"body": "schultraeger", "cost_center": "12", "expected_version": "absent"})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_employer_changed")
		rec = traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/staff-exports/payroll/employers/%d", north),
			map[string]any{"body": "gemeinde", "cost_center": "12", "expected_version": "absent"})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_employer_changed")

		stored = saveEmployer(map[string]any{"body": "gemeinde", "cost_center": " 4711 ", "expected_version": "absent"})
		assert.Equal(t, "4711", stored.CostCenter)
		assert.NotEqual(t, "absent", stored.Version)
		rec = traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/staff-exports/payroll/employers/%d", south),
			map[string]any{"body": "gemeinde", "cost_center": "1", "expected_version": "absent"})
		assertStaffRefusal(t, rec, http.StatusConflict, "general.changed_since_read")
	})

	t.Run("the one file marks the lines of the Gemeinde with its Kostenstelle", func(t *testing.T) {
		body := report(office.token)
		require.Len(t, body.Files, 1)
		assert.True(t, body.Ready)
		text := download("")
		assert.Contains(t, text, "BeraterNr=29098\nMandantenNr=55003\n")
		assert.Contains(t, text, "1;417;01.10.2026;4,00;100;\n", "Mira at the Träger's school, unmarked")
		assert.Contains(t, text, "4;417;01.10.2026;2,00;100;4711;\n", "Mira at the Gemeinde's school, marked")
		assert.Contains(t, text, "4;523;01.10.2026;1,00;100;4711;\n", "Jonas, marked")
	})

	setTraegerPayrollValues(t, db, office.organization, map[string]string{
		configModels.KeyTraegerPayrollFileForm: configModels.TraegerPayrollFileFormArbeitgeber,
	})

	t.Run("the file per employer waits only for the Gemeinde without client", func(t *testing.T) {
		body := report(office.token)
		assert.Equal(t, workforce.TraegerPayrollFormArbeitgeber, body.Form)
		require.Len(t, body.Files, 2)
		assert.Equal(t, "29098-55003", body.Files[0].Key)
		assert.True(t, body.Files[0].Ready)
		assert.True(t, body.Files[1].MissingClient)
		assert.False(t, body.Ready)
		require.Len(t, body.InSeveralFiles, 1)
		assert.Equal(t, "Sommer", body.InSeveralFiles[0].LastName)
		text := download(body.Files[0].Key)
		assert.NotContains(t, text, ";523;", "Jonas is not in the Träger's file")
		assert.NotContains(t, text, "kostenstelle")
	})

	stored = saveEmployer(map[string]any{
		"body": "gemeinde", "consultant_number": "1234", "client_number": "567", "cost_center": "4711", "expected_version": stored.Version,
	})

	t.Run("Jonas books under his number with the Gemeinde", func(t *testing.T) {
		employment := func() employerEmploymentBody {
			rec := traegerJSON(t, router, office.token, http.MethodGet, fmt.Sprintf("/traeger/staff-records/%d", jonasRecord), nil)
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			detail := decode[struct {
				Employments []employerEmploymentBody `json:"employments"`
			}](t, rec)
			require.Len(t, detail.Employments, 1)
			return detail.Employments[0]
		}
		before := employment()
		assert.Equal(t, "gemeinde", before.EmployerBody)
		assert.Nil(t, before.EmployerPersonnelNumber)
		path := fmt.Sprintf("/traeger/staff-records/%d/employer-numbers/%d", jonasRecord, south)
		rec := traegerJSON(t, router, office.token, http.MethodPut, path, map[string]any{"employer_personnel_number": "7", "expected_version": before.EmployerNumberVersion})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		after := employment()
		require.NotNil(t, after.EmployerPersonnelNumber)
		assert.Equal(t, "7", *after.EmployerPersonnelNumber)
		rec = traegerJSON(t, router, office.token, http.MethodPut, path, map[string]any{"employer_personnel_number": "8", "expected_version": before.EmployerNumberVersion})
		assertStaffRefusal(t, rec, http.StatusConflict, "general.changed_since_read")
		var trail int
		require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM workforce.staff_record_changes WHERE staff_record_id = ? AND field = 'employer_personnel_number' AND school_id = ?`,
			jonasRecord, south).Scan(ctx, &trail))
		assert.Equal(t, 1, trail, "the change is in the trail of the record")
		// At an Einsatzort the Träger employs at there is no other number.
		rec = traegerJSON(t, router, office.token, http.MethodGet, fmt.Sprintf("/traeger/staff-records/%d", mira), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var northVersion string
		for _, employment := range decode[struct {
			Employments []employerEmploymentBody `json:"employments"`
		}](t, rec).Employments {
			if int64(employment.SchoolID) == north {
				assert.Empty(t, employment.EmployerBody)
				northVersion = employment.EmployerNumberVersion
			}
		}
		rec = traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/staff-records/%d/employer-numbers/%d", mira, north),
			map[string]any{"employer_personnel_number": "9", "expected_version": northVersion})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_employer_changed")

		body := report(office.token)
		require.Len(t, body.Files, 2)
		gemeinde := body.Files[1]
		assert.Equal(t, "1234-567", gemeinde.Key)
		assert.True(t, gemeinde.Ready)
		assert.True(t, body.Ready)
		text := download(gemeinde.Key)
		assert.Contains(t, text, "BeraterNr=1234\nMandantenNr=567\n")
		assert.Contains(t, text, "1;7;01.10.2026;1,00;100;\n", "Jonas under his number with the Gemeinde")
		assert.Contains(t, text, "1;417;01.10.2026;2,00;100;\n", "Mira under the Träger's number")
		assert.NotContains(t, text, "4,00", "Mira's hours at the Träger's school stay in the Träger's file")
		rec = traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-exports/payroll/export?year=2026&month=10&format=datev_lodas&file=1234-567", nil)
		assert.Contains(t, rec.Header().Get("Content-Disposition"), "lohnexport_datev_lodas_2026-10_1234-567.txt")
		assert.Equal(t, http.StatusBadRequest, traegerJSON(t, router, office.token, http.MethodGet,
			"/traeger/staff-exports/payroll/export?year=2026&month=10&format=datev_lodas", nil).Code, "two files need a choice")
	})

	t.Run("the list of employers stays flat in its query budget", func(t *testing.T) {
		counter := testpkg.CaptureQueriesForContext(t, db)
		req := httptest.NewRequest(http.MethodGet, "/traeger/staff-exports/payroll/employers", nil)
		req.Header.Set("Authorization", "Bearer "+office.token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, router, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		querybudgets.AssertQueryBudget(t, "api.traeger.staff_payroll_employers", counter.Measurement(counter.Selects("")))
	})

	t.Run("no role without the right and no other Träger reaches the values", func(t *testing.T) {
		readOnly := newTraegerOffice(t, db, portal, "Träger Lesen AG", identityaccess.TraegerRoleReadOnly)
		assert.Equal(t, http.StatusForbidden, traegerJSON(t, router, readOnly.token, http.MethodGet, "/traeger/staff-exports/payroll/employers", nil).Code)
		assert.Equal(t, http.StatusForbidden, traegerJSON(t, router, readOnly.token, http.MethodPut,
			fmt.Sprintf("/traeger/staff-exports/payroll/employers/%d", south), map[string]any{"body": "gemeinde", "expected_version": stored.Version}).Code)
		assert.Equal(t, http.StatusForbidden, traegerJSON(t, router, readOnly.token, http.MethodPut,
			fmt.Sprintf("/traeger/staff-records/%d/employer-numbers/%d", jonasRecord, south), map[string]any{"employer_personnel_number": nil, "expected_version": ""}).Code)

		other := newTraegerOffice(t, db, portal, "Träger Anders AG", identityaccess.TraegerRolePersonnel)
		staffRelease(t, db, other.organization)
		rec := traegerJSON(t, router, other.token, http.MethodGet, "/traeger/staff-exports/payroll/employers", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Empty(t, decode[struct {
			Employers []payrollEmployerBody `json:"employers"`
		}](t, rec).Employers)
		rec = traegerJSON(t, router, other.token, http.MethodPut, fmt.Sprintf("/traeger/staff-exports/payroll/employers/%d", south),
			map[string]any{"body": "gemeinde", "cost_center": "1", "expected_version": "absent"})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_employer_changed")
		rec = traegerJSON(t, router, other.token, http.MethodPut, fmt.Sprintf("/traeger/staff-records/%d/employer-numbers/%d", jonasRecord, south),
			map[string]any{"employer_personnel_number": "1", "expected_version": ""})
		assertStaffRefusal(t, rec, http.StatusNotFound, "workforce.traeger_staff_record_not_found")
		assert.Empty(t, report(other.token).Files)
		var rows int
		require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM workforce.payroll_employers WHERE organization_id = ?`, other.organization).Scan(ctx, &rows))
		assert.Zero(t, rows)
	})
}
