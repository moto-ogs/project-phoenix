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

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

const (
	contractCorrectionPath        = "/traeger/contract-corrections"
	contractCorrectionPreviewPath = "/traeger/contract-corrections/preview"
	contractCorrectionListPath    = "/traeger/contract-corrections/list"
	contractCorrectionHeader      = "Vertrag-ID;Schule;Kind;Vertragsparteien;Abschlussart;Abschlussdatum;Beleg"
)

type contractCorrectionValues struct {
	Parties     []string `json:"parties"`
	Method      string   `json:"method"`
	ConcludedOn *string  `json:"concluded_on"`
	DateUnknown bool     `json:"date_unknown"`
}

type contractCorrectionBody struct {
	Missing     []string `json:"missing"`
	Fingerprint string   `json:"fingerprint"`
	Applied     bool     `json:"applied"`
	Counts      struct{ Change, Unchanged, Invalid, Corrected int }
	Rows        []struct {
		Line       int                      `json:"line"`
		Status     string                   `json:"status"`
		ContractID wireID                   `json:"contract_id"`
		ChildName  string                   `json:"child_name"`
		Changes    []string                 `json:"changes"`
		Before     contractCorrectionValues `json:"before"`
		After      contractCorrectionValues `json:"after"`
		Problems   []struct {
			Field string `json:"field"`
			Code  string `json:"code"`
		} `json:"problems"`
	} `json:"rows"`
}

func contractCorrectionFile(rows ...string) []byte {
	return []byte(strings.Join(append([]string{contractCorrectionHeader}, rows...), "\n") + "\n")
}

// importedContracts takes over Mia and Ben with their mother as the only
// party, as an import without a day of the conclusion does, and answers
// their contracts.
func importedContracts(t *testing.T, f careContractFixture) (int64, int64) {
	t.Helper()
	require.Equal(t, http.StatusOK, traegerJSON(t, f.traeger, f.office.token, http.MethodPut, templatePath(f.school, f.offering), careContractTemplate).Code)
	file := contractImportFile(contractImportSchoolName(t, f),
		"Mia;Beispiel;03.05.2019;{school};Offene Ganztagsschule;01.08.2027;Eva Beispiel;eva.beispiel@example.org;70001",
		"Ben;Beispiel;11.11.2020;{school};Offene Ganztagsschule;01.09.2027;Eva Beispiel;eva.beispiel@example.org;70001")
	rec := applyContractImport(t, f, f.office.token, "kinder.csv", file)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	rows := decodeSchoolPortalData[contractImportBody](t, rec.Body.Bytes()).Rows
	require.Len(t, rows, 2)
	return int64(rows[0].ContractID), int64(rows[1].ContractID)
}

