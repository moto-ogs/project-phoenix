package application

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"slices"
	"strings"
	"unicode"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// The Personal-Import of the Träger-Portal (#4724, ADR 0089 section 5). A
// look at a file reads it, maps its columns and checks every row against
// the records of the Träger by personnel number; with Apply it stores the
// new and complete rows in one Träger transaction, after it has checked the
// rows again against the confirmed preview. Rows whose record has
// Einsatzorte write an access entry at each of those schools first (ADR
// 0084 section 7). The file is never stored.

var _ workforce.TraegerStaffImports = (*TraegerStaff)(nil)

// staffImportLogLimit bounds the imports the log lists.
const staffImportLogLimit = 50

// staffImportRequired are the fields every import needs a column for.
var staffImportRequired = []string{
	workforce.StaffImportFieldPersonnelNumber, workforce.StaffImportFieldFirstName, workforce.StaffImportFieldLastName,
}

// staffImportHeaderNames are the header names moto maps by itself, after
// textnorm.HeaderKey folded them.
var staffImportHeaderNames = map[string][]string{
	workforce.StaffImportFieldPersonnelNumber: {"personalnummer", "personalnr", "persnr", "pnr", "mitarbeiternummer", "mitarbeiternr",
		"manr", "personalnummerdatev", "personnelnumber", "employeenumber", "employeeid"},
	workforce.StaffImportFieldFirstName: {"vorname", "rufname", "firstname", "givenname"},
	workforce.StaffImportFieldLastName:  {"nachname", "familienname", "name", "lastname", "surname", "familyname"},
	workforce.StaffImportFieldBirthday:  {"geburtsdatum", "geburtstag", "gebdatum", "gebam", "geboren", "geborenam", "birthday", "dateofbirth", "birthdate"},
	workforce.StaffImportFieldIBAN:      {"iban", "kontoiban", "bankverbindungiban"},
	workforce.StaffImportFieldTaxID: {"steuerid", "steueridentifikationsnummer", "steuerlicheidentifikationsnummer", "idnr", "identnummer",
		"steueridnr", "taxid"},
	workforce.StaffImportFieldSocialSecurityNumber: {"svnummer", "sozialversicherungsnummer", "rentenversicherungsnummer", "versicherungsnummer",
		"svnr", "rvnr", "rvnummer", "socialsecuritynumber"},
}

// staffImportTable is a decoded file.
type staffImportTable struct {
	read    textnorm.CSVTable
	content []byte
}

// staffImportRow is one row of the file with its check.
type staffImportRow struct {
	line  int
	check domain.StaffImportCheck
}

// staffImportPlan is how the columns of a file map to the fields.
type staffImportPlan struct {
	mapping workforce.StaffImportMapping
	columns map[string]int
}

// staffImportScene is what one evaluation found: every row and the records
// the rows match, by ID.
type staffImportScene struct {
	rows    []staffImportRow
	matched map[int64]domain.TraegerStaffRecord
}

// ImportStaff reads the file, answers every row and, with Apply, stores the
// new and complete rows.
func (t *TraegerStaff) ImportStaff(ctx context.Context, actor workforce.TraegerStaffActor, request workforce.StaffImportRequest) (workforce.StaffImport, error) {
	table, err := readStaffImportTable(request.Content, request.Delimiter)
	if err != nil {
		return workforce.StaffImport{}, err
	}
	result := workforce.StaffImport{Encoding: table.read.Encoding, Delimiter: table.read.Delimiter, Headers: table.read.Headers,
		Unmapped: []string{}, Rows: []workforce.StaffImportRow{}}
	result.Mapping = suggestStaffImportMapping(table.read.Headers)
	if request.Mapping != nil {
		result.Mapping = *request.Mapping
	}
	columns, unmapped, err := staffImportColumns(table.read.Headers, result.Mapping)
	if err != nil {
		return workforce.StaffImport{}, err
	}
	result.Unmapped = unmapped
	var scene staffImportScene
	err = t.released(ctx, actor, func(ctx context.Context) error {
		if len(unmapped) > 0 {
			return nil
		}
		scene, err = t.evaluateStaffImport(ctx, actor, table, columns)
		return err
	})
	if err != nil {
		return workforce.StaffImport{}, publicTraegerStaffError(err)
	}
	if len(unmapped) > 0 {
		if request.Apply {
			return workforce.StaffImport{}, &workforce.StaffImportMappingError{Field: unmapped[0], Reason: "needs a column"}
		}
		return result, nil
	}
	if err := t.logStaffImportAccess(ctx, actor, scene); err != nil {
		return workforce.StaffImport{}, err
	}
	result.Fingerprint = staffImportFingerprint(result.Mapping, table.content, scene.rows)
	if request.Apply {
		if scene, err = t.applyStaffImport(ctx, actor, request, table, staffImportPlan{mapping: result.Mapping, columns: columns}, result.Fingerprint); err != nil {
			return workforce.StaffImport{}, err
		}
		result.Applied = true
	}
	for _, row := range scene.rows {
		public := publicStaffImportRow(row)
		result.Rows = append(result.Rows, public)
		countStaffImportRow(&result.Counts, public.Status)
	}
	return result, nil
}

