package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	careContractCompose "github.com/moto-ogs/project-phoenix/modules/carecontract/compose"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

const (
	offeringCorrectionPath        = "/traeger/contract-imports/offering-corrections"
	offeringCorrectionPreviewPath = "/traeger/contract-imports/offering-corrections/preview"
	// offeringCorrectionTarget runs on every weekday of the fixture's
	// school year; the imported contracts book "Offene Ganztagsschule".
	offeringCorrectionTarget = "OGS bis 16:30"
)

type offeringCorrectionBody struct {
	MissingColumns []string `json:"missing_columns"`
	Fingerprint    string   `json:"fingerprint"`
	Applied        bool     `json:"applied"`
	Counts         struct {
		Ready, Unchanged, Held, Invalid, Corrected int
	} `json:"counts"`
	Contracts []struct {
		Reference     string  `json:"reference"`
		ContractID    wireID  `json:"contract_id"`
		Status        string  `json:"status"`
		EffectiveFrom *string `json:"effective_from"`
		VersionNumber int     `json:"version_number"`
		Changes       []struct {
			Weekdays []string `json:"weekdays"`
			From     string   `json:"from"`
			To       string   `json:"to"`
		} `json:"changes"`
		Problems []struct {
			Line  int    `json:"line"`
			Field string `json:"field"`
			Code  string `json:"code"`
		} `json:"problems"`
		Hints []string `json:"hints"`
	} `json:"contracts"`
}

// offeringCorrectionFixture is a Träger whose school has the imported
// contracts of the rows and a second module from Monday to Friday.
func offeringCorrectionFixture(t *testing.T, name string, rows ...string) (careContractFixture, []int64, int64) {
	t.Helper()
	f := newCareContractFixture(t, name)
	require.Equal(t, http.StatusOK, putTemplate(t, f.traeger, f.office.token, f.school, f.offering, careContractTemplate).Code)
	rec := applyContractImport(t, f, f.office.token, "kinder.csv", contractImportFile(contractImportSchoolName(t, f), rows...))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	imported := decodeSchoolPortalData[contractImportBody](t, rec.Body.Bytes())
	require.Equal(t, len(rows), imported.Counts.Imported, rec.Body.String())
	contracts := make([]int64, len(rows))
	for i, row := range imported.Rows {
		contracts[i] = int64(row.ContractID)
	}
	target := &testpkg.CareOffering{PhaseID: f.phase, Name: offeringCorrectionTarget, DaysOfWeekMode: "fixed",
		AvailableDays: []string{"mon", "tue", "wed", "thu", "fri"}, AutoAddGradeLevels: []int{}, IsActive: true, CountsAsCare: true}
	target.TenantID = f.school
	testpkg.InsertTestCareOffering(t, f.db, testpkg.TenantContext(f.school), target)
	_, err := f.db.ExecContext(context.Background(), `UPDATE enrollment.care_offerings SET price_cents = 12000 WHERE id = ?`, target.ID)
	require.NoError(t, err)
	return f, contracts, target.ID
}

// offeringCorrectionFile names per row a contract, a weekday, the module it
// books and the module that booking belongs to.
func offeringCorrectionFile(rows ...string) []byte {
	return []byte("Vertrag;Wochentag;Bisheriges Angebot;Zielangebot\n" + strings.Join(rows, "\n") + "\n")
}

func previewOfferingCorrection(t *testing.T, f careContractFixture, token string, file []byte, day string) offeringCorrectionBody {
	t.Helper()
	rec := importForm(t, f.traeger, token, offeringCorrectionPreviewPath, "module.csv", file, map[string]string{"effective_from": day})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[offeringCorrectionBody](t, rec.Body.Bytes())
}

func applyOfferingCorrection(t *testing.T, f careContractFixture, file []byte, day, fingerprint string) offeringCorrectionBody {
	t.Helper()
	rec := importForm(t, f.traeger, f.office.token, offeringCorrectionPath, "module.csv", file,
		map[string]string{"effective_from": day, "fingerprint": fingerprint})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[offeringCorrectionBody](t, rec.Body.Bytes())
}

