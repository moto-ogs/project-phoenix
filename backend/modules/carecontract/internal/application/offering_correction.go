package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The correction of the modules imported contracts book (#7764, ADR 0306).
// A look at a file reads it, finds the contracts it names and answers what
// the correction would do with each; with Apply it gives the ready contracts
// their new version in one Träger transaction, under the row lock of each
// contract. Like the import it reads each school's modules in that school's
// tenant transaction first (master data), then works in the Träger
// transaction, then records in the access log of every school whose
// contracts it showed. The file is never stored: the trail of each corrected
// contract keeps its name and the lines.

const accessViewOfferingCorrection = "care_contract_offering_correction"

// CorrectOfferings reads the file, answers every contract it names and, with
// Apply, corrects the ready ones.
func (i *ContractImports) CorrectOfferings(ctx context.Context, reviewer carecontract.Reviewer, request carecontract.OfferingCorrectionRequest) (carecontract.OfferingCorrection, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.OfferingCorrection{}, err
	}
	if request.EffectiveFrom.IsZero() || request.EffectiveFrom.Before(i.today()) {
		// No version reaches into the past (#4681): a month that may be
		// billed already keeps its modules.
		return carecontract.OfferingCorrection{}, &carecontract.ValidationError{Fields: map[string]string{"effective_from": "past"}}
	}
	table, err := readContractImportTable(request.Content, request.Delimiter)
	if err != nil {
		return carecontract.OfferingCorrection{}, err
	}
	result := carecontract.OfferingCorrection{Encoding: table.Encoding, Delimiter: table.Delimiter, Headers: table.Headers,
		EffectiveFrom: request.EffectiveFrom, Contracts: []carecontract.OfferingCorrectionContract{}}
	index, missing := offeringCorrectionIndex(table.Headers)
	result.MissingColumns = missing
	if len(missing) > 0 {
		if request.Apply {
			return carecontract.OfferingCorrection{}, &carecontract.ValidationError{Fields: map[string]string{"file": "columns_missing"}}
		}
		return result, nil
	}
	groups := readCorrectionGroups(table, index)
	schools, err := i.importSchools(ctx, reviewer.OrganizationID)
	if err != nil {
		return carecontract.OfferingCorrection{}, err
	}
	var shown map[int64][]int64
	err = i.ports.Runtime.WithinTraeger(ctx, reviewer.OrganizationID, func(txCtx context.Context) error {
		var err error
		shown, err = i.correct(txCtx, reviewer, request, groups, schools, &result)
		return err
	})
	if err != nil {
		return carecontract.OfferingCorrection{}, err
	}
	if err := i.logSchools(ctx, reviewer, accessViewOfferingCorrection, shown); err != nil {
		return carecontract.OfferingCorrection{}, err
	}
	return result, nil
}

// correct fills the answer in the Träger transaction and, with Apply, stores
// the new versions. It answers per school the contracts the answer names.
func (i *ContractImports) correct(ctx context.Context, reviewer carecontract.Reviewer, request carecontract.OfferingCorrectionRequest,
	groups []correctionGroup, schools []importSchool, result *carecontract.OfferingCorrection) (map[int64][]int64, error) {
	organizationID := reviewer.OrganizationID
	// With Apply the contracts are read under their row lock, so the
	// timeline the correction was decided on holds until it is stored.
	contracts, err := i.store.CorrectableContracts(ctx, organizationID, correctionContractIDs(groups), request.Apply)
	if err != nil {
		return nil, err
	}
	check := newCorrectionCheck(contracts, schools, request.EffectiveFrom)
	candidates := make([]correctionCandidate, len(groups))
	for n, group := range groups {
		candidates[n] = check.candidate(group)
	}
	result.Fingerprint = i.ports.Fingerprint(offeringCorrectionState(request.EffectiveFrom, candidates))
	if request.Apply {
		if request.Fingerprint != result.Fingerprint {
			return nil, carecontract.ErrContractImportChanged
		}
		if err := i.applyCorrections(ctx, reviewer, importFileName(request.FileName), candidates); err != nil {
			return nil, err
		}
		result.Applied = true
	}
	shown := summarizeOfferingCorrection(result, candidates)
	return shown, trail(ctx, i.store, organizationID, reviewer.AccountID, 0, 0, ActionRead,
		map[string]any{"view": "offering_correction", "contracts": len(candidates), "applied": result.Applied})
}