func previewContractCorrection(t *testing.T, f careContractFixture, content []byte) contractCorrectionBody {
	t.Helper()
	rec := importForm(t, f.traeger, f.office.token, contractCorrectionPreviewPath, "nachpflege.csv", content, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[contractCorrectionBody](t, rec.Body.Bytes())
}

// contractFootprint counts what a correction must leave alone: contracts,
// versions, documents, mailings, signatures and the mails of the outbox.
func contractFootprint(t *testing.T, f careContractFixture) string {
	t.Helper()
	var footprint string
	require.NoError(t, f.db.NewRaw(`SELECT concat_ws('/',
			(SELECT COUNT(*) FROM care_contract.contracts WHERE organization_id = ?0),
			(SELECT COUNT(*) FROM care_contract.contract_versions WHERE organization_id = ?0),
			(SELECT COUNT(*) FROM care_contract.contract_version_services WHERE organization_id = ?0),
			(SELECT COUNT(*) FROM care_contract.contract_documents WHERE organization_id = ?0),
			(SELECT COUNT(*) FROM care_contract.contract_mailings WHERE organization_id = ?0),
			(SELECT COUNT(*) FROM care_contract.contract_signatures WHERE organization_id = ?0),
			(SELECT COUNT(*) FROM platform.email_outbox WHERE organization_id = ?0))`, f.office.organization).Scan(context.Background(), &footprint))
	return footprint
}

// The office completes the contracts an import took over from the original
// documents: the list to download reads back as unchanged, the preview
// stores nothing, the correction writes the parties, the method and the day
// of the conclusion onto the same contract and records it, and a repeated
// file changes nothing (#7767).
func TestCareContractCorrectionCompletesImportedContractsOnce(t *testing.T) {
	t.Parallel()
	f := newCareContractFixture(t, "Träger Vertragsnachpflege")
	mia, ben := importedContracts(t, f)

	// The import named no day of the conclusion: it is unknown, not the
	// first day of the contract.
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodGet, contractCorrectionListPath, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	list := strings.TrimPrefix(rec.Body.String(), "\xEF\xBB\xBF")
	lines := strings.Split(strings.TrimSpace(strings.ReplaceAll(list, "\r\n", "\n")), "\n")
	require.Len(t, lines, 3, list)
	assert.Equal(t, contractCorrectionHeader, lines[0])
	assert.Contains(t, list, fmt.Sprintf("%d;", mia))
	assert.Contains(t, list, "Mia Beispiel;Eva Beispiel;papier;unbekannt;")
	unchanged := previewContractCorrection(t, f, []byte(list))
	assert.Equal(t, 2, unchanged.Counts.Unchanged, "the list reads back as it was written")
	assert.Zero(t, unchanged.Counts.Change+unchanged.Counts.Invalid)

	draft, _ := sentCareContract(t, f, f.child)
	footprint := contractFootprint(t, f)
	file := contractCorrectionFile(
		fmt.Sprintf("%d;;Beispiel, Mia;Beispiel, Eva | Tom Beispiel;online;12.03.2026;vertrag-mia.pdf", mia),
		fmt.Sprintf("%d;;Ben Beispiel;;Online;unbekannt;vertrag-ben.pdf", ben),
		"999999999;;Mia Beispiel;;online;;beleg.pdf",
		fmt.Sprintf("%d;;Ole Anders;;online;;beleg.pdf", mia),
		fmt.Sprintf("%d;;Ben Beispiel;Tom Beispiel;;;beleg.pdf", ben),
		fmt.Sprintf("%d;;Mia Beispiel;;online;;beleg.pdf", draft))
	preview := previewContractCorrection(t, f, file)
	require.Len(t, preview.Rows, 6)
	assert.False(t, preview.Applied)
	assert.Equal(t, 2, preview.Counts.Change)
	assert.Equal(t, 4, preview.Counts.Invalid)
	first := preview.Rows[0]
	assert.Equal(t, "change", first.Status)
	assert.ElementsMatch(t, []string{"parties", "method", "concluded_on"}, first.Changes)
	assert.Equal(t, []string{"Eva Beispiel"}, first.Before.Parties)
	assert.Equal(t, []string{"Eva Beispiel", "Tom Beispiel"}, first.After.Parties)
	assert.True(t, first.Before.DateUnknown)
	assert.Equal(t, "papier", first.Before.Method)
	assert.Equal(t, "einfach_elektronisch", first.After.Method)
	require.NotNil(t, first.After.ConcludedOn)
	assert.Equal(t, "2026-03-12", *first.After.ConcludedOn)
	assert.Equal(t, []string{"method"}, preview.Rows[1].Changes, "the day is unknown already")
	for row, problem := range map[int]string{2: "unknown", 3: "repeated", 4: "repeated", 5: "not_imported"} {
		require.NotEmpty(t, preview.Rows[row].Problems, "row %d", row)
		assert.Equal(t, problem, preview.Rows[row].Problems[0].Code, "row %d", row)
	}
	assert.Equal(t, footprint, contractFootprint(t, f), "a preview stores nothing")

	rec = importForm(t, f.traeger, f.office.token, contractCorrectionPath, "nachpflege.csv", file, map[string]string{"fingerprint": "stale"})
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "care_contract.import_changed")

	rec = importForm(t, f.traeger, f.office.token, contractCorrectionPath, "andere.csv", file, map[string]string{"fingerprint": preview.Fingerprint})
	require.Equal(t, http.StatusConflict, rec.Code, "the trail names the file the office saw in the preview")
	rec = importForm(t, f.traeger, f.office.token, contractCorrectionPath, `C:\Belege\nachpflege.csv`, file, map[string]string{"fingerprint": preview.Fingerprint})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	applied := decodeSchoolPortalData[contractCorrectionBody](t, rec.Body.Bytes())
	assert.True(t, applied.Applied)
	assert.Equal(t, 2, applied.Counts.Corrected)
	assert.Equal(t, footprint, contractFootprint(t, f), "no contract, version, document, mail or signature is new")

	var stored struct {
		ConcludedAt time.Time `bun:"concluded_at"`
		Method      string    `bun:"conclusion_method"`
		Unknown     bool      `bun:"conclusion_date_unknown"`
		Status      string    `bun:"status"`
		Parties     string    `bun:"parties"`
	}
	require.NoError(t, f.db.NewRaw(`SELECT c.concluded_at, c.conclusion_method, c.conclusion_date_unknown, c.status,
			(SELECT string_agg(btrim(p.first_name || ' ' || p.last_name) || '<' || p.email || '>', ',' ORDER BY p.id)
				FROM care_contract.contract_parties p WHERE p.contract_id = c.id) AS parties
		FROM care_contract.contracts c WHERE c.id = ?`, mia).Scan(context.Background(), &stored))
	assert.Equal(t, "2026-03-12", stored.ConcludedAt.In(time.FixedZone("CET", 3600)).Format("2006-01-02"))
	assert.Equal(t, "einfach_elektronisch", stored.Method)
	assert.False(t, stored.Unknown)
	assert.Equal(t, "aktiv", stored.Status)
	assert.Equal(t, "Eva Beispiel<eva.beispiel@example.org>,Tom Beispiel<>", stored.Parties,
		"the party the Elternabrechnung finds the family by keeps its address; the further party has none")

	// The page of the contract shows the corrected values and the correction.
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodGet, fmt.Sprintf("/traeger/contracts/%d", ben), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	detail := decodeSchoolPortalData[struct {
		Concluded struct {
			Method      string `json:"method"`
			DateUnknown bool   `json:"date_unknown"`
			TakenOver   bool   `json:"taken_over"`
		} `json:"concluded"`
		Corrections []struct {
			File     string                   `json:"file"`
			Evidence string                   `json:"evidence"`
			Changes  []string                 `json:"changes"`
			Before   contractCorrectionValues `json:"before"`
			After    contractCorrectionValues `json:"after"`
		} `json:"corrections"`
	}](t, rec.Body.Bytes())
	assert.Equal(t, "einfach_elektronisch", detail.Concluded.Method)
	assert.True(t, detail.Concluded.DateUnknown)
	assert.True(t, detail.Concluded.TakenOver)
	require.Len(t, detail.Corrections, 1)
	assert.Equal(t, "nachpflege.csv", detail.Corrections[0].File, "the trail keeps the name of the file without its path")
	assert.Equal(t, "vertrag-ben.pdf", detail.Corrections[0].Evidence)
	assert.Equal(t, "papier", detail.Corrections[0].Before.Method)
	assert.Equal(t, "einfach_elektronisch", detail.Corrections[0].After.Method)

	// The same file again changes nothing and records nothing.
	again := previewContractCorrection(t, f, file)
	assert.Zero(t, again.Counts.Change)
	assert.Equal(t, 2, again.Counts.Unchanged)
	rec = importForm(t, f.traeger, f.office.token, contractCorrectionPath, "nachpflege.csv", file, map[string]string{"fingerprint": again.Fingerprint})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var events int
	require.NoError(t, f.db.NewRaw(`SELECT COUNT(*) FROM care_contract.contract_events WHERE organization_id = ? AND action = 'correct'`,
		f.office.organization).Scan(context.Background(), &events))
	assert.Equal(t, 2, events)

	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodGet, contractCorrectionPath, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	log := decodeSchoolPortalData[[]struct {
		File      string `json:"file"`
		Contracts int    `json:"contracts"`
	}](t, rec.Body.Bytes())
	require.Len(t, log, 1)
	assert.Equal(t, "nachpflege.csv", log[0].File)
	assert.Equal(t, 2, log[0].Contracts)
}

