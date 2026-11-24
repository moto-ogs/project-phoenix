package application

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/text/encoding/charmap"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The payroll file per employer (#8041, ADR 0320). OGS Nord employs through
// the Träger, the Gemeinde Hardt employs the staff of OGS Süd. Mira works at
// both, Jonas only at OGS Süd, Lea is a Springer of the Vertretungspool at
// OGS Süd and so stays with the Träger.
type employerScene struct {
	scene    exportScene
	months   map[siteKey]schoolPayrollMonth
	settings workforce.TraegerPayrollSettings
	targets  payrollTargets
}

func newEmployerScene(form string, gemeinde domain.TraegerPayrollEmployer, jonasNumber *string) employerScene {
	str := func(value string) *string { return &value }
	nord := func(staff int64) domain.ContractTarget {
		return domain.ContractTarget{ContractSite: domain.ContractSite{SchoolID: 1, StaffID: staff}}
	}
	sued := func(staff int64) domain.ContractTarget {
		return domain.ContractTarget{ContractSite: domain.ContractSite{SchoolID: 2, StaffID: staff}}
	}
	start := calendar.NewDate(2026, 8, 1)
	jonasLink := domain.TraegerStaffLink{SchoolID: 2, StaffID: 21}
	if jonasNumber != nil {
		jonasLink.EmployerBody, jonasLink.EmployerNumber = workforce.TraegerEmployerGemeinde, jonasNumber
	}
	scene := exportScene{
		schools: []workforce.TraegerStaffSchool{{ID: 1, Name: "OGS Nord"}, {ID: 2, Name: "OGS Süd"}},
		names:   map[int64]string{1: "OGS Nord", 2: "OGS Süd"},
		records: map[int64]domain.TraegerStaffRecord{
			7: {ID: 7, FirstName: "Mira", LastName: "Sommer", PersonnelNumber: str("100"),
				Links: []domain.TraegerStaffLink{{SchoolID: 1, StaffID: 10}, {SchoolID: 2, StaffID: 20}}},
			8: {ID: 8, FirstName: "Jonas", LastName: "Winter", PersonnelNumber: str("200"), Links: []domain.TraegerStaffLink{jonasLink}},
			9: {ID: 9, FirstName: "Lea", LastName: "Herbst", PersonnelNumber: str("300"),
				Links: []domain.TraegerStaffLink{{SchoolID: 2, StaffID: 22, ViaPool: true}}},
		},
		contracts: []domain.TraegerStaffContract{
			{ID: 1, RecordID: 7, Kind: domain.ContractKindPartTime, StartsOn: start, Targets: []domain.ContractTarget{nord(10), sued(20)}},
			{ID: 2, RecordID: 8, Kind: domain.ContractKindPartTime, StartsOn: start, Targets: []domain.ContractTarget{sued(21)}},
			{ID: 3, RecordID: 9, Kind: domain.ContractKindPartTime, StartsOn: start, Targets: []domain.ContractTarget{sued(22)}},
		},
	}
	month := func(school int64, name string, staff int64, minutes int) schoolPayrollMonth {
		return schoolPayrollMonth{schoolID: school, school: name, month: workforce.TraegerPayrollMonth{StaffID: staff, RegularMinutes: minutes, Closed: true}}
	}
	months := map[siteKey]schoolPayrollMonth{
		{1, 10}: month(1, "OGS Nord", 10, 600),
		{2, 20}: month(2, "OGS Süd", 20, 300),
		{2, 21}: month(2, "OGS Süd", 21, 120),
		{2, 22}: month(2, "OGS Süd", 22, 60),
	}
	settings := workforce.TraegerPayrollSettings{
		Form: form, ConsultantNumber: "29098", ClientNumber: "55004",
		WageTypes: map[string]map[string]string{workforce.TraegerPayrollRegular: {domain.ContractKindPartTime: "1000"}},
	}
	gemeinde.SchoolID, gemeinde.Body = 2, workforce.TraegerEmployerGemeinde
	targets := payrollTargets{
		settings:  settings,
		employers: map[int64]workforce.TraegerStaffEmployer{2: {Body: workforce.TraegerEmployerGemeinde, Name: "Gemeinde Hardt"}},
		values:    map[employerKey]*domain.TraegerPayrollEmployer{{2, workforce.TraegerEmployerGemeinde}: &gemeinde},
		names:     scene.names,
	}
	return employerScene{scene: scene, months: months, settings: settings, targets: targets}
}

func (e employerScene) run(t *testing.T) (*payrollBook, workforce.TraegerPayrollReport) {
	t.Helper()
	book := newPayrollBook(e.settings, workforce.TraegerExportMonth{Year: 2026, Month: 10, Format: workforce.TraegerPayrollFormatLodas})
	owners, changes := e.scene.siteOwners()
	for _, contract := range e.scene.contractsByName() {
		record := e.scene.records[contract.RecordID]
		book.add(record, contract, e.targets.groups(record, contractMonths(contract, owners, e.months)))
	}
	book.contractChanges(e.scene, changes)
	return book, book.finish(e.scene, e.months)
}

