package application

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// The link of imported contracts to child records (#7760, ADR 0232 point 6
// and its addendum). A run first reads, in each school's tenant transaction,
// the child records the file names; then it reads the contracts, decides
// every row and, with Apply, links the ready rows in one Träger transaction;
// then it records in the access log of every school whose children it
// showed. The identifiers decide: names and dates of birth are compared, a
// difference holds a row back.

const accessViewChildLink = "care_contract_child_link"

// ChildLinkStore persists what the link reads and writes, in the Träger
// transaction of organizationID.
type ChildLinkStore interface {
	ContractChildren(ctx context.Context, organizationID int64, schoolIDs []int64) ([]ports.ContractChild, error)
	// LockChildLinks makes the caller the only run of the Träger that
	// links until its transaction ends.
	LockChildLinks(ctx context.Context, organizationID int64) error
	// LinkContractChildren links each imported contract without a child
	// record to the one named and answers the contracts it linked.
	LinkContractChildren(ctx context.Context, organizationID int64, links []ports.ChildLink) ([]int64, error)
	// UnlinkContractChild takes the child record studentID off an imported
	// contract and answers the school and whether it had one; a contract
	// without one stays as it is. ErrContractNotFound, ErrChildLinkNotImported
	// for a contract from an application, ErrChildLinkBound for an imported
	// one bound to an application, or ErrChildLinkChanged for one linked to
	// another child record.
	UnlinkContractChild(ctx context.Context, organizationID, contractID, studentID int64) (int64, bool, error)
	InsertEvents(ctx context.Context, organizationID int64, events []Event) error
}

// ChildLinkPorts are the root-bound ports of the link.
type ChildLinkPorts struct {
	Schools  carecontract.TraegerSchools
	Children carecontract.SchoolChildren
	Access   carecontract.SchoolAccessLog
	Runtime  carecontract.Runtime
	// Fingerprint names content by its checksum, for the confirmation of a
	// preview.
	Fingerprint func([]byte) string
}

// ContractChildLinks serves carecontract.ContractChildLinks.
type ContractChildLinks struct {
	store ChildLinkStore
	ports ChildLinkPorts
	today func() calendar.Date
}

var _ carecontract.ContractChildLinks = (*ContractChildLinks)(nil)

func NewContractChildLinks(store ChildLinkStore, ports ChildLinkPorts, today func() calendar.Date) *ContractChildLinks {
	if store == nil || ports.Schools == nil || ports.Children == nil || ports.Access == nil || ports.Runtime == nil ||
		ports.Fingerprint == nil || today == nil {
		panic("care contract: the store, the schools, the child records, the access log, the runtime, the fingerprint and the clock are required")
	}
	return &ContractChildLinks{store: store, ports: ports, today: today}
}

// childLinkHeaderNames are the headers moto takes for a field without being
// told, folded by textnorm.HeaderKey.
var childLinkHeaderNames = map[string][]string{
	carecontract.ChildLinkFieldContract: {"vertrag", "vertragnr", "vertragsnr", "vertragsnummer", "vertragid", "vertragsid",
		"contractid", "targetcontractid", "motovertrag", "motovertragid"},
	carecontract.ChildLinkFieldChild: {"kind", "kindid", "kindnr", "kindnummer", "kinderakte", "kinderakteid", "schuelerid",
		"studentid", "childid", "targetchildid", "motokind", "motokindid"},
}

// suggestChildLinkColumns takes for each field the first header that names
// it.
func suggestChildLinkColumns(headers []string) carecontract.ChildLinkColumns {
	found := map[string]string{}
	for _, header := range headers {
		key := textnorm.HeaderKey(header)
		for field, names := range childLinkHeaderNames {
			if _, done := found[field]; !done && key != "" && slices.Contains(names, key) {
				found[field] = header
			}
		}
	}
	return carecontract.ChildLinkColumns{Contract: found[carecontract.ChildLinkFieldContract], Child: found[carecontract.ChildLinkFieldChild]}
}