// readStaffImportTable decodes and splits the file. It refuses binary
// content, a file without a header and a data row, repeated headers, a
// first row that holds an IBAN instead of headers, and more than
// MaxStaffImportRows rows.
func readStaffImportTable(content []byte, delimiter string) (staffImportTable, error) {
	if len(content) > workforce.MaxStaffImportFileBytes {
		return staffImportTable{}, workforce.ErrStaffImportFileTooLarge
	}
	read, err := textnorm.ReadCSVTable(content, delimiter, workforce.MaxStaffImportRows)
	if errors.Is(err, textnorm.ErrCSVTooManyRows) {
		return staffImportTable{}, workforce.ErrStaffImportFileTooLarge
	}
	if err != nil || len(read.Headers) < 2 || len(read.Rows) == 0 || textnorm.RepeatedCSVHeader(read.Headers) || headerHoldsIBAN(read.Headers) {
		return staffImportTable{}, workforce.ErrStaffImportFileInvalid
	}
	return staffImportTable{read: read, content: content}, nil
}

// headerHoldsIBAN tells whether the first row is a person rather than
// headers: the answer repeats the headers, and an IBAN leaves moto only
// masked.
func headerHoldsIBAN(headers []string) bool {
	for _, header := range headers {
		if section, err := domain.NormalizeFinancialSection(domain.FinancialSection{IBAN: &header}); err == nil && section.IBAN != nil {
			return true
		}
	}
	return false
}

// suggestStaffImportMapping maps each field to the first header with one of
// its names.
func suggestStaffImportMapping(headers []string) workforce.StaffImportMapping {
	found := map[string]string{}
	for _, header := range headers {
		key := textnorm.HeaderKey(header)
		for field, names := range staffImportHeaderNames {
			if _, done := found[field]; !done && slices.Contains(names, key) {
				found[field] = header
			}
		}
	}
	return workforce.StaffImportMapping{Columns: workforce.StaffImportColumns{
		PersonnelNumber: found[workforce.StaffImportFieldPersonnelNumber], FirstName: found[workforce.StaffImportFieldFirstName],
		LastName: found[workforce.StaffImportFieldLastName], Birthday: found[workforce.StaffImportFieldBirthday],
		IBAN: found[workforce.StaffImportFieldIBAN], TaxID: found[workforce.StaffImportFieldTaxID],
		SocialSecurityNumber: found[workforce.StaffImportFieldSocialSecurityNumber],
	}}
}

func staffImportMappingHeaders(columns workforce.StaffImportColumns) map[string]string {
	return map[string]string{
		workforce.StaffImportFieldPersonnelNumber: columns.PersonnelNumber, workforce.StaffImportFieldFirstName: columns.FirstName,
		workforce.StaffImportFieldLastName: columns.LastName, workforce.StaffImportFieldBirthday: columns.Birthday,
		workforce.StaffImportFieldIBAN: columns.IBAN, workforce.StaffImportFieldTaxID: columns.TaxID,
		workforce.StaffImportFieldSocialSecurityNumber: columns.SocialSecurityNumber,
	}
}

// staffImportColumns finds the column of each mapped field. A header the
// file does not have refuses the mapping; unmapped names the required
// fields without a column.
func staffImportColumns(headers []string, mapping workforce.StaffImportMapping) (map[string]int, []string, error) {
	columns := map[string]int{}
	for _, field := range domain.StaffRecordFields {
		header := staffImportMappingHeaders(mapping.Columns)[field]
		if header == "" {
			continue
		}
		position := slices.Index(headers, header)
		if position < 0 {
			return nil, nil, &workforce.StaffImportMappingError{Field: field, Reason: "names no column of the file"}
		}
		columns[field] = position
	}
	unmapped := []string{}
	for _, field := range staffImportRequired {
		if _, ok := columns[field]; !ok {
			unmapped = append(unmapped, field)
		}
	}
	return columns, unmapped, nil
}

