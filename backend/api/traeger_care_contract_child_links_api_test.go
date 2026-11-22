package api

import (
	"bytes"
	"context"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	careContractCompose "github.com/moto-ogs/project-phoenix/modules/carecontract/compose"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

const (
	childLinkPath        = "/traeger/contract-child-links"
	childLinkPreviewPath = "/traeger/contract-child-links/preview"
)

type childLinkingBody struct {
	Unmapped    []string `json:"unmapped"`
	Fingerprint string   `json:"fingerprint"`
	Applied     bool     `json:"applied"`
	Counts      struct {
		Ready, Linked, Stored, Conflict, Invalid int
	} `json:"counts"`
	Rows []childLinkRowBody `json:"rows"`
}

type childLinkRowBody struct {
	Line        int    `json:"line"`
	Status      string `json:"status"`
	Fingerprint string `json:"fingerprint"`
	ContractID  wireID `json:"contract_id"`
	StudentID   wireID `json:"student_id"`
	Problems    []struct {
		Field string `json:"field"`
		Code  string `json:"code"`
	} `json:"problems"`
}

// childLinkFixture is a Träger with three imported contracts (Mia, Ben and
// Linn, a misspelt copy of the application child Lina) and the child records
// of Mia and Lina at its school.
type childLinkFixture struct {
	careContractFixture
	mia, ben, linn int64 // contracts
	miaStudent     int64
	linaStudent    int64
}

func newChildLinkFixture(t *testing.T, name string) childLinkFixture {
	t.Helper()
	f := newCareContractFixture(t, name)
	require.Equal(t, http.StatusOK, traegerJSON(t, f.traeger, f.office.token, http.MethodPut, templatePath(f.school, f.offering), careContractTemplate).Code)
	rec := applyContractImport(t, f, f.office.token, "bestand.csv", contractImportFile(contractImportSchoolName(t, f),
		"Mia;Beispiel;03.05.2019;{school};Offene Ganztagsschule;01.08.2027;Eva Beispiel;eva.beispiel@example.org;",
		"Ben;Beispiel;11.11.2020;{school};Offene Ganztagsschule;01.09.2027;Eva Beispiel;eva.beispiel@example.org;",
		"Linn;Muster;;{school};Offene Ganztagsschule;01.08.2027;Erika Muster;;"))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	imported := decodeSchoolPortalData[contractImportBody](t, rec.Body.Bytes())
	require.Equal(t, 3, imported.Counts.Imported, rec.Body.String())
	mia := testpkg.CreateTestStudentForTenant(t, f.db, f.school, "Mia", "Beispiel", "1a")
	lina := testpkg.CreateTestStudentForTenant(t, f.db, f.school, "Lina", "Muster", "1a")
	ctx := context.Background()
	_, err := f.db.ExecContext(ctx, `UPDATE users.persons SET birthday = DATE '2019-05-03' WHERE id = ?`, mia.PersonID)
	require.NoError(t, err)
	// The application child Lina became Lina's child record.
	_, err = f.db.ExecContext(ctx, `UPDATE enrollment.request_children SET created_student_id = ? WHERE id = ?`, lina.ID, f.child)
	require.NoError(t, err)
	return childLinkFixture{careContractFixture: f, mia: int64(imported.Rows[0].ContractID), ben: int64(imported.Rows[1].ContractID),
		linn: int64(imported.Rows[2].ContractID), miaStudent: mia.ID, linaStudent: lina.ID}
}

func childLinkFile(rows ...[2]int64) []byte {
	lines := []string{"Vertrag;Kind"}
	for _, row := range rows {
		lines = append(lines, fmt.Sprintf("%d;%d", row[0], row[1]))
	}
	return []byte(strings.Join(lines, "\n") + "\n")
}

func childLinkContractPath(contractID int64, suffix string) string {
	return fmt.Sprintf("%s/%d%s", childLinkPath, contractID, suffix)
}

func (f childLinkFixture) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var n int
	require.NoError(t, f.db.NewRaw(query, args...).Scan(context.Background(), &n))
	return n
}

func (f childLinkFixture) events(t *testing.T, action string) int {
	t.Helper()
	return f.count(t, `SELECT COUNT(*) FROM care_contract.contract_events WHERE organization_id = ? AND action = ?`, f.office.organization, action)
}

