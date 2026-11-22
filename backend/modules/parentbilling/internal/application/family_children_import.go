package application

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"slices"

	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// The numbers of the families from a file (#7356): a look at a file reads
// it, maps its columns, finds the contract of every row's child among the
// contracts of the Träger and answers what the import would do; with Apply
// it stores the ready rows as confirmed. Everything runs in the caller's
// Träger transaction. The file is never stored.

var _ parentbilling.FamilyChildrenImports = (*CareReductions)(nil)

// ImportFamilyChildren reads the file, answers every row and, with Apply,
// stores the ready rows.
func (c *CareReductions) ImportFamilyChildren(ctx context.Context, reviewer parentbilling.HolidayReviewer,
	request parentbilling.FamilyChildrenImportRequest,
) (parentbilling.FamilyChildrenImport, error) {
	if err := validReviewer(reviewer); err != nil {
		return parentbilling.FamilyChildrenImport{}, err
	}
	table, err := readImportTable(request.Content, request.Delimiter)
	if err != nil {
		return parentbilling.FamilyChildrenImport{}, err
	}
	schools, err := c.schools.TraegerSchools(ctx, reviewer.OrganizationID)
	if err != nil {
		return parentbilling.FamilyChildrenImport{}, fmt.Errorf("parent billing: read the schools: %w", err)
	}
	result := parentbilling.FamilyChildrenImport{Encoding: table.encoding, Delimiter: table.delimiter, Headers: table.headers,
		Schools: schools, Unmapped: []string{}, Rows: []parentbilling.FamilyChildrenImportRow{}}
	result.Mapping = suggestFamilyImportMapping(table.headers)
	if request.Mapping != nil {
		result.Mapping = *request.Mapping
	}
	result.Mapping = settleFamilyImportMapping(result.Mapping, schools, c.today())
	index, err := resolveFamilyImportMapping(table.headers, result.Mapping, schools)
	if err != nil {
		return parentbilling.FamilyChildrenImport{}, err
	}
	if result.Unmapped = index.unmapped(); len(result.Unmapped) > 0 {
		if request.Apply {
			return parentbilling.FamilyChildrenImport{}, validation.Errors{"mapping": errors.New("misses a required column")}
		}
		return result, nil
	}
	candidates, err := c.decideFamilyImportFile(ctx, reviewer, request, table, index, schools, &result)
	if err != nil {
		return parentbilling.FamilyChildrenImport{}, err
	}
	for _, candidate := range candidates {
		result.Rows = append(result.Rows, candidate.row)
		countFamilyImportRow(&result.Counts, candidate.row.Status)
	}
	return result, nil
}

// decideFamilyImportFile reads and decides the rows, names them by their
// fingerprint and, with Apply, stores the ready rows of the confirmed
// preview. With Apply it holds the monthly billing before it reads.
func (c *CareReductions) decideFamilyImportFile(ctx context.Context, reviewer parentbilling.HolidayReviewer,
	request parentbilling.FamilyChildrenImportRequest, table importTable, index familyImportIndex, schools []parentbilling.CareSchool,
	result *parentbilling.FamilyChildrenImport,
) ([]familyImportCandidate, error) {
	if request.Apply {
		if err := c.holdForImport(ctx, reviewer.OrganizationID); err != nil {
			return nil, err
		}
	}
	candidates, err := c.familyImportCandidates(ctx, reviewer, table, index, schools)
	if err != nil {
		return nil, err
	}
	result.Fingerprint = familyImportFingerprint(result.Mapping, candidates)
	if !request.Apply {
		return candidates, nil
	}
	if request.Fingerprint != result.Fingerprint {
		return nil, parentbilling.ErrImportChanged
	}
	if err := c.applyFamilyImport(ctx, reviewer, candidates); err != nil {
		return nil, err
	}
	result.Applied = true
	return candidates, nil
}

