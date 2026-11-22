package application

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The time export of the Träger (#4712, ADR 0089 section 11): a fixed CSV
// for a Träger with its own time system, one row per Personalnummer, day and
// Einsatzort. The columns are public in the help article „Lohnexport und
// Zeitexport“ and change only with a new version of that description.

// traegerTimeHeader is the first row of the file.
var traegerTimeHeader = []string{
	"Personalnummer", "Nachname", "Vorname", "Datum", "Einsatzort", "Beginn", "Ende",
	"Pause_Minuten", "Ist_Minuten", "Abwesenheit", "Abwesenheitsart",
}

// timeRow is one row of the file before serialization.
type timeRow struct {
	record domain.TraegerStaffRecord
	school string
	day    workforce.TraegerTimeDay
}

// TimeReport is the check of the time export.
func (t *TraegerStaff) TimeReport(ctx context.Context, actor workforce.TraegerStaffActor, month workforce.TraegerExportMonth) (workforce.TraegerTimeReport, error) {
	report, _, err := t.timeRows(ctx, actor, month, workforce.TraegerStaffViewTimeReport)
	return report, err
}

// TimeFile renders the CSV: UTF-8 with BOM for spreadsheets, semicolons,
// ISO dates, clock times as HH:MM and durations in whole minutes.
func (t *TraegerStaff) TimeFile(ctx context.Context, actor workforce.TraegerStaffActor, month workforce.TraegerExportMonth) (workforce.TraegerExportFile, error) {
	_, rows, err := t.timeRows(ctx, actor, month, workforce.TraegerStaffViewTimeExport)
	if err != nil {
		return workforce.TraegerExportFile{}, err
	}
	data, err := traegerTimeCSV(rows)
	if err != nil {
		return workforce.TraegerExportFile{}, err
	}
	return workforce.TraegerExportFile{
		Data: data, ContentType: "text/csv; charset=utf-8",
		Filename: fmt.Sprintf("zeitexport_%04d-%02d.csv", month.Year, month.Month),
	}, nil
}

// timeRows reads every live employment of the records with Personalnummer,
// one tenant transaction per school, the access entry first.
func (t *TraegerStaff) timeRows(ctx context.Context, actor workforce.TraegerStaffActor, month workforce.TraegerExportMonth, view string) (workforce.TraegerTimeReport, []timeRow, error) {
	first, last, err := t.exportMonthBounds(month)
	if err != nil {
		return workforce.TraegerTimeReport{}, nil, err
	}
	if t.ports.Exports == nil {
		return workforce.TraegerTimeReport{}, nil, fmt.Errorf("traeger time export: the school days are required")
	}
	scene, err := t.exportScene(ctx, actor, nil)
	if err != nil {
		return workforce.TraegerTimeReport{}, nil, err
	}
	report := workforce.TraegerTimeReport{Year: month.Year, Month: month.Month, WithoutNumber: []workforce.TraegerExportPerson{}}
	staff := timeExportStaff(scene)
	kept := map[siteKey]bool{}
	var rows []timeRow
	for _, school := range scene.schools {
		answer, err := t.schoolTimeDays(ctx, actor, view, staff, school.ID.Int64(), first, last)
		if err != nil {
			return workforce.TraegerTimeReport{}, nil, err
		}
		inFile := false
		for _, staffID := range answer.Kept {
			kept[siteKey{school.ID.Int64(), staffID}] = true
			inFile = inFile || slices.Contains(staff.bySchool[school.ID.Int64()], staffID)
		}
		if inFile {
			report.Schools++
		}
		for _, day := range answer.Days {
			rows = append(rows, timeRow{record: staff.owners[siteKey{school.ID.Int64(), day.StaffID}], school: school.Name, day: day})
		}
	}
	staff.countPeople(kept, &report)
	sortTimeRows(rows)
	report.Rows = len(rows)
	return report, rows, nil
}

// schoolTimeDays reads the days of one school in its tenant transaction.
// The report names the people without a Personalnummer too, so their access
// is logged with the people in the file before any day is read.
func (t *TraegerStaff) schoolTimeDays(ctx context.Context, actor workforce.TraegerStaffActor, view string, staff timeStaff,
	schoolID int64, first, last calendar.Date,
) (workforce.TraegerTimeSchool, error) {
	named := staff.namedBySchool[schoolID]
	if len(named) == 0 {
		return workforce.TraegerTimeSchool{}, nil
	}
	var answer workforce.TraegerTimeSchool
	err := t.ports.Runtime.WithinSchool(ctx, schoolID, func(ctx context.Context) error {
		if err := t.recordExportAccess(ctx, actor, view, named); err != nil {
			return err
		}
		var err error
		answer, err = t.ports.Exports.TraegerTimeDays(ctx, workforce.TraegerTimeRequest{
			StaffIDs: named, DaysFor: staff.bySchool[schoolID], From: first, To: last,
		})
		return err
	})
	return answer, err
}

// timeStaff are the employments of the time export by school: bySchool
// those of records with a Personalnummer, namedBySchool every live one.
type timeStaff struct {
	records                 []domain.TraegerStaffRecord
	links                   map[int64][]domain.TraegerStaffLink
	bySchool, namedBySchool map[int64][]int64
	owners                  map[siteKey]domain.TraegerStaffRecord
}

// timeExportStaff groups the live employments of the records by school.
func timeExportStaff(scene exportScene) timeStaff {
	staff := timeStaff{
		links: map[int64][]domain.TraegerStaffLink{}, bySchool: map[int64][]int64{}, namedBySchool: map[int64][]int64{},
		owners: map[siteKey]domain.TraegerStaffRecord{},
	}
	for _, record := range scene.recordsByName() {
		links := liveLinks(record, scene.names)
		if len(links) == 0 {
			continue
		}
		staff.records, staff.links[record.ID] = append(staff.records, record), links
		numbered := record.PersonnelNumber != nil && *record.PersonnelNumber != ""
		for _, link := range links {
			staff.namedBySchool[link.SchoolID] = append(staff.namedBySchool[link.SchoolID], link.StaffID)
			staff.owners[siteKey{link.SchoolID, link.StaffID}] = record
			if numbered {
				staff.bySchool[link.SchoolID] = append(staff.bySchool[link.SchoolID], link.StaffID)
			}
		}
	}
	return staff
}

// countPeople counts the records with a kept employment and names those
// without a Personalnummer; an external caregiver is neither.
func (s timeStaff) countPeople(kept map[siteKey]bool, report *workforce.TraegerTimeReport) {
	for _, record := range s.records {
		if !slices.ContainsFunc(s.links[record.ID], func(link domain.TraegerStaffLink) bool { return kept[siteKey{link.SchoolID, link.StaffID}] }) {
			continue
		}
		if record.PersonnelNumber == nil || *record.PersonnelNumber == "" {
			report.WithoutNumber = append(report.WithoutNumber, workforce.TraegerExportPerson{RecordID: ident.ID(record.ID), FirstName: record.FirstName, LastName: record.LastName})
			continue
		}
		report.People++
	}
}

// recordsByName lists the records by the name of the person.
func (s exportScene) recordsByName() []domain.TraegerStaffRecord {
	records := make([]domain.TraegerStaffRecord, 0, len(s.records))
	for _, record := range s.records {
		records = append(records, record)
	}
	slices.SortFunc(records, compareNames)
	return records
}

// liveLinks are the links of the record at an undeleted school.
func liveLinks(record domain.TraegerStaffRecord, names map[int64]string) []domain.TraegerStaffLink {
	var links []domain.TraegerStaffLink
	for _, link := range record.Links {
		if _, live := names[link.SchoolID]; live {
			links = append(links, link)
		}
	}
	return links
}

// sortTimeRows orders by person, day and school.
func sortTimeRows(rows []timeRow) {
	slices.SortStableFunc(rows, func(a, b timeRow) int {
		if order := compareNames(a.record, b.record); order != 0 {
			return order
		}
		if order := a.day.Date.Compare(b.day.Date); order != 0 {
			return order
		}
		return strings.Compare(a.school, b.school)
	})
}

func traegerTimeCSV(rows []timeRow) ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&buf)
	writer.Comma = ';'
	lines := [][]string{traegerTimeHeader}
	for _, row := range rows {
		lines = append(lines, []string{
			*row.record.PersonnelNumber, domain.SpreadsheetSafe(row.record.LastName), domain.SpreadsheetSafe(row.record.FirstName),
			row.day.Date.String(), domain.SpreadsheetSafe(row.school), row.day.Start, row.day.End,
			strconv.Itoa(row.day.BreakMinutes), strconv.Itoa(row.day.ActualMinutes),
			row.day.AbsenceKind, domain.SpreadsheetSafe(row.day.AbsenceLabel),
		})
	}
	if err := writer.WriteAll(lines); err != nil {
		return nil, fmt.Errorf("write the time export: %w", err)
	}
	return buf.Bytes(), nil
}
