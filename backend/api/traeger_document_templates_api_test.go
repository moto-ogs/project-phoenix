// Router-level tests for the document templates of a Träger (#4677, ADR
// 0149): every kind of document starts with its standard template; a save
// is a new version that never changes; unknown placeholders are refused;
// the preview fills sample data and stores nothing; a role without the right
// "Einstellungen" reads but cannot save; no Träger reaches the templates of
// another.
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

const documentTemplatesPath = "/traeger/master-data/document-templates"

type documentTemplateBody struct {
	Subject    string `json:"subject"`
	Salutation string `json:"salutation"`
	Body       string `json:"body"`
	Closing    string `json:"closing"`
}

type documentTemplateVersion struct {
	Kind     string `json:"kind"`
	Version  int    `json:"version"`
	Standard bool   `json:"standard"`
	documentTemplateBody
}

type documentTemplateSummary struct {
	Kind     string `json:"kind"`
	Version  int    `json:"version"`
	Standard bool   `json:"standard"`
}

type documentTemplateDetail struct {
	Version      string                    `json:"version"`
	Current      documentTemplateVersion   `json:"current"`
	Standard     documentTemplateBody      `json:"standard_template"`
	Placeholders []struct{ Name string }   `json:"placeholders"`
	Versions     []documentTemplateVersion `json:"versions"`
}

type documentTemplatePreview struct {
	Subject    string `json:"subject"`
	Salutation string `json:"salutation"`
	Blocks     []struct {
		Heading string `json:"heading"`
		Text    string `json:"text"`
		Bold    bool   `json:"bold"`
		Rows    []struct {
			Label string `json:"label"`
			Value string `json:"value"`
		} `json:"rows"`
	} `json:"blocks"`
	Closing []string `json:"closing"`
}