// sideEffects counts what a link must never start: mail and push of the
// school and the Träger and the runs of the Elternabrechnung.
func (f childLinkFixture) sideEffects(t *testing.T) int {
	t.Helper()
	return f.count(t, `SELECT (SELECT COUNT(*) FROM platform.email_outbox WHERE tenant_id = ? OR organization_id = ?)
		+ (SELECT COUNT(*) FROM platform.push_outbox WHERE tenant_id = ?)
		+ (SELECT COUNT(*) FROM parent_billing.care_runs WHERE organization_id = ?)
		+ (SELECT COUNT(*) FROM parent_billing.runs WHERE organization_id = ?)`,
		f.school, f.office.organization, f.school, f.office.organization, f.office.organization)
}

// preview answers the row of one contract and child record the office sees
// before it links them.
func (f childLinkFixture) preview(t *testing.T, contractID, studentID int64) childLinkRowBody {
	t.Helper()
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodPost, childLinkContractPath(contractID, "/preview"), map[string]any{"student_id": studentID})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	row := decodeSchoolPortalData[childLinkRowBody](t, rec.Body.Bytes())
	require.NotEmpty(t, row.Fingerprint, "a single row names the state the office sees")
	return row
}

// unlinkPath takes the child record studentID off the contract.
func unlinkPath(contractID, studentID int64) string {
	return childLinkContractPath(contractID, fmt.Sprintf("?student_id=%d", studentID))
}

// heldByImport are the application children the list of candidates holds
// back because an imported contract covers them: shown with the reason, and
// offered no second contract.
func (f childLinkFixture) heldByImport(t *testing.T) []int64 {
	t.Helper()
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodGet, "/traeger/contracts/candidates", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	ids := []int64{}
	for _, candidate := range decodeSchoolPortalData[[]careContractCandidateBody](t, rec.Body.Bytes()) {
		if candidate.TemplateIssue == carecontract.SkipImportedContract {
			ids = append(ids, int64(candidate.RequestChildID))
		}
	}
	return ids
}

