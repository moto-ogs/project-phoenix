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
	result.Mapping = settleFamilyImportMapping(result.Mapping, schools)
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
	recipients, err := c.contracts.Recipients(ctx, organizationID, ids)
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the contract parties: %w", err)
	}
	counts, err := c.FamilyNumbers.store.FamilyChildCounts(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	check := familyImportCheck{index: index, schools: schools, contracts: contracts, recipients: recipients}
	candidates := make([]familyImportCandidate, len(table.rows))
	for i, cells := range table.rows {
		candidates[i] = check.candidate(cells, table.lines[i])
	}
	refuseDisagreeingRepeats(candidates)
	numbers, _ := numbersByFamily(counts, recipients)
	shown := decideFamilyImport(candidates, numbers, today)
	event := parentbilling.FamilyChildEvent{Action: parentbilling.FamilyChildEventRead, Actor: parentbilling.FamilyChildActorOffice,
		AccountID: reviewer.AccountID}
	if err := c.FamilyNumbers.store.InsertFamilyChildEvents(ctx, organizationID, event, shown); err != nil {
		return nil, fmt.Errorf("parent billing: record family child count read: %w", err)
	}
	return candidates, nil
}

// refuseDisagreeingRepeats takes the first row of a child back when a later
// row names the same child with another number: different numbers take
// over none.
func refuseDisagreeingRepeats(candidates []familyImportCandidate) {
	at := map[int]int{}
	for i, candidate := range candidates {
		at[candidate.row.Line] = i
	}
	for _, candidate := range candidates {
		first, ok := at[candidate.row.RepeatsLine]
		if !ok || candidate.row.RepeatsLine == 0 || candidates[first].row.Status != "" {
			continue
		}
		if a, b := candidates[first].row.Children, candidate.row.Children; a != nil && b != nil && *a != *b {
			problemOf(&candidates[first].row, parentbilling.FamilyImportFieldChildren, parentbilling.FamilyImportProblemRowsDiffer)
			candidates[first].row.Status = parentbilling.FamilyImportConflict
		}
	}
}

// decideFamilyImport gives every row without a problem its status from the
// numbers of its families and answers the numbers the answer tells.
func decideFamilyImport(candidates []familyImportCandidate, numbers map[string]*familyNumbers, today calendar.Date) []parentbilling.FamilyChildTarget {
	var rows []importedChildren
	var owner []int
	for i, candidate := range candidates {
		if candidate.row.Status != "" {
			continue
		}
		for _, target := range candidate.targets {
			rows = append(rows, importedChildren{family: target.family, number: parentbilling.ImportedFamilyChildren{
				Line: candidate.row.Line, ContractID: target.contractID, Children: *candidate.row.Children, ValidFrom: target.firstDay}})
			owner = append(owner, i)
		}
	}
	current := func(family string) *parentbilling.FamilyChildCount {
		if found, ok := numbers[family]; ok {
			return found.confirmed()
		}
		return nil
	}
	decideImportedChildren(rows, current, func(importedChildren) calendar.Date { return today })
	var shown []parentbilling.FamilyChildTarget
	seen := map[int64]bool{}
	for i, row := range rows {
		candidates[owner[i]].decided = append(candidates[owner[i]].decided, row)
		if count := current(row.family); count != nil && row.confirmed != nil && !seen[count.ID] {
			seen[count.ID] = true
			shown = append(shown, parentbilling.FamilyChildTarget{ContractID: count.ContractID, CountID: &count.ID})
		}
	}
	for i := range candidates {
		candidates[i].settle()
	}
	return shown
}

// settle gives a row the status of its families; the most urgent one wins:
// rows that disagree, then a confirmed number that differs, then a number
// to take over, then one the family already has.
func (c *familyImportCandidate) settle() {
	if c.row.Status != "" {
		return
	}
	// The day the number counts from, as decided: a renewed number starts
	// after the confirmation that ran out.
	if len(c.decided) > 0 {
		from := c.decided[0].number.ValidFrom
		c.row.ValidFrom = &from
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
		Children: found[parentbilling.FamilyImportFieldChildren],
	}}
}

// settleFamilyImportMapping completes a mapping with the one school of a
// Träger that has one. A column always goes before the choice.
func settleFamilyImportMapping(mapping parentbilling.FamilyChildrenImportMapping, schools []parentbilling.CareSchool) parentbilling.FamilyChildrenImportMapping {
	if mapping.Columns.School != "" {
		mapping.SchoolID = 0
	} else if mapping.SchoolID == 0 && len(schools) == 1 {
		mapping.SchoolID = schools[0].ID
	}
	return mapping
}