// familyImportCandidates reads the rows against the contracts and the
// numbers of the Träger and records the read of every number the answer
// tells.
func (c *CareReductions) familyImportCandidates(ctx context.Context, reviewer parentbilling.HolidayReviewer, table importTable,
	index familyImportIndex, schools []parentbilling.CareSchool,
) ([]familyImportCandidate, error) {
	organizationID, today := reviewer.OrganizationID, c.today()
	// The contracts of the page of the numbers: in force from three months
	// back to nine ahead. A contract that began before counts from the
	// first day of that window.
	versions, err := c.contracts.VersionsInForce(ctx, organizationID, today.AddDays(-evidenceLookBack), today.AddDays(evidenceLookAhead))
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the contract versions: %w", err)
	}
	contracts := familyImportContracts(versions)
	ids := make([]int64, len(contracts))
	for i, contract := range contracts {
		ids[i] = contract.id
	}
	counts, err := c.FamilyNumbers.store.FamilyChildCounts(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	recipients, err := c.contracts.Recipients(ctx, organizationID, familyRecipientContracts(ids, counts))
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the contract parties: %w", err)
	}
	check := familyImportCheck{index: index, schools: schools, contracts: contracts, recipients: recipients}
	candidates := make([]familyImportCandidate, len(table.rows))
	for i, cells := range table.rows {
		candidates[i] = check.candidate(cells, table.lines[i])
	}
	numbers, _ := numbersByFamily(counts, recipients)
	shown := decideFamilyImport(candidates, numbers, today)
	event := parentbilling.FamilyChildEvent{Action: parentbilling.FamilyChildEventRead, Actor: parentbilling.FamilyChildActorOffice,
		AccountID: reviewer.AccountID}
	if err := c.FamilyNumbers.store.InsertFamilyChildEvents(ctx, organizationID, event, shown); err != nil {
		return nil, fmt.Errorf("parent billing: record family child count read: %w", err)
	}
	return candidates, nil
}

// decideFamilyImport gives every row without a problem its status from the
// numbers of its families and answers the numbers the answer tells.
func decideFamilyImport(candidates []familyImportCandidate, numbers map[string]*familyNumbers, today calendar.Date) []parentbilling.FamilyChildTarget {
	rows, owner := familyImportRows(candidates)
	current := func(family string) *parentbilling.FamilyChildCount {
		if found, ok := numbers[family]; ok {
			return found.confirmed()
		}
		return nil
	}
	// Conflicting carried confirmations still protect their earlier months.
	// Only an explicit office confirmation may settle them for the family.
	for i := range rows {
		if found := numbers[rows[i].family]; found != nil {
			if _, differing := found.count(); differing {
				rows[i].status = parentbilling.ImportedChildrenConfirmationsDiffer
			}
		}
	}
	decideImportedChildren(rows, current, func(importedChildren) calendar.Date { return today })
	var shown []parentbilling.FamilyChildTarget
	seen := map[int64]bool{}
	for i, row := range rows {
		if row.witness {
			continue
		}
		candidates[owner[i]].decided = append(candidates[owner[i]].decided, row)
		if count := current(row.family); count != nil && row.confirmed != nil && !seen[count.ID.Int64()] {
			seen[count.ID.Int64()] = true
			shown = append(shown, parentbilling.FamilyChildTarget{ContractID: count.ContractID.Int64(), CountID: (*int64)(&count.ID)})
		}
	}
	for i := range candidates {
		candidates[i].settle()
	}
	alignFamilyImportDays(candidates)
	return shown
}

// alignFamilyImportDays gives the ready rows of one family the day the
// family's number is stored from: the earliest its ready rows name
// (newImportedChildren). The preview then shows every row the day that
// counts, also when siblings name different days. A row the import leaves
// out lends no day.
func alignFamilyImportDays(candidates []familyImportCandidate) {
	earliest := map[string]calendar.Date{}
	each := func(visit func(candidate *familyImportCandidate, row *importedChildren)) {
		for i := range candidates {
			if candidates[i].row.Status != parentbilling.FamilyImportReady {
				continue
			}
			for k := range candidates[i].decided {
				if row := &candidates[i].decided[k]; row.status == parentbilling.ImportedChildrenNew {
					visit(&candidates[i], row)
				}
			}
		}
	}
	each(func(_ *familyImportCandidate, row *importedChildren) {
		if day, seen := earliest[row.family]; !seen || row.number.ValidFrom.Before(day) {
			earliest[row.family] = row.number.ValidFrom
		}
	})
	shown := map[*familyImportCandidate]bool{}
	each(func(candidate *familyImportCandidate, row *importedChildren) {
		row.number.ValidFrom = earliest[row.family]
		if !shown[candidate] {
			from := row.number.ValidFrom
			candidate.row.ValidFrom, shown[candidate] = &from, true
		}
	})
}