func lodasText(t *testing.T, lines []domain.DatevPayrollLine, consultant, client string) string {
	t.Helper()
	decoded, err := charmap.Windows1252.NewDecoder().Bytes(domain.WriteDatevLodas(lines, consultant, client, 2026, 10))
	require.NoError(t, err)
	return strings.ReplaceAll(string(decoded), "\r\n", "\n")
}

// The one file of the Träger keeps the Träger's DATEV client and marks every
// line of the Gemeinde with its Kostenstelle: Mira gets one line per
// employer, the Springer stays unmarked with the Träger.
func TestPayrollOneFileMarksTheLinesOfAnotherEmployer(t *testing.T) {
	t.Parallel()
	book, report := newEmployerScene(workforce.TraegerPayrollFormTraeger,
		domain.TraegerPayrollEmployer{CostCenter: "4711", ConsultantNumber: "1234", ClientNumber: "567"}, nil).run(t)

	require.Len(t, report.Files, 1)
	file := report.Files[0]
	assert.Equal(t, payrollFileTraeger, file.Key)
	assert.True(t, file.Ready)
	assert.True(t, report.Ready)
	assert.Equal(t, 4, file.LineCount)
	require.Len(t, report.Employers, 1)
	assert.Equal(t, "Gemeinde Hardt", report.Employers[0].Name)
	assert.False(t, report.Employers[0].MissingCostCenter)
	assert.Empty(t, report.InSeveralFiles, "one file names nobody in several")

	text := lodasText(t, book.byKey[file.Key].lines, file.ConsultantNumber, file.ClientNumber)
	assert.Contains(t, text, "BeraterNr=29098\nMandantenNr=55004\n")
	assert.Contains(t, text, "4;u_lod_bwd_buchung_stunden;pnr#bwd;abrechnung_zeitraum#bwd;stunden#bwd;la_eigene#bwd;kostenstelle#bwd;\n")
	assert.Contains(t, text, "1;100;01.10.2026;10,00;1000;\n", "Mira at OGS Nord, Träger, unmarked")
	assert.Contains(t, text, "4;100;01.10.2026;5,00;1000;4711;\n", "Mira at OGS Süd, Gemeinde, marked")
	assert.Contains(t, text, "4;200;01.10.2026;2,00;1000;4711;\n", "Jonas, Gemeinde, marked")
	assert.Contains(t, text, "1;300;01.10.2026;1,00;1000;\n", "Lea of the pool stays with the Träger")
}

// Without its Kostenstelle the Gemeinde's lines would stand unmarked
// beside the Träger's: the one file waits and names the employer.
func TestPayrollOneFileWaitsForTheCostCenter(t *testing.T) {
	t.Parallel()
	_, report := newEmployerScene(workforce.TraegerPayrollFormTraeger, domain.TraegerPayrollEmployer{}, nil).run(t)

	require.Len(t, report.Files, 1)
	assert.False(t, report.Files[0].Ready)
	assert.False(t, report.Ready)
	require.Len(t, report.Employers, 1)
	assert.True(t, report.Employers[0].MissingCostCenter)
	assert.False(t, report.Employers[0].MissingClient, "the one file needs no client of the Gemeinde")
}

// The form per employer writes one file per DATEV client with its own head.
// Jonas books under his number with the Gemeinde, Mira under the Träger's
// number in both files, and the report names her as in several files.
func TestPayrollFilePerEmployerSplitsByClient(t *testing.T) {
	t.Parallel()
	jonas := "7"
	book, report := newEmployerScene(workforce.TraegerPayrollFormArbeitgeber,
		domain.TraegerPayrollEmployer{ConsultantNumber: "1234", ClientNumber: "567"}, &jonas).run(t)

	require.Len(t, report.Files, 2)
	traeger, gemeinde := report.Files[0], report.Files[1]
	assert.Equal(t, "29098-55004", traeger.Key, "the Träger's file comes first")
	assert.Equal(t, []workforce.TraegerPayrollFileEmployer{{Body: payrollBodyTraeger}}, traeger.Employers)
	assert.Equal(t, []string{"OGS Nord", "OGS Süd"}, traeger.Schools, "the Springer at OGS Süd books with the Träger")
	assert.Equal(t, "1234-567", gemeinde.Key)
	assert.Equal(t, []workforce.TraegerPayrollFileEmployer{{Body: workforce.TraegerEmployerGemeinde, Name: "Gemeinde Hardt"}}, gemeinde.Employers)
	assert.Equal(t, []string{"OGS Süd"}, gemeinde.Schools)
	assert.True(t, traeger.Ready)
	assert.True(t, gemeinde.Ready)
	assert.True(t, report.Ready)
	require.Len(t, report.InSeveralFiles, 1)
	assert.Equal(t, "Sommer", report.InSeveralFiles[0].LastName)

	traegerText := lodasText(t, book.byKey[traeger.Key].lines, traeger.ConsultantNumber, traeger.ClientNumber)
	assert.Contains(t, traegerText, "BeraterNr=29098\nMandantenNr=55004\n")
	assert.Contains(t, traegerText, "1;100;01.10.2026;10,00;1000;\n")
	assert.Contains(t, traegerText, "1;300;01.10.2026;1,00;1000;\n")
	assert.NotContains(t, traegerText, "200", "no line of the Gemeinde in the Träger's file")
	assert.NotContains(t, traegerText, "kostenstelle", "a file per employer marks nothing")

	gemeindeText := lodasText(t, book.byKey[gemeinde.Key].lines, gemeinde.ConsultantNumber, gemeinde.ClientNumber)
	assert.Contains(t, gemeindeText, "BeraterNr=1234\nMandantenNr=567\n")
	assert.Contains(t, gemeindeText, "1;100;01.10.2026;5,00;1000;\n")
	assert.Contains(t, gemeindeText, "1;7;01.10.2026;2,00;1000;\n", "Jonas under his number with the Gemeinde")
	assert.NotContains(t, gemeindeText, ";300;", "the Springer is not in the Gemeinde's file")
}

