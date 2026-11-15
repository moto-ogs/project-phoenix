// Router-level tests for the report templates of a Träger (#4716, ADR
// 0242): the Träger-Büro keeps the templates of its reports for Kommune and
// Jugendamt; a role without "Einstellungen" reads but cannot change them;
// no Träger reaches the templates of another; every change is logged.
package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

const reportTemplatesPath = "/traeger/report-templates"

type reportTemplateDistrict struct {
	SchoolID int64  `json:"school_id"`
	District string `json:"district"`
}

type reportTemplateBody struct {
	Name         string                   `json:"name"`
	Sections     []string                 `json:"sections"`
	KeyDateMonth int                      `json:"key_date_month"`
	KeyDateDay   int                      `json:"key_date_day"`
	Districts    []reportTemplateDistrict `json:"districts"`
}

type reportTemplateAnswer struct {
	ID int64 `json:"id"`
	reportTemplateBody
	UpdatedAt string `json:"updated_at"`
}

func reportTemplatePath(id int64) string {
	return reportTemplatesPath + "/" + strconv.FormatInt(id, 10)
}

func createReportTemplate(t *testing.T, router http.Handler, token string, body reportTemplateBody) reportTemplateAnswer {
	t.Helper()
	rec := traegerJSON(t, router, token, http.MethodPost, reportTemplatesPath, body)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[reportTemplateAnswer](t, rec.Body.Bytes())
}

func refusedFields(t *testing.T, rec *httptest.ResponseRecorder) []string {
	t.Helper()
	fields := []string{}
	for _, field := range refusalOf(t, rec).Errors {
		fields = append(fields, field.Field)
	}
	return fields
}

