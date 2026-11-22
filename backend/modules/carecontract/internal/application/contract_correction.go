package application

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The correction of contracts from an import (#7767). A look at a file reads
// it, finds the contract of every row among the contracts of the Träger and
// answers what the correction would change; with Apply it stores the
// changing rows in one Träger transaction, each contract locked from the
// read to the write. Afterwards it records in the access log of every school
// whose contracts it showed or changed. The file is never stored: the trail
// of each corrected contract keeps its name, the line, the proof and the
// values before and after.

const accessViewCorrection = "care_contract_correction"

// CorrectionStore persists what a correction reads and writes, in the Träger
// transaction of organizationID.
type CorrectionStore interface {
	CorrectionSubjects(ctx context.Context, organizationID int64, contractIDs []int64, all, lock bool) ([]ports.CorrectionSubject, error)
	ApplyCorrections(ctx context.Context, organizationID int64, corrections []ports.Correction) error
	ContractCorrectionEvents(ctx context.Context, organizationID int64) ([]carecontract.ContractCorrectionEntry, error)
	InsertEvents(ctx context.Context, organizationID int64, events []Event) error
}

// CorrectionPorts are the root-bound ports of the correction.
type CorrectionPorts struct {
	Access  carecontract.SchoolAccessLog
	Runtime carecontract.Runtime
	// Fingerprint names content by its checksum, for the confirmation of a
	// preview.
	Fingerprint func([]byte) string
}

// ContractCorrections serves carecontract.ContractCorrections.
type ContractCorrections struct {
	store CorrectionStore
	ports CorrectionPorts
	today func() calendar.Date
}

var _ carecontract.ContractCorrections = (*ContractCorrections)(nil)

func NewContractCorrections(store CorrectionStore, ports CorrectionPorts, today func() calendar.Date) *ContractCorrections {
	if store == nil || ports.Access == nil || ports.Runtime == nil || ports.Fingerprint == nil || today == nil {
		panic("care contract: the store, the access log, the runtime, the fingerprint and the clock are required")
	}
	return &ContractCorrections{store: store, ports: ports, today: today}
}

// CorrectContracts reads the file, answers every row and, with Apply, stores
// the changing rows.
func (c *ContractCorrections) CorrectContracts(ctx context.Context, reviewer carecontract.Reviewer, request carecontract.ContractCorrectionRequest) (carecontract.ContractCorrectionRun, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.ContractCorrectionRun{}, err
	}
	table, err := readContractImportTable(request.Content, "")
	if err != nil {
		return carecontract.ContractCorrectionRun{}, err
	}
	run := carecontract.ContractCorrectionRun{Encoding: table.Encoding, Delimiter: table.Delimiter, Headers: table.Headers,
		Rows: []carecontract.ContractCorrectionRow{}}
	index, missing := resolveCorrectionColumns(table.Headers)
	if run.Missing = missing; len(missing) > 0 {
		if request.Apply {
			fields := map[string]string{}
			for _, field := range missing {
				fields[field] = "required"
			}
			return carecontract.ContractCorrectionRun{}, &carecontract.ValidationError{Fields: fields}
		}
		return run, nil
	}
	entries := make([]correctionEntry, len(table.Rows))
	for n, cells := range table.Rows {
		entries[n] = readCorrectionEntry(index, cells, table.Lines[n], c.today())
	}
	var shown map[int64][]int64
	err = c.ports.Runtime.WithinTraeger(ctx, reviewer.OrganizationID, func(txCtx context.Context) error {
		var err error
		shown, err = c.evaluate(txCtx, reviewer, request, entries, &run)
		return err
	})
	if err != nil {
		return carecontract.ContractCorrectionRun{}, err
	}
	if err := logContractSchools(ctx, c.ports.Runtime, c.ports.Access, reviewer, accessViewCorrection, shown); err != nil {
		return carecontract.ContractCorrectionRun{}, err
	}
	return run, nil
}

// evaluate fills the answer in the Träger transaction: the rows against the
// contracts they name and, with Apply, the stored corrections. It answers
// per school the contracts whose values the answer shows.
func (c *ContractCorrections) evaluate(ctx context.Context, reviewer carecontract.Reviewer, request carecontract.ContractCorrectionRequest,
	entries []correctionEntry, run *carecontract.ContractCorrectionRun) (map[int64][]int64, error) {
	ids := []int64{}
	for _, entry := range entries {
		if entry.contractID > 0 && !slices.Contains(ids, entry.contractID) {
			ids = append(ids, entry.contractID)
		}
	}
	slices.Sort(ids)
	subjects, err := c.store.CorrectionSubjects(ctx, reviewer.OrganizationID, ids, false, request.Apply)
	if err != nil {
		return nil, err
	}
	check := newCorrectionCheck(subjects)
	plans := make([]correctionPlan, len(entries))
	for n, entry := range entries {
		plans[n] = check.plan(entry)
	}
	run.Fingerprint = c.ports.Fingerprint(correctionState(plans))
	if request.Apply {
		if request.Fingerprint != run.Fingerprint {
			return nil, carecontract.ErrContractCorrectionChanged
		}
		if err := c.apply(ctx, reviewer, importFileName(request.FileName), plans); err != nil {
			return nil, err
		}
		run.Applied = true
	}
	shown := map[int64][]int64{}
	for _, plan := range plans {
		run.Rows = append(run.Rows, plan.row)
		countCorrectionRow(&run.Counts, plan.row.Status)
		if plan.schoolID > 0 {
			shown[plan.schoolID] = append(shown[plan.schoolID], plan.row.ContractID.Int64())
		}
	}
	return shown, trail(ctx, c.store, reviewer.OrganizationID, reviewer.AccountID, 0, 0, ActionRead,
		map[string]any{"view": "correction", "rows": len(plans), "applied": run.Applied})
}