func countOf(t *testing.T, f careContractFixture, query string, args ...any) int {
	t.Helper()
	var count int
	require.NoError(t, f.db.NewRaw(query, args...).Scan(context.Background(), &count))
	return count
}

type correctedServiceRow struct {
	Weekday        string  `bun:"weekday"`
	CareOfferingID int64   `bun:"care_offering_id"`
	ModuleName     string  `bun:"module_name"`
	EndsAt         string  `bun:"ends_at"`
	LastDay        *string `bun:"last_day"`
}

func versionServices(t *testing.T, f careContractFixture, contract int64, number int) []correctedServiceRow {
	t.Helper()
	var services []correctedServiceRow
	require.NoError(t, f.db.NewRaw(`SELECT s.weekday, s.care_offering_id, s.module_name, COALESCE(s.ends_at::text, '') AS ends_at,
			s.last_day::text AS last_day
		FROM care_contract.contract_version_services AS s
		JOIN care_contract.contract_versions AS v ON v.id = s.contract_version_id
		WHERE v.contract_id = ? AND v.version_number = ?
		ORDER BY array_position(ARRAY['mon', 'tue', 'wed', 'thu', 'fri'], s.weekday), s.module_name`, contract, number).Scan(context.Background(), &services))
	return services
}

func versionTimeline(t *testing.T, f careContractFixture, contract int64) []string {
	t.Helper()
	var timeline []string
	require.NoError(t, f.db.NewRaw(`SELECT version_number || ' ' || status || ' ' || source || ' ' || effective_from::text
		FROM care_contract.contract_versions WHERE contract_id = ? ORDER BY version_number`, contract).Scan(context.Background(), &timeline))
	return timeline
}