// A Gemeinde without DATEV client keeps a file that waits; the Träger's file
// can still be made.
func TestPayrollFilePerEmployerWaitsOnlyForTheEmployerWithoutClient(t *testing.T) {
	t.Parallel()
	_, report := newEmployerScene(workforce.TraegerPayrollFormArbeitgeber, domain.TraegerPayrollEmployer{CostCenter: "4711"}, nil).run(t)

	require.Len(t, report.Files, 2)
	assert.True(t, report.Files[0].Ready, "the Träger's file")
	assert.Equal(t, "s2-gemeinde", report.Files[1].Key)
	assert.True(t, report.Files[1].MissingClient)
	assert.False(t, report.Files[1].Ready)
	assert.False(t, report.Ready)
	require.Len(t, report.Employers, 1)
	assert.True(t, report.Employers[0].MissingClient)
	assert.False(t, report.Employers[0].MissingCostCenter, "the form per employer needs no Kostenstelle")
}

// Two people under one number in one file would book as one person in
// DATEV: the file waits and names both.
func TestPayrollFileRefusesOneNumberForTwoPeople(t *testing.T) {
	t.Parallel()
	taken := "100"
	_, report := newEmployerScene(workforce.TraegerPayrollFormArbeitgeber,
		domain.TraegerPayrollEmployer{ConsultantNumber: "1234", ClientNumber: "567"}, &taken).run(t)

	gemeinde := report.Files[1]
	require.Len(t, gemeinde.Duplicates, 1)
	assert.Equal(t, "100", gemeinde.Duplicates[0].Number)
	assert.Len(t, gemeinde.Duplicates[0].People, 2)
	assert.False(t, gemeinde.Ready)
	assert.True(t, report.Files[0].Ready)
}

// A number per employer kept for another body does not hold once the
// school names a different employer.
func TestPayrollEmployerNumberHoldsOnlyForItsBody(t *testing.T) {
	t.Parallel()
	link := domain.TraegerStaffLink{SchoolID: 2, EmployerBody: workforce.TraegerEmployerSchultraeger, EmployerNumber: new("7")}
	assert.Nil(t, link.EmployerNumberFor(workforce.TraegerEmployerGemeinde))
	assert.Nil(t, link.EmployerNumberFor(""))
	assert.Equal(t, "7", *link.EmployerNumberFor(workforce.TraegerEmployerSchultraeger))
}

// A person whose Einsatzort at the Träger had no value in the month books
// no line there: the form per employer shows no empty file of the Träger
// and does not name her as in several files.
func TestPayrollFilePerEmployerLeavesOutAFileWithoutLines(t *testing.T) {
	t.Parallel()
	jonas := "7"
	scene := newEmployerScene(workforce.TraegerPayrollFormArbeitgeber,
		domain.TraegerPayrollEmployer{ConsultantNumber: "1234", ClientNumber: "567"}, &jonas)
	delete(scene.scene.records, 9)
	scene.scene.contracts = scene.scene.contracts[:2]
	scene.months[siteKey{1, 10}] = schoolPayrollMonth{schoolID: 1, school: "OGS Nord", month: workforce.TraegerPayrollMonth{StaffID: 10, Closed: true}}
	_, report := scene.run(t)

	require.Len(t, report.Files, 1, "only the Gemeinde's file has lines")
	assert.Equal(t, "1234-567", report.Files[0].Key)
	assert.Empty(t, report.InSeveralFiles)
	assert.True(t, report.Ready)
}