// A correction refuses what it cannot prove: a row without a proof, a
// method that is none, a day in the future and a file without the columns
// that name the contract.
func TestCareContractCorrectionRefusesUnprovenAndDestructiveRows(t *testing.T) {
	t.Parallel()
	f := newCareContractFixture(t, "Träger Vertragsnachpflege Grenzen")
	mia, ben := importedContracts(t, f)
	preview := previewContractCorrection(t, f, contractCorrectionFile(
		fmt.Sprintf("%d;;Mia Beispiel;;online;;", mia),
		fmt.Sprintf("%d;;Ben Beispiel;Tom Beispiel | Eva Beispiel | Ute Beispiel;brief;01.01.2999;beleg.pdf", ben)))
	require.Len(t, preview.Rows, 2)
	assert.Equal(t, "invalid", preview.Rows[0].Status)
	assert.Equal(t, "evidence", preview.Rows[0].Problems[0].Field)
	assert.Equal(t, "missing", preview.Rows[0].Problems[0].Code)
	codes := map[string]string{}
	for _, problem := range preview.Rows[1].Problems {
		codes[problem.Field] = problem.Code
	}
	assert.Equal(t, map[string]string{"method": "invalid", "concluded_on": "future"}, codes)

	// A single name corrects the name of the single party; its address
	// stays.
	renamed := previewContractCorrection(t, f, contractCorrectionFile(fmt.Sprintf("%d;;Mia Beispiel;Beispiel-Roth, Eva;;;beleg.pdf", mia)))
	assert.Equal(t, "change", renamed.Rows[0].Status)
	assert.Equal(t, []string{"Eva Beispiel-Roth"}, renamed.Rows[0].After.Parties)

	// A preview the office confirms after the contract changed is refused,
	// and stores nothing.
	other := contractCorrectionFile(fmt.Sprintf("%d;;Mia Beispiel;;online;;beleg.pdf", mia))
	rec := importForm(t, f.traeger, f.office.token, contractCorrectionPath, "nachpflege.csv", other,
		map[string]string{"fingerprint": previewContractCorrection(t, f, other).Fingerprint})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rec = importForm(t, f.traeger, f.office.token, contractCorrectionPath, "nachpflege.csv",
		contractCorrectionFile(fmt.Sprintf("%d;;Mia Beispiel;Beispiel-Roth, Eva;;;beleg.pdf", mia)), map[string]string{"fingerprint": renamed.Fingerprint})
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	var names string
	require.NoError(t, f.db.NewRaw(`SELECT string_agg(last_name, ',') FROM care_contract.contract_parties WHERE contract_id = ?`, mia).
		Scan(context.Background(), &names))
	assert.Equal(t, "Eva Beispiel", names, "the refused correction stored nothing")

	missing := previewContractCorrection(t, f, []byte("Kind;Abschlussart\nMia Beispiel;online\n"))
	assert.ElementsMatch(t, []string{"contract_id", "evidence"}, missing.Missing)
	assert.Empty(t, missing.Rows)
	rec = importForm(t, f.traeger, f.office.token, contractCorrectionPath, "nachpflege.csv", []byte("Kind;Abschlussart\nMia Beispiel;online\n"), nil)
	assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
}