// childLinkIndex resolves the columns to their positions and names the
// fields without one. Two fields from one column leave the second unmapped.
func childLinkIndex(headers []string, columns carecontract.ChildLinkColumns) (contract, child int, unmapped []string) {
	contract, child = slices.Index(headers, columns.Contract), slices.Index(headers, columns.Child)
	unmapped = []string{}
	if columns.Contract == "" || contract < 0 {
		unmapped = append(unmapped, carecontract.ChildLinkFieldContract)
	}
	if columns.Child == "" || child < 0 || child == contract {
		unmapped = append(unmapped, carecontract.ChildLinkFieldChild)
	}
	return contract, child, unmapped
}

// linkPair is one row as read: the identifiers, 0 for a missing or invalid
// one, and the problems of reading them.
type linkPair struct {
	line       int
	contractID int64
	studentID  int64
	problems   []carecontract.ChildLinkProblem
}

func readChildLinkID(cells []string, position int, field string, pair *linkPair) int64 {
	text := ""
	if position < len(cells) {
		text = strings.TrimSpace(cells[position])
	}
	if text == "" {
		pair.problems = append(pair.problems, carecontract.ChildLinkProblem{Field: field, Code: carecontract.ChildLinkProblemMissing})
		return 0
	}
	id, err := strconv.ParseInt(text, 10, 64)
	if err != nil || id <= 0 {
		pair.problems = append(pair.problems, carecontract.ChildLinkProblem{Field: field, Code: carecontract.ChildLinkProblemInvalid})
		return 0
	}
	return id
}

// LinkChildren reads the file, answers every row and, with Apply, links the
// ready rows.
func (l *ContractChildLinks) LinkChildren(ctx context.Context, reviewer carecontract.Reviewer, request carecontract.ChildLinkRequest) (carecontract.ChildLinking, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.ChildLinking{}, err
	}
	table, err := readContractImportTable(request.Content, request.Delimiter)
	if err != nil {
		return carecontract.ChildLinking{}, err
	}
	result := carecontract.ChildLinking{Encoding: table.Encoding, Delimiter: table.Delimiter, Headers: table.Headers,
		Columns: suggestChildLinkColumns(table.Headers), Rows: []carecontract.ChildLinkRow{}}
	if request.Columns != nil {
		result.Columns = *request.Columns
	}
	contractAt, childAt, unmapped := childLinkIndex(table.Headers, result.Columns)
	result.Unmapped = unmapped
	if len(unmapped) > 0 {
		if request.Apply {
			fields := map[string]string{}
			for _, field := range unmapped {
				fields[field] = "required"
			}
			return carecontract.ChildLinking{}, &carecontract.ValidationError{Fields: fields}
		}
		return result, nil
	}
	pairs := make([]linkPair, len(table.Rows))
	for n, cells := range table.Rows {
		pairs[n].line = table.Lines[n]
		pairs[n].contractID = readChildLinkID(cells, contractAt, carecontract.ChildLinkFieldContract, &pairs[n])
		pairs[n].studentID = readChildLinkID(cells, childAt, carecontract.ChildLinkFieldChild, &pairs[n])
	}
	run := linkRun{pairs: pairs, apply: request.Apply, fingerprint: &request.Fingerprint,
		details: func(pair linkPair) map[string]any {
			return map[string]any{ports.LinkFileDetail: importFileName(request.FileName), ports.LinkLineDetail: pair.line}
		}}
	rows, err := l.run(ctx, reviewer, &run)
	if err != nil {
		return carecontract.ChildLinking{}, err
	}
	result.Rows, result.Fingerprint, result.Applied = rows, run.state, request.Apply
	for _, row := range rows {
		countChildLinkRow(&result.Counts, row)
	}
	return result, nil
}

