package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The conclusion of a signed contract (#4679). A signature, online or on
// paper, concludes the sent contract through the one transition of #4680
// (concludeContract): it becomes aktiv with the method and the instant of
// the signature, its version wirksam, under the row lock the caller holds.

// concludeSigned concludes the sent contract of record with the signature
// made at at: einfach_elektronisch for a drawn or typed signature, papier
// for a paper contract. A contract the transition refuses is no contract a
// signature can conclude.
func concludeSigned(ctx context.Context, store Store, organizationID, accountID int64, record ContractRecord,
	signature string, at time.Time) (string, error) {
	method := carecontract.MethodElectronic
	if signature == carecontract.SignaturePaper {
		method = carecontract.MethodPaper
	}
	err := concludeContract(ctx, store, organizationID, accountID, record, carecontract.Concluded{Method: method, At: at})
	if errors.Is(err, carecontract.ErrContractNotConcludable) {
		return "", fmt.Errorf("%w: %w", carecontract.ErrContractNotSignable, err)
	}
	if err != nil {
		return "", err
	}
	return carecontract.StatusActive, nil
}

// awaitsSignature tells whether the record's version waits for the parents'
// signature: the version of a sent contract, or the changed version of an
// active one (#4816).
func awaitsSignature(record ContractRecord) bool {
	return record.Version.Status == carecontract.VersionRequested &&
		(record.Summary.Status == carecontract.StatusSent || record.Summary.Status == carecontract.StatusActive)
}

// waitingRecord points the record of an active contract at its changed
// version that waits for a signature, with that version's PDF, and tells
// whether the record's version waits now. A sent contract's own version
// waits; an active contract without a waiting version keeps the version in
// force.
func waitingRecord(ctx context.Context, store Store, organizationID int64, record *ContractRecord) (bool, error) {
	if record.Summary.Status == carecontract.StatusActive {
		if _, err := store.WaitingVersion(ctx, organizationID, record); err != nil {
			return false, err
		}
	}
	return awaitsSignature(*record), nil
}

// activateSigned moves the signed changed version of an active contract
// into its timeline (#4816), under the row lock the caller holds. It holds
// from its effective date, or from today when that day has passed: no
// version reaches into the past, and the version in force held until the
// signature. The step is the one of a new version (timeline.go): it
// replaces the version starting on its day, goes before a planned one, or
// follows the version in force as the newest. It answers the day the
// version holds from.
func activateSigned(ctx context.Context, store Store, organizationID int64, record ContractRecord, today calendar.Date) (calendar.Date, error) {
	signed := record.Version
	activation := ports.VersionActivation{VersionID: signed.ID.Int64(), Status: carecontract.VersionEffective, EffectiveFrom: signed.EffectiveFrom}
	if signed.EffectiveFrom.Before(today) {
		agreed := signed.EffectiveFrom
		activation.EffectiveFrom, activation.AgreedFrom = today, &agreed
	}
	if signed.EndsOn != nil && signed.EndsOn.Before(activation.EffectiveFrom) {
		return "", fmt.Errorf("%w: the changed version ended before it was signed", carecontract.ErrContractNotSignable)
	}
	versions, err := store.Versions(ctx, organizationID, record.Summary.ID.Int64())
	if err != nil {
		return "", err
	}
	for _, version := range versions {
		effective := version.Status == carecontract.VersionEffective || version.Status == carecontract.VersionSuperseded
		switch {
		case !effective:
		case version.EffectiveFrom == activation.EffectiveFrom:
			activation.Step, activation.Status = ports.VersionStep{Replace: version.ID.Int64(), Status: version.Status}, version.Status
		case version.EffectiveFrom.After(activation.EffectiveFrom) && activation.Step.Replace == 0:
			activation.Step, activation.Status = ports.VersionStep{}, carecontract.VersionSuperseded
		case version.Status == carecontract.VersionEffective && activation.Status == carecontract.VersionEffective && activation.Step.Replace == 0:
			activation.Step = ports.VersionStep{Supersede: version.ID.Int64(), Status: carecontract.VersionEffective}
		}
	}
	err = store.ActivateVersion(ctx, organizationID, record.Summary.ID.Int64(), activation)
	if errors.Is(err, ports.ErrVersionMoved) {
		return "", fmt.Errorf("%w: %w", carecontract.ErrContractNotSignable, err)
	}
	return activation.EffectiveFrom, err
}

// versionChecksum is the SHA-256 of the structured version the parents
// sign: child, place of care, services, price, terms and dates. What the
// timeline derives is left out: the state changes when the version takes
// effect, and ValidUntil when a later version starts (#4681).
func versionChecksum(fingerprint func([]byte) string, version carecontract.Version) (string, error) {
	version.Status, version.ValidUntil = "", nil
	// A version signed after the day its document names holds from the day
	// of the signature (#4816); the checksum counts the date the parents
	// read and signed.
	if version.AgreedFrom != nil {
		version.EffectiveFrom, version.AgreedFrom = *version.AgreedFrom, nil
	}
	encoded, err := json.Marshal(version)
	if err != nil {
		return "", fmt.Errorf("care contract: encode version: %w", err)
	}
	return fingerprint(encoded), nil
}