// familyImportRows are the numbers of the candidates per family, with the
// candidate each belongs to. A row that names a child a second time takes
// over nothing, but its number speaks against the rows of its families.
func familyImportRows(candidates []familyImportCandidate) (rows []importedChildren, owner []int) {
	for i, candidate := range candidates {
		witness := candidate.row.RepeatsLine > 0
		if (candidate.row.Status != "" && !witness) || candidate.row.Children == nil {
			continue
		}
		for _, target := range candidate.targets {
			rows = append(rows, importedChildren{family: target.family, witness: witness, number: parentbilling.ImportedFamilyChildren{
				Line: candidate.row.Line, ContractID: target.contractID, Children: *candidate.row.Children, ValidFrom: candidate.validFrom}})
			owner = append(owner, i)
		}
	}
	return rows, owner
}

// settle gives a row the status of its families; the most urgent one wins:
// rows that disagree, then a confirmed number that differs, then a number
// to take over, then one the family already has.
func (c *familyImportCandidate) settle() {
	if c.row.Status != "" {
		return
	}
	// The day the number counts from, as decided for a family that takes
	// it over: a renewed number starts after the confirmation that ran out,
	// siblings share the earliest day their rows name.
	for _, row := range c.decided {
		if row.status == parentbilling.ImportedChildrenNew {
			from := row.number.ValidFrom
			c.row.ValidFrom = &from
			break
		}
	}
	has := func(status string) bool {
		return slices.ContainsFunc(c.decided, func(row importedChildren) bool { return row.status == status })
	}
	confirmed := func(status string) *int {
		for _, row := range c.decided {
			if row.status == status {
				return row.confirmed
			}
		}
		return nil
	}
	switch {
	case has(parentbilling.ImportedChildrenConfirmationsDiffer):
		c.row.Status = parentbilling.FamilyImportConflict
		c.row.Problems = append(c.row.Problems, parentbilling.FamilyChildrenImportProblem{
			Field: parentbilling.FamilyImportFieldChildren, Code: parentbilling.FamilyImportProblemConfirmationsDiffer})
	case has(parentbilling.ImportedChildrenRowsDiffer):
		c.row.Status = parentbilling.FamilyImportConflict
		c.row.Problems = append(c.row.Problems, parentbilling.FamilyChildrenImportProblem{
			Field: parentbilling.FamilyImportFieldChildren, Code: parentbilling.FamilyImportProblemRowsDiffer})
	case has(parentbilling.ImportedChildrenDiffers):
		c.row.Status, c.row.ConfirmedChildren = parentbilling.FamilyImportDiffers, confirmed(parentbilling.ImportedChildrenDiffers)
	case has(parentbilling.ImportedChildrenNew):
		c.row.Status = parentbilling.FamilyImportReady
	default:
		c.row.Status, c.row.ConfirmedChildren = parentbilling.FamilyImportSame, confirmed(parentbilling.ImportedChildrenSame)
	}
	// Only a number the import takes over counts from the row's day: a
	// confirmed one keeps its own validity, which the row does not name.
	if c.row.Status != parentbilling.FamilyImportReady {
		c.row.ValidFrom = nil
	}
}