// LinkChild answers one link by hand and, with Apply, stores it.
func (l *ContractChildLinks) LinkChild(ctx context.Context, reviewer carecontract.Reviewer, contractID int64, input carecontract.ChildLinkInput) (carecontract.ChildLinkRow, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.ChildLinkRow{}, err
	}
	if contractID <= 0 {
		return carecontract.ChildLinkRow{}, carecontract.ErrContractNotFound
	}
	if input.StudentID <= 0 {
		return carecontract.ChildLinkRow{}, carecontract.InvalidSelection("student_id", "required")
	}
	if input.Apply && input.Fingerprint == "" {
		return carecontract.ChildLinkRow{}, carecontract.InvalidSelection("fingerprint", "required")
	}
	run := linkRun{pairs: []linkPair{{line: 1, contractID: contractID, studentID: input.StudentID.Int64()}}, apply: input.Apply,
		acceptDifference: input.AcceptDifference, single: true,
		details: func(linkPair) map[string]any { return map[string]any{"accepted_difference": input.AcceptDifference} }}
	if input.Apply {
		run.fingerprint = &input.Fingerprint
	}
	rows, err := l.run(ctx, reviewer, &run)
	if err != nil {
		return carecontract.ChildLinkRow{}, err
	}
	row := rows[0]
	row.Fingerprint = run.state
	switch {
	case childLinkRowHas(row, carecontract.ChildLinkProblemUnknown):
		return carecontract.ChildLinkRow{}, carecontract.ErrContractNotFound
	case input.Apply && childLinkRowHas(row, carecontract.ChildLinkProblemNotImported):
		return row, carecontract.ErrChildLinkNotImported
	case input.Apply && row.Status != carecontract.ChildLinkStored && row.Status != carecontract.ChildLinkLinked:
		return row, carecontract.ErrChildLinkRefused
	}
	return row, nil
}

// childLinkRowHas tells whether the contract of a row has the problem.
func childLinkRowHas(row carecontract.ChildLinkRow, problem string) bool {
	return slices.ContainsFunc(row.Problems, func(p carecontract.ChildLinkProblem) bool {
		return p.Field == carecontract.ChildLinkFieldContract && p.Code == problem
	})
}

// UnlinkChild takes the child record the office saw off an imported
// contract.
func (l *ContractChildLinks) UnlinkChild(ctx context.Context, reviewer carecontract.Reviewer, contractID, studentID int64) error {
	if err := checkReviewer(reviewer); err != nil {
		return err
	}
	if contractID <= 0 {
		return carecontract.ErrContractNotFound
	}
	if studentID <= 0 {
		return carecontract.InvalidSelection("student_id", "required")
	}
	return l.ports.Runtime.WithinTraeger(ctx, reviewer.OrganizationID, func(txCtx context.Context) error {
		schoolID, unlinked, err := l.store.UnlinkContractChild(txCtx, reviewer.OrganizationID, contractID, studentID)
		if err != nil || !unlinked {
			return err
		}
		return trail(txCtx, l.store, reviewer.OrganizationID, reviewer.AccountID, contractID, schoolID, ports.ActionUnlinkChild,
			map[string]any{"student_id": studentID})
	})
}

// linkRun is one run over pairs: a file or a single link by hand.
type linkRun struct {
	pairs []linkPair
	apply bool
	// fingerprint is the confirmed preview of a file or the row of a single
	// link the office saw; nil for a preview.
	fingerprint      *string
	acceptDifference bool
	single           bool
	details          func(linkPair) map[string]any
	// state is the fingerprint of the rows as decided, before an accepted
	// difference: the preview and the confirming link answer the same.
	state string
}

// run reads the schools, decides the pairs and, with apply, links the ready
// ones.
func (l *ContractChildLinks) run(ctx context.Context, reviewer carecontract.Reviewer, run *linkRun) ([]carecontract.ChildLinkRow, error) {
	schools, err := l.ports.Schools.TraegerSchools(ctx, reviewer.OrganizationID)
	if err != nil {
		return nil, fmt.Errorf("care contract: schools: %w", err)
	}
	students, err := l.readChildren(ctx, schools, run.pairs)
	if err != nil {
		return nil, err
	}
	var rows []carecontract.ChildLinkRow
	var shownAt []int64
	err = l.ports.Runtime.WithinTraeger(ctx, reviewer.OrganizationID, func(txCtx context.Context) error {
		rows, shownAt, err = l.decideInTraeger(txCtx, reviewer, schools, students, run)
		return err
	})
	if err != nil {
		return nil, err
	}
	return rows, l.logSchools(ctx, reviewer, schools, rows, shownAt)
}