// The office links imported contracts to the child records of their school
// by a file (#7760, ADR 0307): the preview stores
// nothing, the run takes only the confirmed preview, links the ready rows
// with their file and line in the trail and the school's access log, and a
// second run links nothing twice. The import log counts no link.
func TestCareContractChildLinksLinkTheReadyRowsOfAFileOnce(t *testing.T) {
	t.Parallel()
	f := newChildLinkFixture(t, "Träger Kind verknüpfen")
	token := f.office.token
	other := newTraegerOffice(t, f.db, f.traeger, "Träger Kind verknüpfen Fremd", identityaccess.TraegerRoleAdministration)
	stranger := testpkg.CreateTestStudentForTenant(t, f.db, other.schools[0], "Ben", "Beispiel", "1a")
	file := childLinkFile([2]int64{f.mia, f.miaStudent}, [2]int64{f.ben, stranger.ID})
	effects := f.sideEffects(t)

	rec := importForm(t, f.traeger, token, childLinkPreviewPath, "verknuepfung.csv", file, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	preview := decodeSchoolPortalData[childLinkingBody](t, rec.Body.Bytes())
	require.Empty(t, preview.Unmapped, "moto finds the columns Vertrag and Kind")
	require.Len(t, preview.Rows, 2)
	assert.Equal(t, "ready", preview.Rows[0].Status)
	assert.Equal(t, "invalid", preview.Rows[1].Status, "a child record of another Träger's school is unknown here")
	assert.Equal(t, "unknown", preview.Rows[1].Problems[0].Code)
	assert.Zero(t, f.count(t, `SELECT COUNT(*) FROM care_contract.contracts WHERE organization_id = ? AND student_id IS NOT NULL`, f.office.organization),
		"a preview links nothing")

	rec = importForm(t, f.traeger, token, childLinkPath, "verknuepfung.csv", file, map[string]string{"fingerprint": "stale"})
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "care_contract.child_link_changed")

	rec = importForm(t, f.traeger, token, childLinkPath, `C:\Export\verknuepfung.csv`, file, map[string]string{"fingerprint": preview.Fingerprint})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	applied := decodeSchoolPortalData[childLinkingBody](t, rec.Body.Bytes())
	assert.True(t, applied.Applied)
	assert.Equal(t, 1, applied.Counts.Stored)
	assert.Equal(t, 1, applied.Counts.Invalid)
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM care_contract.contracts WHERE id = ? AND student_id = ?`, f.mia, f.miaStudent))
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM care_contract.contract_events WHERE contract_id = ? AND action = 'link_child'
		AND details->>'link_file' = 'verknuepfung.csv' AND (details->>'link_line')::int = 2 AND (details->>'student_id')::bigint = ?`, f.mia, f.miaStudent),
		"the trail keeps the file without its path and the line")
	assert.Equal(t, 2, f.count(t, `SELECT COUNT(*) FROM audit.data_access_log WHERE tenant_id = ? AND metadata->>'view' = 'care_contract_child_link'
		AND metadata->'student_ids' @> ?::jsonb`, f.school, fmt.Sprintf("[%d]", f.miaStudent)), "preview and run name the child record in the school's log")
	assert.Equal(t, effects, f.sideEffects(t), "a link sends nothing and starts no billing")

	// The same file again links nothing twice.
	rec = importForm(t, f.traeger, token, childLinkPreviewPath, "verknuepfung.csv", file, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	again := decodeSchoolPortalData[childLinkingBody](t, rec.Body.Bytes())
	rec = importForm(t, f.traeger, token, childLinkPath, "verknuepfung.csv", file, map[string]string{"fingerprint": again.Fingerprint})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	again = decodeSchoolPortalData[childLinkingBody](t, rec.Body.Bytes())
	assert.Equal(t, 1, again.Counts.Linked)
	assert.Zero(t, again.Counts.Stored)
	assert.Equal(t, 1, f.events(t, "link_child"))

	rec = traegerJSON(t, f.traeger, token, http.MethodGet, contractImportPath, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	log := decodeSchoolPortalData[[]struct {
		Contracts int `json:"contracts"`
	}](t, rec.Body.Bytes())
	require.Len(t, log, 1, "a link is no import")
	assert.Equal(t, 3, log[0].Contracts)
}

// A link reaches the care and the billing downstream (#7760): the school's
// Soll reads the contract for the child, the versions in force name the
// child record, and an application child whose child record an imported
// contract covers gets no second contract. Before the link the misspelt copy
// covered nothing (TestCoveredByImportCoversTheChildOfARunningImportedContract
// pins the rule).
func TestCareContractChildLinkReachesTheCareAndTheBilling(t *testing.T) {
	t.Parallel()
	f := newChildLinkFixture(t, "Träger Kind verknüpfen Folgen")
	token := f.office.token
	assert.NotContains(t, f.heldByImport(t), f.child, "the misspelt imported copy does not cover Lina")
	effects := f.sideEffects(t)

	row := f.preview(t, f.linn, f.linaStudent)
	assert.Equal(t, "conflict", row.Status)
	assert.Equal(t, "differs", row.Problems[0].Code)
	rec := traegerJSON(t, f.traeger, token, http.MethodPut, childLinkContractPath(f.linn, ""),
		map[string]any{"student_id": f.linaStudent, "fingerprint": row.Fingerprint})
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "care_contract.child_link_refused")
	rec = traegerJSON(t, f.traeger, token, http.MethodPut, childLinkContractPath(f.linn, ""),
		map[string]any{"student_id": f.linaStudent, "accept_difference": true, "fingerprint": row.Fingerprint})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "stored", decodeSchoolPortalData[childLinkRowBody](t, rec.Body.Bytes()).Status)
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM care_contract.contract_events WHERE contract_id = ? AND action = 'link_child'
		AND (details->>'accepted_difference')::boolean`, f.linn))

	assert.Contains(t, f.heldByImport(t), f.child, "the linked imported contract covers Lina's booked care: held back, with the reason")
	assert.Equal(t, effects, f.sideEffects(t), "a link sends nothing and starts no billing")

	ctx := tenant.WithUnitOfWork(context.Background(), testpkg.TenantRuntime(t, f.db))
	august, september := calendar.NewDate(2027, 8, 1), calendar.NewDate(2027, 9, 30)
	require.NoError(t, owners.CareContractRuntime{}.WithinSchool(ctx, f.school, func(txCtx context.Context) error {
		booked, err := careContractCompose.NewBookedCare().BookedCare(txCtx, []int64{f.linaStudent}, august, september)
		require.NoError(t, err)
		assert.Equal(t, f.linn, booked[f.linaStudent].ContractID, "the school's Soll reads the contract for the child")
		return nil
	}))
	require.NoError(t, owners.CareContractRuntime{}.WithinTraeger(ctx, f.office.organization, func(txCtx context.Context) error {
		versions, err := careContractCompose.NewContractVersions().VersionsInForce(txCtx, f.office.organization, august, september, f.linn)
		require.NoError(t, err)
		require.NotEmpty(t, versions)
		assert.Equal(t, &f.linaStudent, versions[0].StudentID, "the billing reads the child record")
		return nil
	}))
}

// Unlinking corrects a wrong link of an imported contract: it takes the
// child record the office saw off and records it once; a contract linked to
// another child record keeps it, a contract from an application keeps its
// child, and another Träger finds no contract.
func TestCareContractChildUnlinkCorrectsOnlyImportedContracts(t *testing.T) {
	t.Parallel()
	f := newChildLinkFixture(t, "Träger Kind lösen")
	token := f.office.token
	rec := traegerJSON(t, f.traeger, token, http.MethodPut, childLinkContractPath(f.mia, ""),
		map[string]any{"student_id": f.miaStudent, "fingerprint": f.preview(t, f.mia, f.miaStudent).Fingerprint})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = traegerJSON(t, f.traeger, token, http.MethodDelete, childLinkContractPath(f.mia, ""), nil)
	require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	rec = traegerJSON(t, f.traeger, token, http.MethodDelete, unlinkPath(f.mia, f.linaStudent), nil)
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "care_contract.child_link_changed")
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM care_contract.contracts WHERE id = ? AND student_id = ?`, f.mia, f.miaStudent),
		"a contract linked to another child record than the office saw keeps its link")
	assert.Zero(t, f.events(t, "unlink_child"))

	rec = traegerJSON(t, f.traeger, token, http.MethodDelete, unlinkPath(f.mia, f.miaStudent), nil)
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM care_contract.contracts WHERE id = ? AND student_id IS NULL`, f.mia))
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM care_contract.contract_events WHERE contract_id = ? AND action = 'unlink_child'
		AND (details->>'student_id')::bigint = ?`, f.mia, f.miaStudent))
	rec = traegerJSON(t, f.traeger, token, http.MethodDelete, unlinkPath(f.mia, f.miaStudent), nil)
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	assert.Equal(t, 1, f.events(t, "unlink_child"), "a contract without a child record stays as it is")

	application := testpkg.CreateTestCareContract(t, f.db, f.office.organization, f.school, f.linaStudent, "versendet", calendar.NewDate(2027, 8, 1),
		testpkg.CareContractService{Weekday: "mon", Module: "OGS", EndsAt: "16:00"})
	rec = traegerJSON(t, f.traeger, token, http.MethodDelete, unlinkPath(application, f.linaStudent), nil)
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "care_contract.child_link_not_imported")
	rec = traegerJSON(t, f.traeger, token, http.MethodPut, childLinkContractPath(application, ""),
		map[string]any{"student_id": f.linaStudent, "fingerprint": f.preview(t, application, f.linaStudent).Fingerprint})
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "care_contract.child_link_not_imported")

	other := newTraegerOffice(t, f.db, f.traeger, "Träger Kind lösen Fremd", identityaccess.TraegerRoleAdministration)
	testpkg.OwnTraegerCareContracts(t, f.db, other.organization)
	rec = traegerJSON(t, f.traeger, other.token, http.MethodDelete, unlinkPath(f.mia, f.miaStudent), nil)
	assert.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "care_contract.contract_not_found")
	rec = traegerJSON(t, f.traeger, other.token, http.MethodPost, childLinkContractPath(f.mia, "/preview"), map[string]any{"student_id": f.miaStudent})
	assert.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
}