// applyFamilyImport stores the numbers of the ready rows and marks them.
func (c *CareReductions) applyFamilyImport(ctx context.Context, reviewer parentbilling.HolidayReviewer, candidates []familyImportCandidate) error {
	var rows []importedChildren
	for _, candidate := range candidates {
		if candidate.row.Status == parentbilling.FamilyImportReady {
			rows = append(rows, candidate.decided...)
		}
	}
	if err := c.saveImportedChildren(ctx, reviewer, rows); err != nil {
		return err
	}
	for i := range candidates {
		if candidates[i].row.Status == parentbilling.FamilyImportReady {
			candidates[i].row.Status = parentbilling.FamilyImportImported
		}
	}
	return nil
}

func countFamilyImportRow(counts *parentbilling.FamilyChildrenImportCounts, status string) {
	switch status {
	case parentbilling.FamilyImportReady:
		counts.Ready++
	case parentbilling.FamilyImportSame:
		counts.Same++
	case parentbilling.FamilyImportDiffers:
		counts.Differs++
	case parentbilling.FamilyImportConflict:
		counts.Conflict++
	case parentbilling.FamilyImportInvalid:
		counts.Invalid++
	case parentbilling.FamilyImportImported:
		counts.Imported++
	}
}

// familyImportFingerprint names the mapping and every row with what the
// import does with it and for which families. A change detector, not a
// secret, like the fingerprint of a mandate import.
func familyImportFingerprint(mapping parentbilling.FamilyChildrenImportMapping, candidates []familyImportCandidate) string {
	type target struct {
		Family string        `json:"family"`
		From   calendar.Date `json:"from"`
		Status string        `json:"status"`
	}
	type stateRow struct {
		Row     parentbilling.FamilyChildrenImportRow `json:"row"`
		Targets []target                              `json:"targets"`
	}
	rows := make([]stateRow, len(candidates))
	for i, candidate := range candidates {
		rows[i].Row = candidate.row
		for _, decided := range candidate.decided {
			rows[i].Targets = append(rows[i].Targets, target{decided.family, decided.number.ValidFrom, decided.status})
		}
	}
	// The values are plain data: encoding them cannot fail.
	state, _ := json.Marshal(struct {
		Mapping parentbilling.FamilyChildrenImportMapping `json:"mapping"`
		Rows    []stateRow                                `json:"rows"`
	}{mapping, rows})
	hash := fnv.New128a()
	_, _ = hash.Write(state)
	return hex.EncodeToString(hash.Sum(nil))
}

// suggestFamilyImportMapping maps each field to the first header with one
// of its names. A header names one field only.
func suggestFamilyImportMapping(headers []string) parentbilling.FamilyChildrenImportMapping {
	found := map[string]string{}
	for _, header := range headers {
		key := textnorm.HeaderKey(header)
		for _, field := range familyImportFields {
			if _, done := found[field]; !done && key != "" && slices.Contains(familyImportHeaderNames[field], key) {
				found[field] = header
				break
			}
		}
	}
	return parentbilling.FamilyChildrenImportMapping{Columns: parentbilling.FamilyChildrenImportColumns{
		ChildFirstName: found[parentbilling.FamilyImportFieldChildFirstName], ChildLastName: found[parentbilling.FamilyImportFieldChildLastName],
		ChildBirthDate: found[parentbilling.FamilyImportFieldChildBirthDate], School: found[parentbilling.FamilyImportFieldSchool],
		Children: found[parentbilling.FamilyImportFieldChildren], ValidFrom: found[parentbilling.FamilyImportFieldValidFrom],
	}}
}

// settleFamilyImportMapping completes a mapping with the one school of a
// Träger that has one, and with today as the day the numbers count from
// when the office named none: the day of the import is the one day the
// import itself proves (#7765). A column always goes before the choice.
func settleFamilyImportMapping(mapping parentbilling.FamilyChildrenImportMapping, schools []parentbilling.CareSchool, today calendar.Date) parentbilling.FamilyChildrenImportMapping {
	if mapping.ValidFrom == nil {
		mapping.ValidFrom = &today
	}
	if mapping.Columns.School != "" {
		mapping.SchoolID = 0
	} else if mapping.SchoolID == 0 && len(schools) == 1 {
		mapping.SchoolID = schools[0].ID
	}
	return mapping
}