// applyCorrections stores the new version of every ready contract and
// records each with the file and its lines.
func (i *ContractImports) applyCorrections(ctx context.Context, reviewer carecontract.Reviewer, file string, candidates []correctionCandidate) error {
	var corrected []ports.CorrectedVersion
	for _, candidate := range candidates {
		if candidate.version != nil {
			corrected = append(corrected, *candidate.version)
		}
	}
	stored, err := i.store.InsertCorrectedVersions(ctx, reviewer.OrganizationID, corrected)
	if errors.Is(err, ports.ErrVersionMoved) || (err == nil && len(stored) != len(corrected)) {
		return carecontract.ErrContractImportChanged
	}
	if err != nil {
		return err
	}
	events := make([]Event, 0, len(corrected))
	for n := range candidates {
		candidate := &candidates[n]
		if candidate.version == nil {
			continue
		}
		candidate.contract.Status = carecontract.OfferingCorrectionCorrected
		events = append(events, correctionEvent(reviewer, file, *candidate, stored[candidate.version.ContractID]))
	}
	if err := i.store.InsertEvents(ctx, reviewer.OrganizationID, events); err != nil {
		return fmt.Errorf("care contract: record the correction: %w", err)
	}
	return nil
}

// correctionEvent is the trail entry of one corrected contract: the new
// version as an amendment records it, with the file and the lines it came
// from.
func correctionEvent(reviewer carecontract.Reviewer, file string, candidate correctionCandidate, versionID int64) Event {
	version, step := candidate.version.Version, candidate.version.Step
	contractID, schoolID := candidate.version.ContractID, candidate.contract.SchoolID.Int64()
	details := map[string]any{
		ports.OfferingCorrectionActionDetail: file, "lines": candidate.lines,
		"version_id": versionID, "version_number": version.Number, "source": version.Source,
		"effective_from": version.EffectiveFrom.String(), "status": version.Status,
		"care_offering_ids": versionOfferings(version),
	}
	if step.Replace != 0 {
		details["replaced_version_id"] = step.Replace
	}
	return Event{ContractID: &contractID, SchoolID: &schoolID, AccountID: reviewer.AccountID, Action: ActionCreate, Details: details}
}

// summarizeOfferingCorrection puts the contracts into the answer and counts
// them. It answers per school the contracts the answer names.
func summarizeOfferingCorrection(result *carecontract.OfferingCorrection, candidates []correctionCandidate) map[int64][]int64 {
	shown := map[int64][]int64{}
	for _, candidate := range candidates {
		contract := candidate.contract
		result.Contracts = append(result.Contracts, contract)
		switch contract.Status {
		case carecontract.OfferingCorrectionReady:
			result.Counts.Ready++
		case carecontract.OfferingCorrectionUnchanged:
			result.Counts.Unchanged++
		case carecontract.OfferingCorrectionHeld:
			result.Counts.Held++
		case carecontract.OfferingCorrectionCorrected:
			result.Counts.Corrected++
		default:
			result.Counts.Invalid++
		}
		if contract.ContractID > 0 {
			shown[contract.SchoolID.Int64()] = append(shown[contract.SchoolID.Int64()], contract.ContractID.Int64())
		}
	}
	return shown
}

// offeringCorrectionState names the day and every contract with what the
// correction does with it, its new version included: a correction takes over
// only the preview it was given, by the fingerprint of this state.
func offeringCorrectionState(day calendar.Date, candidates []correctionCandidate) []byte {
	type stateRow struct {
		Contract carecontract.OfferingCorrectionContract `json:"contract"`
		Version  *ports.CorrectedVersion                 `json:"version"`
	}
	rows := make([]stateRow, len(candidates))
	for n, candidate := range candidates {
		rows[n] = stateRow{Contract: candidate.contract, Version: candidate.version}
	}
	// The values are plain data: encoding them cannot fail.
	encoded, _ := json.Marshal(struct {
		Day  calendar.Date `json:"day"`
		Rows []stateRow    `json:"rows"`
	}{day, rows})
	return encoded
}