// A single link confirms the state the office saw: the fingerprint of the
// previewed row. A child record whose name or date of birth changed since
// the preview links nothing and answers child_link_changed; a link without
// the fingerprint is a field error.
func TestCareContractChildLinkConfirmsThePreviewTheOfficeSaw(t *testing.T) {
	t.Parallel()
	f := newChildLinkFixture(t, "Träger Kind verknüpfen Stand")
	token := f.office.token
	link := func(fingerprint string) *httptest.ResponseRecorder {
		return traegerJSON(t, f.traeger, token, http.MethodPut, childLinkContractPath(f.mia, ""),
			map[string]any{"student_id": f.miaStudent, "fingerprint": fingerprint})
	}
	linked := func() int {
		return f.count(t, `SELECT COUNT(*) FROM care_contract.contracts WHERE id = ? AND student_id IS NOT NULL`, f.mia)
	}

	rec := traegerJSON(t, f.traeger, token, http.MethodPut, childLinkContractPath(f.mia, ""), map[string]any{"student_id": f.miaStudent})
	require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "fingerprint")

	for _, change := range []string{
		`UPDATE users.persons SET birthday = DATE '2019-05-04' WHERE id = (SELECT person_id FROM users.student_profiles WHERE id = ?)`,
		`UPDATE users.persons SET first_name = 'Mira' WHERE id = (SELECT person_id FROM users.student_profiles WHERE id = ?)`,
	} {
		seen := f.preview(t, f.mia, f.miaStudent)
		_, err := f.db.ExecContext(context.Background(), change, f.miaStudent)
		require.NoError(t, err)
		rec = link(seen.Fingerprint)
		require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
		assert.Contains(t, rec.Body.String(), "care_contract.child_link_changed")
		assert.Zero(t, linked(), "a changed child record links nothing")
	}
	assert.Zero(t, f.events(t, "link_child"))

	rec = traegerJSON(t, f.traeger, token, http.MethodPut, childLinkContractPath(f.mia, ""),
		map[string]any{"student_id": f.miaStudent, "accept_difference": true, "fingerprint": f.preview(t, f.mia, f.miaStudent).Fingerprint})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "stored", decodeSchoolPortalData[childLinkRowBody](t, rec.Body.Bytes()).Status,
		"the fingerprint of the preview confirms the accepted difference")
	assert.Equal(t, 1, linked())
}