// decideInTraeger reads the contracts in the Träger transaction, decides the
// pairs, with apply links the ready ones, and records the read.
func (l *ContractChildLinks) decideInTraeger(ctx context.Context, reviewer carecontract.Reviewer, schools []carecontract.School,
	students map[int64]map[int64]carecontract.SchoolChild, run *linkRun) ([]carecontract.ChildLinkRow, []int64, error) {
	if run.apply {
		// One run links at a time per Träger: two runs that read before
		// either wrote could else link one child to two contracts.
		if err := l.store.LockChildLinks(ctx, reviewer.OrganizationID); err != nil {
			return nil, nil, err
		}
	}
	contracts, err := l.store.ContractChildren(ctx, reviewer.OrganizationID, schoolIDs(schools))
	if err != nil {
		return nil, nil, err
	}
	rows, shownAt := decideChildLinks(run.pairs, schools, contracts, students, l.today())
	run.state = l.ports.Fingerprint(childLinkState(rows))
	if run.acceptDifference {
		acceptChildLinkDifference(rows)
	}
	if run.apply {
		if run.fingerprint != nil && *run.fingerprint != run.state {
			return nil, nil, carecontract.ErrChildLinkChanged
		}
		if err := l.apply(ctx, reviewer, run, contracts, rows); err != nil {
			return nil, nil, err
		}
	}
	view := "child_links"
	if run.single {
		view = "child_link"
	}
	err = trail(ctx, l.store, reviewer.OrganizationID, reviewer.AccountID, 0, 0, ActionRead,
		map[string]any{"view": view, "rows": len(rows), "applied": run.apply})
	return rows, shownAt, err
}