// evaluateStaffImport reads the records of the Träger once, opens the bank
// values of the records the file names, and checks every row.
func (t *TraegerStaff) evaluateStaffImport(ctx context.Context, actor workforce.TraegerStaffActor, table staffImportTable, columns map[string]int) (staffImportScene, error) {
	records, err := t.store.ListStaffRecords(ctx, actor.OrganizationID)
	if err != nil {
		return staffImportScene{}, err
	}
	byNumber := make(map[string]domain.TraegerStaffRecord, len(records))
	for _, record := range records {
		if record.PersonnelNumber != nil {
			byNumber[*record.PersonnelNumber] = record
		}
	}
	today, err := calendar.ParseDate(t.clock.Today())
	if err != nil {
		return staffImportScene{}, fmt.Errorf("workforce: today of the import: %w", err)
	}
	scene := staffImportScene{rows: make([]staffImportRow, len(table.read.Rows)), matched: map[int64]domain.TraegerStaffRecord{}}
	checks := make([]domain.StaffImportCheck, len(table.read.Rows))
	for i, cells := range table.read.Rows {
		raw := staffImportRaw(cells, columns)
		record, ok := byNumber[strings.TrimSpace(raw.PersonnelNumber)]
		var known *domain.StaffImportRecord
		if ok {
			if known, err = t.importRecord(record); err != nil {
				return staffImportScene{}, err
			}
			scene.matched[record.ID] = record
		}
		checks[i] = domain.CheckStaffImportRow(raw, known, today)
	}
	domain.MarkRepeatedStaffNumbers(checks)
	for i, check := range checks {
		scene.rows[i] = staffImportRow{line: table.read.Lines[i], check: check}
	}
	return scene, nil
}

func staffImportRaw(cells []string, columns map[string]int) domain.StaffImportRaw {
	cell := func(field string) string {
		position, ok := columns[field]
		if !ok || position >= len(cells) {
			return ""
		}
		return cells[position]
	}
	return domain.StaffImportRaw{
		PersonnelNumber: cell(domain.StaffFieldPersonnelNumber), FirstName: cell(domain.StaffFieldFirstName),
		LastName: cell(domain.StaffFieldLastName), Birthday: cell(domain.StaffFieldBirthday), IBAN: cell(domain.StaffFieldIBAN),
		TaxID: cell(domain.StaffFieldTaxID), SocialSecurityNumber: cell(domain.StaffFieldSocialSecurityNumber),
	}
}

func (t *TraegerStaff) importRecord(record domain.TraegerStaffRecord) (*domain.StaffImportRecord, error) {
	financial, err := t.openRecordFinancial(record)
	if err != nil {
		return nil, err
	}
	return &domain.StaffImportRecord{
		ID: record.ID, FirstName: record.FirstName, LastName: record.LastName, Birthday: record.Birthday, Financial: financial,
	}, nil
}