// The correction needs the right "Verträge verwalten" and never reaches a
// contract of another Träger.
func TestCareContractCorrectionNeedsTheRightAndStaysWithTheTraeger(t *testing.T) {
	t.Parallel()
	f := newCareContractFixture(t, "Träger Vertragsnachpflege Recht")
	mia, _ := importedContracts(t, f)
	file := contractCorrectionFile(fmt.Sprintf("%d;;Mia Beispiel;;online;;beleg.pdf", mia))

	billing := traegerColleague(t, f.reviewFixture, identityaccess.TraegerRoleBilling)
	for _, rec := range []*httptest.ResponseRecorder{
		importForm(t, f.traeger, billing, contractCorrectionPreviewPath, "nachpflege.csv", file, nil),
		importForm(t, f.traeger, billing, contractCorrectionPath, "nachpflege.csv", file, nil),
		traegerJSON(t, f.traeger, billing, http.MethodGet, contractCorrectionPath, nil),
		traegerJSON(t, f.traeger, billing, http.MethodGet, contractCorrectionListPath, nil),
	} {
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
	}

	other := newTraegerOffice(t, f.db, f.traeger, "Träger Vertragsnachpflege Fremd", identityaccess.TraegerRoleAdministration)
	testpkg.OwnTraegerCareContracts(t, f.db, other.organization)
	rec := importForm(t, f.traeger, other.token, contractCorrectionPreviewPath, "nachpflege.csv", file, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	foreign := decodeSchoolPortalData[contractCorrectionBody](t, rec.Body.Bytes())
	require.Len(t, foreign.Rows, 1)
	assert.Equal(t, "invalid", foreign.Rows[0].Status)
	assert.Equal(t, "unknown", foreign.Rows[0].Problems[0].Code)
	assert.Empty(t, foreign.Rows[0].Before.Parties, "another Träger learns nothing of the contract")
	rec = traegerJSON(t, f.traeger, other.token, http.MethodGet, contractCorrectionListPath, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), "Beispiel")
}