func TestTraegerReportTemplatesKeepTheTemplatesOfTheTraeger(t *testing.T) {
	t.Parallel()
	db, router := newMasterDataPortal(t)
	office := newMasterDataOffice(t, db, router, "Träger Berichtsvorlagen", identityaccess.TraegerRoleAdministration)
	north, south := office.schools[0], office.schools[1]

	jugendamt := createReportTemplate(t, router, office.token, reportTemplateBody{
		Name: "  Jugendamt Stichtag  ", Sections: []string{"demand", "children", "absences", "staff", "children"},
		KeyDateMonth: 10, KeyDateDay: 15,
		Districts: []reportTemplateDistrict{{SchoolID: south, District: " Süd "}, {SchoolID: north, District: "Nord"}},
	})
	assert.Equal(t, "Jugendamt Stichtag", jugendamt.Name, "the name is trimmed")
	assert.Equal(t, []string{"children", "staff", "absences", "demand"}, jugendamt.Sections, "each section once, in the order of the report")
	wantDistricts := []reportTemplateDistrict{{SchoolID: north, District: "Nord"}, {SchoolID: south, District: "Süd"}}
	if south < north {
		wantDistricts[0], wantDistricts[1] = wantDistricts[1], wantDistricts[0]
	}
	assert.Equal(t, wantDistricts, jugendamt.Districts, "ordered by school, trimmed")
	assert.NotEmpty(t, jugendamt.UpdatedAt)
	leap := createReportTemplate(t, router, office.token, reportTemplateBody{
		Name: "Kommune Belegung", Sections: []string{"children", "demand"}, KeyDateMonth: 2, KeyDateDay: 29,
	})
	assert.Equal(t, []reportTemplateDistrict{}, leap.Districts, "no districts is an empty list")

	rec := traegerJSON(t, router, office.token, http.MethodGet, reportTemplatesPath, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	listed := decodeSchoolPortalData[[]reportTemplateAnswer](t, rec.Body.Bytes())
	require.Len(t, listed, 2)
	assert.Equal(t, []int64{jugendamt.ID, leap.ID}, []int64{listed[0].ID, listed[1].ID}, "ordered by name")

	duplicate := traegerJSON(t, router, office.token, http.MethodPost, reportTemplatesPath, reportTemplateBody{
		Name: "JUGENDAMT stichtag", Sections: []string{"children"}, KeyDateMonth: 1, KeyDateDay: 1,
	})
	require.Equal(t, http.StatusConflict, duplicate.Code, duplicate.Body.String())
	assert.Equal(t, "traeger.report_template_name_taken", refusalOf(t, duplicate).Code)

	foreignOffice := newMasterDataOffice(t, db, router, "Träger Fremde Vorlagen", identityaccess.TraegerRoleAdministration)
	for name, refused := range map[string]struct {
		body   reportTemplateBody
		fields []string
	}{
		"unknown section and no name": {reportTemplateBody{Sections: []string{"children", "budget"}, KeyDateMonth: 10, KeyDateDay: 15}, []string{"name", "sections"}},
		"no section":                  {reportTemplateBody{Name: "Leer", KeyDateMonth: 10, KeyDateDay: 15}, []string{"sections"}},
		"31 April":                    {reportTemplateBody{Name: "April", Sections: []string{"staff"}, KeyDateMonth: 4, KeyDateDay: 31}, []string{"key_date_day"}},
		"month 13":                    {reportTemplateBody{Name: "Monat", Sections: []string{"staff"}, KeyDateMonth: 13, KeyDateDay: 1}, []string{"key_date_month"}},
		"school of another Träger": {reportTemplateBody{Name: "Fremd", Sections: []string{"staff"}, KeyDateMonth: 1, KeyDateDay: 1,
			Districts: []reportTemplateDistrict{{SchoolID: foreignOffice.schools[0], District: "Nord"}}}, []string{"districts"}},
		"school twice": {reportTemplateBody{Name: "Doppelt", Sections: []string{"staff"}, KeyDateMonth: 1, KeyDateDay: 1,
			Districts: []reportTemplateDistrict{{SchoolID: north, District: "Nord"}, {SchoolID: north, District: "Süd"}}}, []string{"districts"}},
		"empty district": {reportTemplateBody{Name: "Ohne", Sections: []string{"staff"}, KeyDateMonth: 1, KeyDateDay: 1,
			Districts: []reportTemplateDistrict{{SchoolID: north, District: "  "}}}, []string{"districts"}},
	} {
		rec := traegerJSON(t, router, office.token, http.MethodPost, reportTemplatesPath, refused.body)
		require.Equal(t, http.StatusBadRequest, rec.Code, "%s: %s", name, rec.Body.String())
		assert.Equal(t, "traeger.report_template_invalid", refusalOf(t, rec).Code, name)
		assert.ElementsMatch(t, refused.fields, refusedFields(t, rec), name)
	}

	replaced := traegerJSON(t, router, office.token, http.MethodPut, reportTemplatePath(leap.ID), reportTemplateBody{
		Name: "Kommune Belegung und Nachfrage", Sections: []string{"demand"}, KeyDateMonth: 3, KeyDateDay: 1,
		Districts: []reportTemplateDistrict{{SchoolID: north, District: "Mitte"}},
	})
	require.Equal(t, http.StatusOK, replaced.Code, replaced.Body.String())
	updated := decodeSchoolPortalData[reportTemplateAnswer](t, replaced.Body.Bytes())
	assert.Equal(t, leap.ID, updated.ID)
	assert.Equal(t, "Kommune Belegung und Nachfrage", updated.Name)
	assert.Equal(t, []string{"demand"}, updated.Sections)
	renamedOnto := traegerJSON(t, router, office.token, http.MethodPut, reportTemplatePath(leap.ID), reportTemplateBody{
		Name: "Jugendamt Stichtag", Sections: []string{"demand"}, KeyDateMonth: 3, KeyDateDay: 1,
	})
	assert.Equal(t, http.StatusConflict, renamedOnto.Code, "another template's name: %s", renamedOnto.Body.String())
	keptName := traegerJSON(t, router, office.token, http.MethodPut, reportTemplatePath(jugendamt.ID), reportTemplateBody{
		Name: "Jugendamt Stichtag", Sections: []string{"children"}, KeyDateMonth: 10, KeyDateDay: 15,
	})
	assert.Equal(t, http.StatusOK, keptName.Code, "a template keeps its own name: %s", keptName.Body.String())

	// Another Träger's template is no template of this one: 404, nothing changes.
	foreign := createReportTemplate(t, router, foreignOffice.token, reportTemplateBody{Name: "Fremde Vorlage", Sections: []string{"staff"}, KeyDateMonth: 1, KeyDateDay: 1})
	for _, rec := range []*httptest.ResponseRecorder{
		traegerJSON(t, router, office.token, http.MethodPut, reportTemplatePath(foreign.ID), reportTemplateBody{Name: "Übernommen", Sections: []string{"staff"}, KeyDateMonth: 1, KeyDateDay: 1}),
		traegerJSON(t, router, office.token, http.MethodDelete, reportTemplatePath(foreign.ID), nil),
	} {
		require.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
		assert.Equal(t, "traeger.report_template_not_found", refusalOf(t, rec).Code)
	}
	foreignList := traegerJSON(t, router, foreignOffice.token, http.MethodGet, reportTemplatesPath, nil)
	require.Equal(t, http.StatusOK, foreignList.Code)
	assert.Contains(t, foreignList.Body.String(), "Fremde Vorlage")
	assert.NotContains(t, foreignList.Body.String(), "Jugendamt", "no Träger lists the templates of another")

	require.Equal(t, http.StatusNoContent, traegerJSON(t, router, office.token, http.MethodDelete, reportTemplatePath(leap.ID), nil).Code)
	gone := traegerJSON(t, router, office.token, http.MethodDelete, reportTemplatePath(leap.ID), nil)
	assert.Equal(t, http.StatusNotFound, gone.Code, gone.Body.String())

	var logged []string
	require.NoError(t, db.NewRaw(`SELECT action FROM platform.traeger_master_data_audit
		WHERE organization_id = ? AND subject = 'report_template' ORDER BY id`, office.organization).Scan(context.Background(), &logged))
	assert.Equal(t, []string{"create", "create", "update", "update", "delete"}, logged, "every change stands in the master data log; refusals write nothing")
}

func TestTraegerReportTemplatesNeedTheirRights(t *testing.T) {
	t.Parallel()
	db, router := newMasterDataPortal(t)
	admin := newMasterDataOffice(t, db, router, "Träger Vorlagen Rechte", identityaccess.TraegerRoleAdministration)
	template := createReportTemplate(t, router, admin.token, reportTemplateBody{Name: "Jugendamt", Sections: []string{"children"}, KeyDateMonth: 10, KeyDateDay: 15})

	signIn := func(role string) string {
		t.Helper()
		password := testpkg.NewTestPassword()
		account := traegerAccount(t, db, password)
		testpkg.CreateTestTraegerMember(t, db, admin.organization, account.ID, role)
		code, answer := traegerSignIn(t, router, account.Email, password, 0)
		require.Equal(t, http.StatusOK, code)
		return answer.AccessToken
	}
	readOnly, leader := signIn(identityaccess.TraegerRoleReadOnly), signIn(identityaccess.TraegerRoleLeadership)
	body := reportTemplateBody{Name: "Neu", Sections: []string{"staff"}, KeyDateMonth: 1, KeyDateDay: 1}

	listed := traegerJSON(t, router, readOnly, http.MethodGet, reportTemplatesPath, nil)
	assert.Equal(t, http.StatusOK, listed.Code, "Berichte lesen reads the templates: %s", listed.Body.String())
	for _, write := range []*httptest.ResponseRecorder{
		traegerJSON(t, router, readOnly, http.MethodPost, reportTemplatesPath, body),
		traegerJSON(t, router, readOnly, http.MethodPut, reportTemplatePath(template.ID), body),
		traegerJSON(t, router, readOnly, http.MethodDelete, reportTemplatePath(template.ID), nil),
		traegerJSON(t, router, leader, http.MethodPost, reportTemplatesPath, body),
	} {
		assert.Equal(t, http.StatusForbidden, write.Code, "writing needs Einstellungen: %s", write.Body.String())
	}
	denied := traegerJSON(t, router, leader, http.MethodGet, reportTemplatesPath, nil)
	assert.Equal(t, http.StatusForbidden, denied.Code, "Leitung holds no Berichte lesen: %s", denied.Body.String())
}

func TestTraegerReportTemplatesQueryBudget(t *testing.T) {
	t.Parallel()
	db, router := newMasterDataPortal(t)
	office := newMasterDataOffice(t, db, router, "Träger Budget Berichtsvorlagen", identityaccess.TraegerRoleAdministration)
	read := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		req := httptest.NewRequest(http.MethodGet, reportTemplatesPath, nil)
		req.Header.Set("Authorization", "Bearer "+office.token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, router, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Selects(""))
	}
	createReportTemplate(t, router, office.token, reportTemplateBody{Name: "Eins", Sections: []string{"children"}, KeyDateMonth: 1, KeyDateDay: 1})
	one := read()
	for _, name := range []string{"Zwei", "Drei", "Vier"} {
		createReportTemplate(t, router, office.token, reportTemplateBody{Name: name, Sections: []string{"staff"}, KeyDateMonth: 2, KeyDateDay: 3,
			Districts: []reportTemplateDistrict{{SchoolID: office.schools[0], District: name}}})
	}
	assert.Len(t, read().Statements, len(one.Statements), "the list reads the same statements for any number of templates")
	querybudgets.AssertQueryBudget(t, "api.traeger.report_templates", one)
}
