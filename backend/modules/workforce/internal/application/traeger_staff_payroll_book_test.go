package application

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// A Minijob that ends mid-month and a Teilzeit contract that starts the next
// day at the same employment both run in the month. The school computes the
// month of the employment once, so only the later contract books it, with
// its Lohnart, and the report names the person (#4712).
func TestPayrollBooksAMidMonthContractChangeOnce(t *testing.T) {
	t.Parallel()
	site := domain.ContractTarget{ContractSite: domain.ContractSite{SchoolID: 1, StaffID: 10}}
	number := "00417"
	scene := exportScene{
		schools: []workforce.TraegerStaffSchool{{ID: 1, Name: "OGS Nord"}},
		names:   map[int64]string{1: "OGS Nord"},
		records: map[int64]domain.TraegerStaffRecord{7: {ID: 7, FirstName: "Mira", LastName: "Sommer", PersonnelNumber: &number}},
		contracts: []domain.TraegerStaffContract{
			{ID: 2, RecordID: 7, Kind: domain.ContractKindPartTime, StartsOn: calendar.NewDate(2026, 10, 16), Targets: []domain.ContractTarget{site}},
			{ID: 1, RecordID: 7, Kind: domain.ContractKindMinijob, StartsOn: calendar.NewDate(2026, 8, 1), EndsOn: calendar.NewDate(2026, 10, 15), Targets: []domain.ContractTarget{site}},
		},
	}
	months := map[siteKey]schoolPayrollMonth{
		{1, 10}: {schoolID: 1, school: "OGS Nord", month: workforce.TraegerPayrollMonth{StaffID: 10, RegularMinutes: 600, Closed: true}},
	}
	settings := workforce.TraegerPayrollSettings{
		ConsultantNumber: "29098", ClientNumber: "55003",
		WageTypes: map[string]map[string]string{workforce.TraegerPayrollRegular: {
			domain.ContractKindPartTime: "100", domain.ContractKindMinijob: "200",
		}},
	}

	book := newPayrollBook(settings, workforce.TraegerExportMonth{Year: 2026, Month: 10, Format: workforce.TraegerPayrollFormatLodas})
	targets := payrollTargets{settings: settings, names: scene.names}
	owners, changes := scene.siteOwners()
	for _, contract := range scene.contractsByName() {
		record := scene.records[contract.RecordID]
		book.add(record, contract, targets.groups(record, contractMonths(contract, owners, months)))
	}
	book.contractChanges(scene, changes)
	report := book.finish(scene, months)

	lines := book.byKey[payrollFileTraeger].lines
	require.Len(t, lines, 1)
	assert.Equal(t, "100", lines[0].WageType, "the Teilzeit contract books the month")
	assert.Equal(t, 600, *lines[0].HoursMinutes)
	assert.Equal(t, 1, report.Contracts)
	require.Len(t, report.ContractChanges, 1)
	assert.Equal(t, "Sommer", report.ContractChanges[0].LastName)
	assert.True(t, report.Ready)
}

// A change at a school that no longer exists names nobody: the export reads
// and logs no month there, so the report may not name the person either.
func TestPayrollNamesNoContractChangeAtADeletedSchool(t *testing.T) {
	t.Parallel()
	gone := domain.ContractTarget{ContractSite: domain.ContractSite{SchoolID: 2, StaffID: 20}}
	scene := exportScene{
		names: map[int64]string{1: "OGS Nord"},
		contracts: []domain.TraegerStaffContract{
			{ID: 1, RecordID: 7, StartsOn: calendar.NewDate(2026, 8, 1), EndsOn: calendar.NewDate(2026, 10, 15), Targets: []domain.ContractTarget{gone}},
			{ID: 2, RecordID: 7, StartsOn: calendar.NewDate(2026, 10, 16), Targets: []domain.ContractTarget{gone}},
		},
	}
	_, changes := scene.siteOwners()
	assert.Empty(t, changes)
}

// The time report counts and names only people with a kept employment: an
// external caregiver records no time and is neither counted nor named.
func TestTimeReportCountsOnlyKeptEmployments(t *testing.T) {
	t.Parallel()
	number := "00417"
	scene := exportScene{
		names: map[int64]string{1: "OGS Nord"},
		records: map[int64]domain.TraegerStaffRecord{
			7: {ID: 7, LastName: "Sommer", PersonnelNumber: &number, Links: []domain.TraegerStaffLink{{SchoolID: 1, StaffID: 10}}},
			8: {ID: 8, LastName: "Keller", Links: []domain.TraegerStaffLink{{SchoolID: 1, StaffID: 11}}},
			9: {ID: 9, LastName: "Berg", Links: []domain.TraegerStaffLink{{SchoolID: 1, StaffID: 12}}},
		},
	}
	staff := timeExportStaff(scene)
	assert.Equal(t, []int64{10}, staff.bySchool[1])
	report := workforce.TraegerTimeReport{WithoutNumber: []workforce.TraegerExportPerson{}}
	staff.countPeople(map[siteKey]bool{{1, 10}: true, {1, 11}: true}, &report)
	assert.Equal(t, 1, report.People)
	require.Len(t, report.WithoutNumber, 1, "Berg is an external caregiver")
	assert.Equal(t, "Keller", report.WithoutNumber[0].LastName)
}