// logStaffImportAccess writes, before the answer leaves, an access entry at
// every school whose employment belongs to a record a row matched. A record
// without Einsatzorte belongs to no school yet.
func (t *TraegerStaff) logStaffImportAccess(ctx context.Context, actor workforce.TraegerStaffActor, scene staffImportScene) error {
	shown := map[int64][]int64{}
	var schools []int64
	for _, row := range scene.rows {
		record, ok := scene.matched[row.check.RecordID]
		if !ok {
			continue
		}
		for _, link := range record.Links {
			if _, seen := shown[link.SchoolID]; !seen {
				schools = append(schools, link.SchoolID)
			}
			if !slices.Contains(shown[link.SchoolID], link.StaffID) {
				shown[link.SchoolID] = append(shown[link.SchoolID], link.StaffID)
			}
		}
	}
	for _, schoolID := range schools {
		err := t.ports.Runtime.WithinSchool(ctx, schoolID, func(ctx context.Context) error {
			return t.ports.Access.RecordTraegerStaffAccess(ctx, workforce.TraegerStaffAccess{
				OrganizationID: actor.OrganizationID, AccountID: actor.AccountID, View: workforce.TraegerStaffViewImport,
				Rows: len(shown[schoolID]), StaffIDs: shown[schoolID],
			})
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// applyStaffImport checks the rows again in the Träger transaction and
// stores them only when they are still what the office confirmed: a record
// another session created or changed since changes the rows.
func (t *TraegerStaff) applyStaffImport(ctx context.Context, actor workforce.TraegerStaffActor, request workforce.StaffImportRequest,
	table staffImportTable, plan staffImportPlan, previewed string,
) (staffImportScene, error) {
	if request.Fingerprint == "" || request.Fingerprint != previewed {
		return staffImportScene{}, workforce.ErrStaffImportChanged
	}
	var scene staffImportScene
	err := t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		if scene, err = t.evaluateStaffImport(ctx, actor, table, plan.columns); err != nil {
			return err
		}
		if staffImportFingerprint(plan.mapping, table.content, scene.rows) != previewed {
			return workforce.ErrStaffImportChanged
		}
		return t.storeStaffImport(ctx, actor, staffImportFileName(request.FileName), scene)
	})
	if errors.Is(err, domain.ErrStaffPersonnelNumberTaken) {
		// Another import created a record with one of the numbers meanwhile.
		return staffImportScene{}, errors.Join(workforce.ErrStaffImportChanged, err)
	}
	return scene, publicTraegerStaffError(err)
}

// storeStaffImport inserts the new records and fills the complete ones,
// each in one statement, and writes the trail of every row.
func (t *TraegerStaff) storeStaffImport(ctx context.Context, actor workforce.TraegerStaffActor, file string, scene staffImportScene) error {
	var fresh, filled []int
	for i, row := range scene.rows {
		switch row.check.Status {
		case domain.StaffImportNew:
			fresh = append(fresh, i)
		case domain.StaffImportComplete:
			filled = append(filled, i)
		}
	}
	ids, err := t.store.ReserveStaffRecordIDs(ctx, actor.OrganizationID, len(fresh))
	if err != nil {
		return err
	}
	if len(ids) != len(fresh) {
		return fmt.Errorf("workforce: reserved %d record ids for %d rows", len(ids), len(fresh))
	}
	records := make([]domain.TraegerStaffRecord, 0, len(fresh))
	changes := make([]domain.TraegerStaffChange, 0, len(fresh)+len(filled))
	for n, i := range fresh {
		row := &scene.rows[i]
		record, err := t.importedRecord(actor.OrganizationID, ids[n], row.check.Values)
		if err != nil {
			return err
		}
		records = append(records, record)
		row.check.RecordID, row.check.Status = record.ID, domain.StaffImportImported
		changes = append(changes, domain.TraegerStaffChange{RecordID: record.ID, Kind: domain.StaffChangeImported,
			Field: domain.StaffChangeFieldRecord, ValueText: new(importTrailText(row.line, file)), AccountID: actor.AccountID})
	}
	completions, completionChanges, err := t.importCompletions(actor, file, scene, filled)
	if err != nil {
		return err
	}
	if err := t.store.InsertStaffRecords(ctx, actor.OrganizationID, records); err != nil {
		return err
	}
	if err := t.store.FillStaffRecordFinancial(ctx, actor.OrganizationID, completions); err != nil {
		return err
	}
	return t.store.AppendStaffChanges(ctx, actor.OrganizationID, append(changes, completionChanges...))
}

// importedRecord builds a new record with its reserved ID and seals its
// bank and tax values to it.
func (t *TraegerStaff) importedRecord(organizationID, id int64, values domain.StaffImportValues) (domain.TraegerStaffRecord, error) {
	record := domain.TraegerStaffRecord{
		ID: id, OrganizationID: organizationID, FirstName: values.FirstName, LastName: values.LastName,
		Birthday: values.Birthday, PersonnelNumber: new(values.PersonnelNumber),
	}
	if err := t.sealRecordFinancial(&record, values.Financial()); err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	return record, nil
}

// importCompletions seals the values each complete row fills in, with a
// trail entry per value that names its line and file.
func (t *TraegerStaff) importCompletions(actor workforce.TraegerStaffActor, file string, scene staffImportScene, filled []int) (
	[]domain.TraegerStaffRecord, []domain.TraegerStaffChange, error,
) {
	records := make([]domain.TraegerStaffRecord, 0, len(filled))
	var changes []domain.TraegerStaffChange
	for _, i := range filled {
		row := &scene.rows[i]
		values := map[string]string{}
		for _, field := range row.check.Completes {
			values[field] = row.check.Values.Financial()[field]
			// The entry names the line and the file, not the value: the record
			// shows its masked value itself.
			changes = append(changes, domain.TraegerStaffChange{RecordID: row.check.RecordID, Kind: domain.StaffChangeImported, Field: field,
				ValueText: new(importTrailText(row.line, file)), AccountID: actor.AccountID})
		}
		record := domain.TraegerStaffRecord{ID: row.check.RecordID, OrganizationID: actor.OrganizationID}
		if err := t.sealRecordFinancial(&record, values); err != nil {
			return nil, nil, err
		}
		records = append(records, record)
		row.check.Status = domain.StaffImportImported
	}
	return records, changes, nil
}

// importTrailText is the text of an import entry in the trail: the line and
// the file, in the shape the import log reads back.
func importTrailText(line int, file string) string {
	return fmt.Sprintf("Zeile %d: %s", line, file)
}

// staffImportFileName is the name the trail keeps: the base name without
// control characters, at most MaxStaffImportFileNameLength characters,
// "import.csv" when nothing remains.
func staffImportFileName(name string) string {
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	name = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, name))
	if runes := []rune(name); len(runes) > workforce.MaxStaffImportFileNameLength {
		name = string(runes[:workforce.MaxStaffImportFileNameLength])
	}
	if name == "" {
		return "import.csv"
	}
	return name
}