// The office corrects which modules imported contracts book (#7764): the
// preview stores nothing, the correction gives each contract a new version
// with the same weekdays, end times and last days in the target module from
// the day on, sends nothing and records the file; billing reads the new
// module from that day, and the same file again changes nothing.
func TestOfferingCorrectionGivesImportedContractsANewVersion(t *testing.T) {
	t.Parallel()
	// Mia's contract began before the day, Ben's begins after it.
	f, contracts, target := offeringCorrectionFixture(t, "Träger Angebotskorrektur",
		"Mia;Beispiel;03.05.2019;{school};Offene Ganztagsschule;01.08.2027;Eva Beispiel;eva.beispiel@example.org;70001",
		"Ben;Beispiel;11.11.2020;{school};Offene Ganztagsschule;01.06.2028;Eva Beispiel;eva.beispiel@example.org;70001")
	mia, ben := contracts[0], contracts[1]
	// Mia's contract is terminated and runs until its last day: the monthly
	// run bills it until then, so the correction reaches it.
	_, err := f.db.ExecContext(context.Background(),
		`UPDATE care_contract.contracts SET status = 'gekuendigt', ends_on = '2028-07-31' WHERE id = ?`, mia)
	require.NoError(t, err)
	const day = "2028-05-01"
	file := offeringCorrectionFile(
		fmt.Sprintf("%d;Mo-Mi;Offene Ganztagsschule;%s", mia, offeringCorrectionTarget),
		fmt.Sprintf("%d;Montag, Dienstag, Mittwoch;Offene Ganztagsschule;%s", ben, offeringCorrectionTarget))
	versionsOf := func() int {
		return countOf(t, f, `SELECT COUNT(*) FROM care_contract.contract_versions WHERE organization_id = ?`, f.office.organization)
	}
	sentOf := func() int {
		return countOf(t, f, `SELECT (SELECT COUNT(*) FROM platform.email_outbox WHERE organization_id = ? OR tenant_id = ?)
			+ (SELECT COUNT(*) FROM platform.push_outbox WHERE organization_id = ? OR tenant_id = ?)`,
			f.office.organization, f.school, f.office.organization, f.school)
	}
	sent := sentOf()
	before := map[int64][]correctedServiceRow{mia: versionServices(t, f, mia, 1), ben: versionServices(t, f, ben, 1)}

	// A day in the past and a file without the columns are no correction.
	rec := importForm(t, f.traeger, f.office.token, offeringCorrectionPreviewPath, "module.csv", file, map[string]string{"effective_from": "2020-01-01"})
	require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "effective_from")
	columns := previewOfferingCorrection(t, f, f.office.token, []byte("Vertrag;Wochentag\n1;Mo\n"), day)
	assert.Equal(t, []string{"current_offering", "target_offering"}, columns.MissingColumns)
	assert.Empty(t, columns.Contracts)

	preview := previewOfferingCorrection(t, f, f.office.token, file, day)
	assert.False(t, preview.Applied)
	assert.NotEmpty(t, preview.Fingerprint)
	assert.Equal(t, 2, preview.Counts.Ready, "%+v", preview.Contracts)
	require.Len(t, preview.Contracts, 2)
	for _, contract := range preview.Contracts {
		assert.Equal(t, "ready", contract.Status)
		assert.Equal(t, 2, contract.VersionNumber)
		require.Len(t, contract.Changes, 1)
		assert.Equal(t, []string{"mon", "tue", "wed"}, contract.Changes[0].Weekdays)
		assert.Equal(t, "Offene Ganztagsschule", contract.Changes[0].From)
		assert.Equal(t, offeringCorrectionTarget, contract.Changes[0].To)
	}
	assert.Equal(t, day, *preview.Contracts[0].EffectiveFrom)
	assert.Equal(t, "2028-06-01", *preview.Contracts[1].EffectiveFrom, "a contract that begins later is corrected from its first day")
	assert.Equal(t, []string{"start_moved"}, preview.Contracts[1].Hints)
	assert.Equal(t, 2, versionsOf(), "a preview stores nothing")

	rec = importForm(t, f.traeger, f.office.token, offeringCorrectionPath, "module.csv", file,
		map[string]string{"effective_from": day, "fingerprint": "stale"})
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "care_contract.import_changed")
	assert.Equal(t, 2, versionsOf(), "a refused correction stores nothing")

	applied := applyOfferingCorrection(t, f, file, day, preview.Fingerprint)
	assert.True(t, applied.Applied)
	assert.Equal(t, 2, applied.Counts.Corrected)
	assert.Equal(t, []string{"1 abgeloest import 2027-08-01", "2 wirksam angebotskorrektur 2028-05-01"}, versionTimeline(t, f, mia),
		"a later day follows the version")
	assert.Equal(t, []string{"1 ersetzt import 2028-06-01", "2 wirksam angebotskorrektur 2028-06-01"}, versionTimeline(t, f, ben),
		"the first day replaces it")
	for _, contract := range contracts {
		want := before[contract]
		require.Len(t, want, 3)
		for i := range want {
			want[i].CareOfferingID, want[i].ModuleName = target, offeringCorrectionTarget
		}
		assert.Equal(t, want, versionServices(t, f, contract, 2), "only the module changes")
		assert.Equal(t, 1, countOf(t, f, `SELECT COUNT(*) FROM care_contract.contract_events
			WHERE contract_id = ? AND action = 'create' AND details->>'offering_correction_file' = 'module.csv'`, contract))
	}
	assert.Equal(t, sent, sentOf(), "the parents get no mail and no push")

	// Billing reads the old module until the day before and the new one from
	// the day on.
	ctx := testpkg.ContextWithTenantRuntime(context.Background(), testpkg.TenantRuntime(t, f.db))
	require.NoError(t, testpkg.WithinTraeger(ctx, f.office.organization, func(ctx context.Context) error {
		periods, err := careContractCompose.NewContractVersions().VersionsInForce(ctx, f.office.organization,
			calendar.NewDate(2028, 4, 1), calendar.NewDate(2028, 5, 31), mia)
		require.NoError(t, err)
		require.Len(t, periods, 2)
		assert.Equal(t, calendar.NewDate(2028, 4, 30), periods[0].Until)
		assert.Equal(t, f.offering, periods[0].Version.Services[0].CareOfferingID.Int64())
		assert.Equal(t, calendar.NewDate(2028, 5, 1), periods[1].From)
		assert.Equal(t, target, periods[1].Version.Services[0].CareOfferingID.Int64())
		return nil
	}))

	// The same file again changes nothing.
	again := previewOfferingCorrection(t, f, f.office.token, file, day)
	assert.Equal(t, 2, again.Counts.Unchanged, "%+v", again.Contracts)
	applied = applyOfferingCorrection(t, f, file, day, again.Fingerprint)
	assert.Zero(t, applied.Counts.Corrected)
	assert.Equal(t, 4, versionsOf())
}