// readChildren reads, per school of the Träger, the child records with the
// identifiers the pairs name, in that school's tenant transaction: one read
// per school, however many rows. A school answers only its own children.
func (l *ContractChildLinks) readChildren(ctx context.Context, schools []carecontract.School, pairs []linkPair) (map[int64]map[int64]carecontract.SchoolChild, error) {
	ids := []int64{}
	for _, pair := range pairs {
		if pair.studentID > 0 && !slices.Contains(ids, pair.studentID) {
			ids = append(ids, pair.studentID)
		}
	}
	students := map[int64]map[int64]carecontract.SchoolChild{}
	if len(ids) == 0 {
		return students, nil
	}
	for _, school := range schools {
		err := l.ports.Runtime.WithinSchool(ctx, school.ID, func(txCtx context.Context) error {
			children, err := l.ports.Children.SchoolChildren(txCtx, ids)
			if err != nil {
				return err
			}
			students[school.ID] = make(map[int64]carecontract.SchoolChild, len(children))
			for _, child := range children {
				students[school.ID][child.StudentID] = child
			}
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("care contract: read child records of school %d: %w", school.ID, err)
		}
	}
	return students, nil
}

// apply links the ready rows and records each. A contract that got a child
// record since the read makes the whole run ErrChildLinkChanged.
func (l *ContractChildLinks) apply(ctx context.Context, reviewer carecontract.Reviewer, run *linkRun,
	contracts []ports.ContractChild, rows []carecontract.ChildLinkRow) error {
	schoolOf := make(map[int64]int64, len(contracts))
	for _, contract := range contracts {
		schoolOf[contract.ContractID] = contract.SchoolID
	}
	links := []ports.ChildLink{}
	events := []Event{}
	for n := range rows {
		row := &rows[n]
		if row.Status != carecontract.ChildLinkReady {
			continue
		}
		contractID, schoolID := row.ContractID.Int64(), schoolOf[row.ContractID.Int64()]
		links = append(links, ports.ChildLink{ContractID: contractID, StudentID: row.StudentID.Int64()})
		details := run.details(run.pairs[n])
		details["student_id"] = row.StudentID.Int64()
		events = append(events, Event{ContractID: &contractID, SchoolID: &schoolID, AccountID: reviewer.AccountID,
			Action: ports.ActionLinkChild, Details: details})
		row.Status = carecontract.ChildLinkStored
	}
	if len(links) == 0 {
		return nil
	}
	stored, err := l.store.LinkContractChildren(ctx, reviewer.OrganizationID, links)
	if err != nil {
		return err
	}
	if len(stored) != len(links) {
		return carecontract.ErrChildLinkChanged
	}
	if err := l.store.InsertEvents(ctx, reviewer.OrganizationID, events); err != nil {
		return fmt.Errorf("care contract: record the links: %w", err)
	}
	return nil
}

// decideChildLinks gives every pair its row and status, in the order of the
// file. A row that is held back names the first reason that applies. The
// second answer names per row the school whose child record the row shows, 0
// for a row that shows none.
func decideChildLinks(pairs []linkPair, schools []carecontract.School, contracts []ports.ContractChild,
	students map[int64]map[int64]carecontract.SchoolChild, today calendar.Date) ([]carecontract.ChildLinkRow, []int64) {
	decision := newLinkDecision(pairs, schools, contracts, students, today)
	rows, shownAt := make([]carecontract.ChildLinkRow, len(pairs)), make([]int64, len(pairs))
	for n, pair := range pairs {
		rows[n], shownAt[n] = decision.decide(pair)
	}
	return rows, shownAt
}

// linkDecision is what decideChildLinks decides the rows of one file
// against, and the lines that named a contract or a child before.
type linkDecision struct {
	contracts   []ports.ContractChild
	byID        map[int64]ports.ContractChild
	schoolNames map[int64]string
	students    map[int64]map[int64]carecontract.SchoolChild
	today       calendar.Date
	// byContract and byChild are the rows of the file that name a contract,
	// or a child record of a school, in the order of the file.
	byContract map[int64][]linkPair
	byChild    map[[2]int64][]linkPair
}

func newLinkDecision(pairs []linkPair, schools []carecontract.School, contracts []ports.ContractChild,
	students map[int64]map[int64]carecontract.SchoolChild, today calendar.Date) *linkDecision {
	decision := &linkDecision{contracts: contracts, byID: make(map[int64]ports.ContractChild, len(contracts)),
		schoolNames: make(map[int64]string, len(schools)), students: students, today: today,
		byContract: map[int64][]linkPair{}, byChild: map[[2]int64][]linkPair{}}
	for _, contract := range contracts {
		decision.byID[contract.ContractID] = contract
	}
	for _, pair := range pairs {
		contract, known := decision.byID[pair.contractID]
		if len(pair.problems) > 0 || !known {
			continue
		}
		decision.byContract[pair.contractID] = append(decision.byContract[pair.contractID], pair)
		if contract.ImportOrigin == "" {
			// A contract from an application is linked by no row, so its row
			// contests no child record.
			continue
		}
		key := [2]int64{contract.SchoolID, pair.studentID}
		decision.byChild[key] = append(decision.byChild[key], pair)
	}
	for _, school := range schools {
		decision.schoolNames[school.ID] = school.Name
	}
	return decision
}

// holdChildLink holds a row back with its status and one problem.
func holdChildLink(row *carecontract.ChildLinkRow, status, field, problem string) {
	row.Status = status
	row.Problems = append(row.Problems, carecontract.ChildLinkProblem{Field: field, Code: problem})
}

// decide answers one pair: invalid until the contract is an imported one of
// the Träger and its school has the child record, then judged. The second
// answer is the school whose contract the row shows, 0 for an unknown one.
func (d *linkDecision) decide(pair linkPair) (carecontract.ChildLinkRow, int64) {
	row := carecontract.ChildLinkRow{Line: pair.line, ContractID: ident.ID(pair.contractID), StudentID: ident.ID(pair.studentID),
		Problems: append([]carecontract.ChildLinkProblem{}, pair.problems...)}
	contract, known := d.byID[pair.contractID]
	// A row of a known contract shows the contract's child: its school logs it.
	var shown int64
	if known {
		shown = contract.SchoolID
		row.SchoolName = d.schoolNames[contract.SchoolID]
		row.ContractChildFirstName, row.ContractChildLastName, row.ContractChildBirthDate = contract.FirstName, contract.LastName, contract.BirthDate
	}
	switch {
	case known && contract.ImportOrigin == "":
		// A contract from an application has its child, whatever else the
		// row says or leaves out: the export of all contracts names it with
		// an empty child record before the school took the child over.
		row.Problems = nil
		holdChildLink(&row, carecontract.ChildLinkInvalid, carecontract.ChildLinkFieldContract, carecontract.ChildLinkProblemNotImported)
		return row, shown
	case len(row.Problems) > 0:
		row.Status = carecontract.ChildLinkInvalid
		return row, shown
	case !known:
		holdChildLink(&row, carecontract.ChildLinkInvalid, carecontract.ChildLinkFieldContract, carecontract.ChildLinkProblemUnknown)
		return row, shown
	}
	student, found := d.students[contract.SchoolID][pair.studentID]
	if !found {
		holdChildLink(&row, carecontract.ChildLinkInvalid, carecontract.ChildLinkFieldChild, carecontract.ChildLinkProblemUnknown)
		return row, shown
	}
	row.StudentFirstName, row.StudentLastName, row.StudentBirthDate = student.FirstName, student.LastName, student.BirthDate
	d.judge(&row, pair, contract, student)
	return row, shown
}

// judge decides a row whose contract and child record exist: a contract or a
// child the file named before, a contract linked already, another running
// contract of the child or a difference hold it back.
func (d *linkDecision) judge(row *carecontract.ChildLinkRow, pair linkPair, contract ports.ContractChild, student carecontract.SchoolChild) {
	if line := d.contestedContract(pair); line > 0 {
		row.RepeatsLine = line
		holdChildLink(row, carecontract.ChildLinkConflict, carecontract.ChildLinkFieldContract, carecontract.ChildLinkProblemRepeated)
		return
	}
	if line := d.contestedChild(pair, contract); line > 0 {
		row.RepeatsLine = line
		holdChildLink(row, carecontract.ChildLinkConflict, carecontract.ChildLinkFieldChild, carecontract.ChildLinkProblemRepeated)
		return
	}
	switch other := otherContract(d.contracts, contract, student); {
	case contract.StudentID != nil && *contract.StudentID == pair.studentID:
		row.Status = carecontract.ChildLinkLinked
	case contract.StudentID != nil:
		holdChildLink(row, carecontract.ChildLinkConflict, carecontract.ChildLinkFieldContract, carecontract.ChildLinkProblemLinkedOther)
	case other > 0:
		row.OtherContractID = ident.ID(other)
		holdChildLink(row, carecontract.ChildLinkConflict, carecontract.ChildLinkFieldChild, carecontract.ChildLinkProblemHasContract)
	case childDiffers(contract, student):
		holdChildLink(row, carecontract.ChildLinkConflict, carecontract.ChildLinkFieldChild, carecontract.ChildLinkProblemDiffers)
	default:
		row.Status = carecontract.ChildLinkReady
	}
}

// contestedContract is the line of another row that names the contract of
// pair, or 0. Rows that name one contract with different child records
// contradict each other, so none of them is linked: the order of the file
// decides nothing. Of rows that name the same pair the first one counts.
func (d *linkDecision) contestedContract(pair linkPair) int {
	rows := d.byContract[pair.contractID]
	for _, other := range rows {
		if other.studentID != pair.studentID {
			return other.line
		}
	}
	if first := rows[0]; first.line != pair.line {
		return first.line
	}
	return 0
}

// contestedChild is the line of another row that names the child record of
// pair for another contract holding in the time of this one, or 0: one child
// has one contract at a time, and the file does not say which. Contracts of
// one child that follow each other share no day and are all linked.
func (d *linkDecision) contestedChild(pair linkPair, contract ports.ContractChild) int {
	for _, other := range d.byChild[[2]int64{contract.SchoolID, pair.studentID}] {
		if other.contractID == pair.contractID {
			continue
		}
		if o := d.byID[other.contractID]; periodsOverlap(contract.StartsOn, contract.EndsOn, o.StartsOn, o.EndsOn) {
			return other.line
		}
	}
	return 0
}

// otherContract is another running contract of the school that is the
// child's and holds in the time of contract, or 0: two contracts of one
// child in one time would bill it twice. A contract is the child's when it
// is linked to the child record; one linked to none, as a contract from an
// application of a child the school had not taken over yet, when it names
// the child as the import compares children. A contract for the next phase
// shares no day with this one and is none.
func otherContract(contracts []ports.ContractChild, contract ports.ContractChild, student carecontract.SchoolChild) int64 {
	for _, other := range contracts {
		if other.ContractID == contract.ContractID || other.SchoolID != contract.SchoolID || !everHeld(other) ||
			!periodsOverlap(contract.StartsOn, contract.EndsOn, other.StartsOn, other.EndsOn) {
			continue
		}
		if other.StudentID != nil {
			if *other.StudentID == student.StudentID {
				return other.ContractID
			}
			continue
		}
		// Linked to no child record, the other contract is the child's only
		// by its names. Where the child record carries no date of birth, two
		// contracts born on different days are two children: namesakes.
		if !childDiffers(other, student) && (student.BirthDate != nil || !bornApart(contract, other)) {
			return other.ContractID
		}
	}
	return 0
}

// bornApart tells whether two contracts name children born on different
// days; a missing date of birth says nothing.
func bornApart(a, b ports.ContractChild) bool {
	return a.BirthDate != nil && b.BirthDate != nil && *a.BirthDate != *b.BirthDate
}

// everHeld tells whether a contract holds or held: all but a withdrawn one,
// which never held, and an ended one without a last day. A contract that
// ended before today still counts where times are compared: billing reads
// the past too.
func everHeld(child ports.ContractChild) bool {
	return child.Status != carecontract.StatusWithdrawn && (child.Status != carecontract.StatusEnded || child.EndsOn != nil)
}

// periodsOverlap tells whether two times share a day; a nil end is open.
func periodsOverlap(fromA calendar.Date, untilA *calendar.Date, fromB calendar.Date, untilB *calendar.Date) bool {
	return (untilB == nil || !untilB.Before(fromA)) && (untilA == nil || !untilA.Before(fromB))
}

// childDiffers tells whether the child record is named otherwise than the
// contract's child, or born on another day. A missing date of birth says
// nothing.
func childDiffers(contract ports.ContractChild, student carecontract.SchoolChild) bool {
	return !childKeyOf(0, contract.FirstName, contract.LastName, contract.BirthDate).
		same(childKeyOf(0, student.FirstName, student.LastName, student.BirthDate))
}

// acceptChildLinkDifference makes a row ready that only the difference of
// the names or the dates of birth holds back: the office saw both and
// confirmed them.
func acceptChildLinkDifference(rows []carecontract.ChildLinkRow) {
	for n := range rows {
		row := &rows[n]
		if row.Status == carecontract.ChildLinkConflict && len(row.Problems) == 1 && row.Problems[0].Code == carecontract.ChildLinkProblemDiffers {
			row.Status = carecontract.ChildLinkReady
		}
	}
}

// childLinkState names every row with what the run does with it: a run links
// only the preview it was given, by the fingerprint of this state.
func childLinkState(rows []carecontract.ChildLinkRow) []byte {
	// The rows are plain data: encoding them cannot fail.
	encoded, _ := json.Marshal(rows)
	return encoded
}

func countChildLinkRow(counts *carecontract.ChildLinkCounts, row carecontract.ChildLinkRow) {
	switch row.Status {
	case carecontract.ChildLinkReady:
		counts.Ready++
	case carecontract.ChildLinkLinked:
		counts.Linked++
	case carecontract.ChildLinkStored:
		counts.Stored++
	case carecontract.ChildLinkConflict:
		counts.Conflict++
	case carecontract.ChildLinkInvalid:
		counts.Invalid++
	}
}

// logSchools records in the access log of each school that the office saw
// which of its contracts a run names (ADR 0084 section 7): every row that
// shows the child of a contract of the school, with the child record where
// the row shows one.
func (l *ContractChildLinks) logSchools(ctx context.Context, reviewer carecontract.Reviewer, schools []carecontract.School,
	rows []carecontract.ChildLinkRow, shownAt []int64) error {
	for _, school := range schools {
		var contracts, students []int64
		for n, row := range rows {
			if shownAt[n] != school.ID {
				continue
			}
			contracts = append(contracts, row.ContractID.Int64())
			if row.StudentFirstName != "" || row.StudentLastName != "" {
				students = append(students, row.StudentID.Int64())
			}
		}
		if len(contracts) == 0 {
			continue
		}
		err := l.ports.Runtime.WithinSchool(ctx, school.ID, func(txCtx context.Context) error {
			return l.ports.Access.RecordAccess(txCtx, carecontract.SchoolAccess{
				OrganizationID: reviewer.OrganizationID, AccountID: reviewer.AccountID, Data: carecontract.SchoolAccessContracts,
				View: accessViewChildLink, Rows: len(contracts), ContractIDs: contracts, StudentIDs: students,
			})
		})
		if err != nil {
			return fmt.Errorf("care contract: access log of school %d: %w", school.ID, err)
		}
	}
	return nil
}