// staffImportFingerprint names the file, the mapping and what the import
// does with each row; the import takes over only the preview it was given.
func staffImportFingerprint(mapping workforce.StaffImportMapping, content []byte, rows []staffImportRow) string {
	public := make([]workforce.StaffImportRow, len(rows))
	for i, row := range rows {
		public[i] = publicStaffImportRow(row)
	}
	file := fnv.New128a()
	_, _ = file.Write(content)
	state, err := json.Marshal(struct {
		Mapping workforce.StaffImportMapping `json:"mapping"`
		File    string                       `json:"file"`
		Rows    []workforce.StaffImportRow   `json:"rows"`
	}{mapping, hex.EncodeToString(file.Sum(nil)), public})
	if err != nil {
		// Every value above marshals; a failure leaves no fingerprint an
		// import could match.
		return ""
	}
	hash := fnv.New128a()
	_, _ = hash.Write(state)
	return hex.EncodeToString(hash.Sum(nil))
}

func publicStaffImportRow(row staffImportRow) workforce.StaffImportRow {
	check := row.check
	public := workforce.StaffImportRow{
		Line: row.line, Status: check.Status, PersonnelNumber: check.Values.PersonnelNumber, FirstName: check.Values.FirstName,
		LastName: check.Values.LastName, Birthday: check.Values.Birthday, RecordID: check.RecordID,
		IBANMasked:                 domain.MaskStaffValue(domain.StaffFieldIBAN, check.Values.IBAN),
		TaxIDMasked:                domain.MaskStaffValue(domain.StaffFieldTaxID, check.Values.TaxID),
		SocialSecurityNumberMasked: domain.MaskStaffValue(domain.StaffFieldSocialSecurityNumber, check.Values.SocialSecurityNumber),
		Completes:                  append([]string{}, check.Completes...),
		Problems:                   make([]workforce.StaffImportProblem, 0, len(check.Problems)),
	}
	for _, problem := range check.Problems {
		public.Problems = append(public.Problems, workforce.StaffImportProblem{Field: problem.Field, Code: problem.Code})
	}
	return public
}

func countStaffImportRow(counts *workforce.StaffImportCounts, status string) {
	switch status {
	case workforce.StaffImportRowNew:
		counts.New++
	case workforce.StaffImportRowComplete:
		counts.Complete++
	case workforce.StaffImportRowDuplicate:
		counts.Duplicate++
	case workforce.StaffImportRowConflict:
		counts.Conflict++
	case workforce.StaffImportRowInvalid:
		counts.Invalid++
	case workforce.StaffImportRowImported:
		counts.Imported++
	}
}

// StaffImportLog lists the imports of the Träger, newest first.
func (t *TraegerStaff) StaffImportLog(ctx context.Context, actor workforce.TraegerStaffActor) ([]workforce.StaffImportEntry, error) {
	var events []domain.StaffImportEvent
	err := t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		events, err = t.store.StaffImportEvents(ctx, actor.OrganizationID, staffImportLogLimit)
		return err
	})
	if err != nil {
		return nil, publicTraegerStaffError(err)
	}
	entries := make([]workforce.StaffImportEntry, len(events))
	for i, event := range events {
		entries[i] = workforce.StaffImportEntry{File: event.File, AccountID: event.AccountID, ImportedAt: event.ImportedAt,
			Created: event.Created, Completed: event.Completed}
	}
	return entries, nil
}