// A correction changes a contract only as a whole, never one from an
// application, and needs the right "Verträge verwalten".
func TestOfferingCorrectionNamesTheContractsItLeavesAlone(t *testing.T) {
	t.Parallel()
	f, contracts, _ := offeringCorrectionFixture(t, "Träger Angebotskorrektur Grenzen",
		"Mia;Beispiel;03.05.2019;{school};Offene Ganztagsschule;01.08.2027;Eva Beispiel;eva.beispiel@example.org;70001",
		"Ben;Anders;11.11.2020;{school};Offene Ganztagsschule;01.08.2027;Anders;;70002",
		"Ole;Muster;11.11.2020;{school};Offene Ganztagsschule;01.08.2027;Muster;;70003")
	mia, ben, ole := contracts[0], contracts[1], contracts[2]
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodPost, "/traeger/contracts", map[string]any{"contracts": []any{f.key()}})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	draft := int64(decodeSchoolPortalData[careContractCreateBody](t, rec.Body.Bytes()).Created[0].ID)
	const day = "2028-05-01"
	file := offeringCorrectionFile(
		fmt.Sprintf("%d;Mo;Offene Ganztagsschule;%s", draft, offeringCorrectionTarget),
		fmt.Sprintf("%d;Mo;Offene Ganztagsschule;%s", mia, offeringCorrectionTarget),
		fmt.Sprintf("%d;Di;Offene Ganztagsschule;", mia),
		fmt.Sprintf("%d;Mo;Offene Ganztagsschule;Gibt es nicht", ben),
		fmt.Sprintf("%d;Do;Offene Ganztagsschule;%s", ole, offeringCorrectionTarget),
		fmt.Sprintf("%d;Mo;Offene Ganztagsschule;%s", ole+draft+mia+ben, offeringCorrectionTarget))

	billing := traegerColleague(t, f.reviewFixture, identityaccess.TraegerRoleBilling)
	fields := map[string]string{"effective_from": day}
	assert.Equal(t, http.StatusForbidden, importForm(t, f.traeger, billing, offeringCorrectionPreviewPath, "module.csv", file, fields).Code)
	assert.Equal(t, http.StatusForbidden, importForm(t, f.traeger, billing, offeringCorrectionPath, "module.csv", file, fields).Code)

	preview := previewOfferingCorrection(t, f, f.office.token, file, day)
	require.Len(t, preview.Contracts, 5)
	type outcome struct{ Status, Problem string }
	outcomes := make([]outcome, len(preview.Contracts))
	for i, contract := range preview.Contracts {
		outcomes[i].Status = contract.Status
		if len(contract.Problems) > 0 {
			outcomes[i].Problem = contract.Problems[0].Field + ":" + contract.Problems[0].Code
		}
	}
	assert.Equal(t, []outcome{
		{"invalid", "contract:follows_bookings"},
		{"held", ""},
		{"invalid", "target_offering:unknown"},
		{"invalid", "current_offering:not_booked"},
		{"invalid", "contract:unknown"},
	}, outcomes)
	assert.Equal(t, 1, preview.Counts.Held)
	assert.Equal(t, 4, preview.Counts.Invalid)

	applied := applyOfferingCorrection(t, f, file, day, preview.Fingerprint)
	assert.Zero(t, applied.Counts.Corrected)
	for _, contract := range []int64{draft, mia, ben, ole} {
		assert.Equal(t, 1, countOf(t, f, `SELECT COUNT(*) FROM care_contract.contract_versions WHERE contract_id = ?`, contract),
			"contract %d keeps its only version", contract)
	}
}