// The link needs the right "Verträge verwalten" on every route.
func TestCareContractChildLinksNeedTheRight(t *testing.T) {
	t.Parallel()
	f := newChildLinkFixture(t, "Träger Kind verknüpfen Recht")
	billing := traegerColleague(t, f.reviewFixture, identityaccess.TraegerRoleBilling)
	file := childLinkFile([2]int64{f.mia, f.miaStudent})
	assert.Equal(t, http.StatusForbidden, importForm(t, f.traeger, billing, childLinkPreviewPath, "k.csv", file, nil).Code)
	assert.Equal(t, http.StatusForbidden, importForm(t, f.traeger, billing, childLinkPath, "k.csv", file, nil).Code)
	body := map[string]any{"student_id": f.miaStudent}
	assert.Equal(t, http.StatusForbidden, traegerJSON(t, f.traeger, billing, http.MethodPost, childLinkContractPath(f.mia, "/preview"), body).Code)
	assert.Equal(t, http.StatusForbidden, traegerJSON(t, f.traeger, billing, http.MethodPut, childLinkContractPath(f.mia, ""), body).Code)
	assert.Equal(t, http.StatusForbidden, traegerJSON(t, f.traeger, billing, http.MethodDelete, unlinkPath(f.mia, f.miaStudent), nil).Code)
	assert.Zero(t, f.events(t, "link_child"))
}

// The preview of a file reads the same statements for any number of rows:
// one read per school, one of the Träger's contracts, one trail entry and
// one access log entry per school shown.
func TestCareContractChildLinkPreviewQueryBudgetIsFlat(t *testing.T) {
	t.Parallel()
	f := newChildLinkFixture(t, "Träger Kind verknüpfen Budget")
	measure := func(file []byte) testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, f.db)
		rec := httptest.NewRecorder()
		req := childLinkUpload(t, f.office.token, file)
		testpkg.MeasuredHTTPRequest(counter, f.traeger, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Queries())
	}
	one := measure(childLinkFile([2]int64{f.mia, f.miaStudent}))
	three := measure(childLinkFile([2]int64{f.mia, f.miaStudent}, [2]int64{f.ben, f.linaStudent}, [2]int64{f.linn, f.linaStudent}))
	assert.Len(t, three.Statements, len(one.Statements), "the preview reads the same statements for any number of rows")
	querybudgets.AssertQueryBudget(t, "api.traeger.care_contract_child_links", one)
}

// childLinkUpload is the multipart request of a preview, like importForm.
func childLinkUpload(t *testing.T, token string, content []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("file", "k.csv")
	require.NoError(t, err)
	_, err = part.Write(content)
	require.NoError(t, err)
	require.NoError(t, form.Close())
	req := httptest.NewRequest(http.MethodPost, childLinkPreviewPath, &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	return req
}