// apply stores the changing rows and records each with the file, its line,
// the proof and the values before and after.
func (c *ContractCorrections) apply(ctx context.Context, reviewer carecontract.Reviewer, file string, plans []correctionPlan) error {
	var corrections []ports.Correction
	var events []Event
	for n := range plans {
		plan := &plans[n]
		if plan.row.Status != carecontract.ContractCorrectionChange {
			continue
		}
		corrections = append(corrections, plan.correction)
		contractID, schoolID := plan.correction.ContractID, plan.schoolID
		events = append(events, Event{ContractID: &contractID, SchoolID: &schoolID, AccountID: reviewer.AccountID, Action: ActionCorrect,
			Details: map[string]any{ports.CorrectionFileDetail: file, ports.CorrectionLineDetail: plan.row.Line,
				ports.CorrectionEvidenceDetail: plan.row.Evidence, ports.CorrectionChangesDetail: plan.row.Changes,
				ports.CorrectionBeforeDetail: plan.row.Before, ports.CorrectionAfterDetail: plan.row.After}})
		plan.row.Status = carecontract.ContractCorrectionCorrected
	}
	if len(corrections) == 0 {
		return nil
	}
	if err := c.store.ApplyCorrections(ctx, reviewer.OrganizationID, corrections); err != nil {
		return err
	}
	if err := c.store.InsertEvents(ctx, reviewer.OrganizationID, events); err != nil {
		return fmt.Errorf("care contract: record the correction: %w", err)
	}
	return nil
}

func countCorrectionRow(counts *carecontract.ContractCorrectionCounts, status string) {
	switch status {
	case carecontract.ContractCorrectionChange:
		counts.Change++
	case carecontract.ContractCorrectionUnchanged:
		counts.Unchanged++
	case carecontract.ContractCorrectionInvalid:
		counts.Invalid++
	case carecontract.ContractCorrectionCorrected:
		counts.Corrected++
	}
}

// correctionState names every row with what the correction does with it and
// what it stores: a correction stores only the preview it was given, by the
// fingerprint of this state. A contract that changed since the preview has
// other values before and so another state.
func correctionState(plans []correctionPlan) []byte {
	type stateRow struct {
		Row        carecontract.ContractCorrectionRow `json:"row"`
		Correction ports.Correction                   `json:"correction"`
	}
	rows := make([]stateRow, len(plans))
	for n, plan := range plans {
		rows[n] = stateRow{Row: plan.row, Correction: plan.correction}
	}
	// The values are plain data: encoding them cannot fail.
	encoded, _ := json.Marshal(rows)
	return encoded
}

// ContractCorrectionList lists every contract from an import as the file to
// fill in, and records in the access log of each school that the office took
// its contracts out.
func (c *ContractCorrections) ContractCorrectionList(ctx context.Context, reviewer carecontract.Reviewer) (carecontract.ContractCorrectionSheet, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.ContractCorrectionSheet{}, err
	}
	var subjects []ports.CorrectionSubject
	err := c.ports.Runtime.WithinTraeger(ctx, reviewer.OrganizationID, func(txCtx context.Context) error {
		var err error
		if subjects, err = c.store.CorrectionSubjects(txCtx, reviewer.OrganizationID, nil, true, false); err != nil {
			return err
		}
		return trail(txCtx, c.store, reviewer.OrganizationID, reviewer.AccountID, 0, 0, ActionRead,
			map[string]any{"view": "correction_list", "rows": len(subjects)})
	})
	if err != nil {
		return carecontract.ContractCorrectionSheet{}, err
	}
	shown := map[int64][]int64{}
	for _, subject := range subjects {
		shown[subject.SchoolID] = append(shown[subject.SchoolID], subject.ContractID)
	}
	if err := logContractSchools(ctx, c.ports.Runtime, c.ports.Access, reviewer, accessViewCorrection, shown); err != nil {
		return carecontract.ContractCorrectionSheet{}, err
	}
	return correctionSheet(subjects), nil
}

// ContractCorrectionLog lists the correction files of the Träger, newest
// first.
func (c *ContractCorrections) ContractCorrectionLog(ctx context.Context, reviewer carecontract.Reviewer) ([]carecontract.ContractCorrectionEntry, error) {
	if err := checkReviewer(reviewer); err != nil {
		return nil, err
	}
	var entries []carecontract.ContractCorrectionEntry
	err := c.ports.Runtime.WithinTraeger(ctx, reviewer.OrganizationID, func(txCtx context.Context) error {
		var err error
		entries, err = c.store.ContractCorrectionEvents(txCtx, reviewer.OrganizationID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return entries, nil
}

// logContractSchools records in the access log of each school that the
// office saw or changed which of its contracts under view (ADR 0084 section
// 7).
func logContractSchools(ctx context.Context, runtime carecontract.Runtime, access carecontract.SchoolAccessLog,
	reviewer carecontract.Reviewer, view string, bySchool map[int64][]int64) error {
	schools := make([]int64, 0, len(bySchool))
	for school := range bySchool {
		schools = append(schools, school)
	}
	slices.Sort(schools)
	for _, school := range schools {
		ids := bySchool[school]
		err := runtime.WithinSchool(ctx, school, func(txCtx context.Context) error {
			return access.RecordAccess(txCtx, carecontract.SchoolAccess{
				OrganizationID: reviewer.OrganizationID, AccountID: reviewer.AccountID,
				Data: carecontract.SchoolAccessContracts, View: view, Rows: len(ids), ContractIDs: ids,
			})
		})
		if err != nil {
			return fmt.Errorf("care contract: access log of school %d: %w", school, err)
		}
	}
	return nil
}