func templateDetailOf(t *testing.T, router http.Handler, office traegerOffice, kind string) documentTemplateDetail {
	t.Helper()
	rec := traegerJSON(t, router, office.token, http.MethodGet, documentTemplatesPath+"/"+kind, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[documentTemplateDetail](t, rec.Body.Bytes())
}

func saveTemplate(t *testing.T, router http.Handler, office traegerOffice, kind string, body documentTemplateBody) *httptest.ResponseRecorder {
	t.Helper()
	return postTemplateVersion(t, router, office.token, kind, body)
}

// postTemplateVersion saves a template over the version the editor reads of
// it first, as the editor does (ADR 0311); a kind the office cannot read
// sends no version.
func postTemplateVersion(t *testing.T, router http.Handler, token, kind string, body any) *httptest.ResponseRecorder {
	t.Helper()
	version := ""
	if rec := traegerJSON(t, router, token, http.MethodGet, documentTemplatesPath+"/"+kind, nil); rec.Code == http.StatusOK {
		version = decodeSchoolPortalData[documentTemplateDetail](t, rec.Body.Bytes()).Version
	}
	return traegerJSON(t, router, token, http.MethodPost, documentTemplatesPath+"/"+kind+"/versions", withExpectedVersion(t, body, version))
}

// withExpectedVersion adds the read-state token to a JSON body.
func withExpectedVersion(t *testing.T, body any, version string) map[string]any {
	t.Helper()
	encoded, err := json.Marshal(body)
	require.NoError(t, err)
	fields := map[string]any{}
	require.NoError(t, json.Unmarshal(encoded, &fields))
	fields["expected_version"] = version
	return fields
}

var hardtInvoice = documentTemplateBody{
	Subject:    "Rechnung {{rechnungsnummer}}",
	Salutation: "Guten Tag Familie {{familienname}},",
	Body:       "für {{kinder}} berechnen wir:\n{{positionen}}\n\n**Bitte zahlen Sie {{summe}} bis {{zahlen_bis}}.**",
	Closing:    "Freundliche Grüße\n{{traeger}}",
}

func TestTraegerDocumentTemplatesStartWithTheStandardAndKeepEveryVersion(t *testing.T) {
	t.Parallel()
	db, router := newMasterDataPortal(t)
	office := newMasterDataOffice(t, db, router, "Träger Hardt Vorlagen", identityaccess.TraegerRoleAdministration)

	rec := traegerJSON(t, router, office.token, http.MethodGet, documentTemplatesPath, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	overview := decodeSchoolPortalData[[]documentTemplateSummary](t, rec.Body.Bytes())
	require.Len(t, overview, 7)
	assert.Equal(t, documentTemplateSummary{Kind: "bestaetigung", Standard: true}, overview[0])

	detail := templateDetailOf(t, router, office, "rechnung")
	assert.True(t, detail.Current.Standard)
	assert.Zero(t, detail.Current.Version)
	assert.Equal(t, detail.Standard, detail.Current.documentTemplateBody)
	assert.Empty(t, detail.Versions)
	assert.NotEmpty(t, detail.Placeholders)

	rec = saveTemplate(t, router, office, "rechnung", hardtInvoice)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	first := decodeSchoolPortalData[documentTemplateVersion](t, rec.Body.Bytes())
	assert.Equal(t, 1, first.Version)
	assert.False(t, first.Standard)

	// Saving the same text again adds no version.
	rec = saveTemplate(t, router, office, "rechnung", hardtInvoice)
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Equal(t, "traeger.document_template_unchanged", refusalOf(t, rec).Code)

	changed := hardtInvoice
	changed.Closing = "Mit freundlichen Grüßen\n{{ansprechperson}}"
	rec = saveTemplate(t, router, office, "rechnung", changed)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())

	detail = templateDetailOf(t, router, office, "rechnung")
	assert.Equal(t, 2, detail.Current.Version)
	assert.Equal(t, changed.Closing, detail.Current.Closing)
	require.Len(t, detail.Versions, 2)
	assert.Equal(t, hardtInvoice, detail.Versions[1].documentTemplateBody, "the first version is kept as it was")

	// The list as a file (#4718).
	export := traegerJSON(t, router, office.token, http.MethodGet, documentTemplatesPath+"/export", nil)
	require.Equal(t, http.StatusOK, export.Code, export.Body.String())
	assert.Contains(t, export.Body.String(), "Bestätigung und Rechnung;Standardvorlage;\n")
	assert.Contains(t, export.Body.String(), "\nRechnung;Eigene, Version 2;")
	assertTraegerListFormats(t, router, office.token, documentTemplatesPath+"/export", "vorlagen")

	// A version never changes, not even for the administrative role.
	_, err := db.ExecContext(context.Background(), `UPDATE platform.traeger_document_templates SET body = 'x'
		WHERE organization_id = ? AND kind = 'rechnung' AND version = 1`, office.organization)
	require.Error(t, err)
	assert.Equal(t, []string{"template:create", "template:create"}, masterDataLog(t, db, office.organization))
}

func TestTraegerDocumentTemplatesRefuseUnknownPlaceholders(t *testing.T) {
	t.Parallel()
	db, router := newMasterDataPortal(t)
	office := newMasterDataOffice(t, db, router, "Träger Plön Vorlagen", identityaccess.TraegerRoleAdministration)

	unknown := hardtInvoice
	unknown.Body += "\n\n{{vorname}} {{notfallnummern}}"
	for _, path := range []string{"/versions", "/preview"} {
		rec := traegerJSON(t, router, office.token, http.MethodPost, documentTemplatesPath+"/rechnung"+path, unknown)
		require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
		var refusal struct {
			Code    string         `json:"code"`
			Details map[string]any `json:"details"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &refusal))
		assert.Equal(t, "traeger.document_template_unknown_placeholder", refusal.Code)
		// The emergency numbers are a placeholder of the confirmation
		// letter, not of an invoice.
		assert.Equal(t, "notfallnummern, vorname", refusal.Details["placeholders"])
	}

	rec := saveTemplate(t, router, office, "rechnung", documentTemplateBody{Subject: " "})
	require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	refusal := refusalOf(t, rec)
	assert.Equal(t, "traeger.document_template_invalid", refusal.Code)
	fields := []string{}
	for _, field := range refusal.Errors {
		fields = append(fields, field.Field)
	}
	assert.ElementsMatch(t, []string{"subject", "body"}, fields)

	rec = saveTemplate(t, router, office, "brief", hardtInvoice)
	require.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
	assert.Equal(t, "traeger.document_template_kind_not_found", refusalOf(t, rec).Code)

	assert.Empty(t, templateDetailOf(t, router, office, "rechnung").Versions, "nothing refused was stored")
	assert.Empty(t, masterDataLog(t, db, office.organization))
}

func TestTraegerDocumentTemplatePreviewFillsSampleData(t *testing.T) {
	t.Parallel()
	db, router := newMasterDataPortal(t)
	office := newMasterDataOffice(t, db, router, "Träger Willich Vorlagen", identityaccess.TraegerRoleAdministration)

	rec := traegerJSON(t, router, office.token, http.MethodPost, documentTemplatesPath+"/rechnung/preview", hardtInvoice)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	preview := decodeSchoolPortalData[documentTemplatePreview](t, rec.Body.Bytes())
	assert.Equal(t, "Rechnung FE-2026-0001", preview.Subject)
	assert.Equal(t, "Guten Tag Familie Muster,", preview.Salutation)
	require.Len(t, preview.Blocks, 2)
	assert.Equal(t, "für Lina und Ben berechnen wir:", preview.Blocks[0].Text)
	assert.NotEmpty(t, preview.Blocks[0].Rows)
	assert.Equal(t, "Bitte zahlen Sie 92,50 € bis 16.11.2026.", preview.Blocks[1].Text)
	assert.True(t, preview.Blocks[1].Bold)
	assert.Equal(t, []string{"Freundliche Grüße", "Träger Musterstadt"}, preview.Closing)

	assert.Empty(t, templateDetailOf(t, router, office, "rechnung").Versions, "the preview stores nothing")
}

func TestTraegerDocumentTemplatesNeedTheSettingsRight(t *testing.T) {
	t.Parallel()
	db, router := newMasterDataPortal(t)
	for _, role := range []string{identityaccess.TraegerRoleReadOnly, identityaccess.TraegerRoleBilling, identityaccess.TraegerRolePersonnel} {
		reader := newMasterDataOffice(t, db, router, "Träger Vorlagen Rolle "+role, role)
		assert.True(t, templateDetailOf(t, router, reader, "bestaetigung").Current.Standard, "%s reads the templates", role)
		rec := traegerJSON(t, router, reader.token, http.MethodPost, documentTemplatesPath+"/rechnung/versions", hardtInvoice)
		assert.Equal(t, http.StatusForbidden, rec.Code, "%s save: %s", role, rec.Body.String())
		// The preview stores nothing, so a reader sees it too.
		rec = traegerJSON(t, router, reader.token, http.MethodPost, documentTemplatesPath+"/rechnung/preview", hardtInvoice)
		assert.Equal(t, http.StatusOK, rec.Code, "%s preview: %s", role, rec.Body.String())
		assert.Empty(t, templateDetailOf(t, router, reader, "rechnung").Versions)
	}
}

func TestTraegerDocumentTemplatesStayWithTheirTraeger(t *testing.T) {
	t.Parallel()
	db, router := newMasterDataPortal(t)
	own := newMasterDataOffice(t, db, router, "Träger Eigene Vorlagen", identityaccess.TraegerRoleAdministration)
	other := newMasterDataOffice(t, db, router, "Träger Fremde Vorlagen", identityaccess.TraegerRoleAdministration)
	require.Equal(t, http.StatusCreated, saveTemplate(t, router, own, "rechnung", hardtInvoice).Code)

	detail := templateDetailOf(t, router, other, "rechnung")
	assert.True(t, detail.Current.Standard, "another Träger still writes with the standard template")
	assert.Empty(t, detail.Versions)

	// The other Träger's first save is its own version 1.
	rec := saveTemplate(t, router, other, "rechnung", hardtInvoice)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	assert.Equal(t, 1, decodeSchoolPortalData[documentTemplateVersion](t, rec.Body.Bytes()).Version)
	assert.Len(t, templateDetailOf(t, router, own, "rechnung").Versions, 1)
}

// The editor saves over the version it started from (ADR 0311): when a
// colleague saved a version since, or the save names none, it is refused
// with 409 general.changed_since_read and adds no version and no log entry;
// over the version read again it goes through.
func TestTraegerDocumentTemplateSaveNeedsTheVersionItStartedFrom(t *testing.T) {
	t.Parallel()
	db, router := newMasterDataPortal(t)
	office := newMasterDataOffice(t, db, router, "Träger Vorlagen gelesener Stand", identityaccess.TraegerRoleAdministration)
	opened := templateDetailOf(t, router, office, "rechnung").Version
	require.NotEmpty(t, opened)
	save := func(version string, body documentTemplateBody) *httptest.ResponseRecorder {
		return traegerJSON(t, router, office.token, http.MethodPost, documentTemplatesPath+"/rechnung/versions", withExpectedVersion(t, body, version))
	}
	require.Equal(t, http.StatusCreated, save(opened, hardtInvoice).Code, "the colleague saves first")

	mine := hardtInvoice
	mine.Closing = "Viele Grüße\n{{traeger}}"
	for name, version := range map[string]string{"the version before the colleague's": opened, "no version": ""} {
		rec := save(version, mine)
		require.Equal(t, http.StatusConflict, rec.Code, "%s: %s", name, rec.Body.String())
		assert.Equal(t, "general.changed_since_read", refusalOf(t, rec).Code, name)
	}
	detail := templateDetailOf(t, router, office, "rechnung")
	require.Len(t, detail.Versions, 1, "a refused save adds no version")
	assert.Equal(t, hardtInvoice.Closing, detail.Current.Closing)
	assert.Equal(t, []string{"template:create"}, masterDataLog(t, db, office.organization), "a refused save logs nothing")

	require.Equal(t, http.StatusCreated, save(detail.Version, mine).Code)
	assert.Equal(t, 2, templateDetailOf(t, router, office, "rechnung").Current.Version)
}

func TestTraegerDocumentTemplatesQueryBudget(t *testing.T) {
	t.Parallel()
	db, router := newMasterDataPortal(t)
	office := newMasterDataOffice(t, db, router, "Träger Budget Vorlagen", identityaccess.TraegerRoleAdministration)
	read := func(path string) testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+office.token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, router, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Selects(""))
	}
	overview, versions := read(documentTemplatesPath), read(documentTemplatesPath+"/rechnung")
	for i, kind := range []string{"rechnung", "mahnung", "rechnung"} {
		body := hardtInvoice
		if kind == "mahnung" {
			body = documentTemplateBody{Subject: "Erinnerung {{rechnungsnummer}}", Body: "Bitte zahlen Sie {{summe}}."}
		}
		body.Closing += string(rune('a' + i))
		require.Equal(t, http.StatusCreated, saveTemplate(t, router, office, kind, body).Code)
	}
	assert.Len(t, read(documentTemplatesPath).Statements, len(overview.Statements), "the overview reads the same statements for any number of versions")
	assert.Len(t, read(documentTemplatesPath+"/rechnung").Statements, len(versions.Statements), "the versions read the same statements for any number of versions")
	querybudgets.AssertQueryBudget(t, "api.traeger.document_templates", overview)
	querybudgets.AssertQueryBudget(t, "api.traeger.document_template_versions", versions)
}
