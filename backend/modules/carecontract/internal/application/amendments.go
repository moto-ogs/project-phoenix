package application

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// AmendFromBookings makes the next version of every active contract whose
// booked care changed after its newest version (#4681). The parents request
// the change and the school approves it in Care Plan's existing change
// request; the approval changes the bookings in the school's tenant. The
// contract lives at the Träger, and no transaction holds both (ADR 0105), so
// the contract follows the committed bookings in its own Träger transaction,
// like the conclusion at acceptance (#4680). A run that fails or is cut
// short changes nothing; the next run finds the same difference.
//
// The run acts for no account and reads the bookings for the contract, not
// for a person, so it writes no entry into the school's access log (as the
// conclusion at acceptance); every new version lands in the trail.
func (c *Conclusions) AmendFromBookings(ctx context.Context, organizationID int64) (carecontract.AmendmentRun, error) {
	run := carecontract.AmendmentRun{Amended: []carecontract.AmendedContract{}, Awaiting: []carecontract.AmendedContract{},
		Skipped: []carecontract.AmendmentSkip{}}
	if organizationID <= 0 {
		return run, carecontract.ErrSchoolOutsideTraeger
	}
	var contracts []AmendableContract
	var sent []SentContract
	err := c.intake.runtime.WithinTraeger(ctx, organizationID, func(txCtx context.Context) error {
		var err error
		if contracts, err = c.intake.store.AmendableContracts(txCtx, organizationID); err != nil {
			return err
		}
		sent, err = c.intake.store.SentContracts(txCtx, organizationID)
		return err
	})
	if err != nil || len(contracts)+len(sent) == 0 {
		return run, err
	}
	schools, err := c.intake.schools.TraegerSchools(ctx, organizationID)
	if err != nil {
		return run, fmt.Errorf("care contract: schools: %w", err)
	}
	today := c.intake.today()
	for _, school := range schools {
		if err := c.amendSchool(ctx, organizationID, school, following{active: contracts, sent: sent}, today, &run); err != nil {
			return run, err
		}
	}
	return run, nil
}

// following are the contracts of a Träger that follow the approved
// bookings: the active ones with a new version, and the sent ones that
// wait for their first signature with a changed version to sign (#4816).
type following struct {
	active []AmendableContract
	sent   []SentContract
}

// at keeps the contracts of one school, with their application children.
func (f following) at(schoolID int64) (following, []int64) {
	atSchool, children := following{}, []int64{}
	for _, contract := range f.active {
		if contract.Key.SchoolID == schoolID {
			atSchool.active = append(atSchool.active, contract)
			children = append(children, contract.Key.RequestChildID)
		}
	}
	for _, contract := range f.sent {
		if contract.Key.SchoolID == schoolID {
			atSchool.sent = append(atSchool.sent, contract)
			children = append(children, contract.Key.RequestChildID)
		}
	}
	return atSchool, children
}

// amendSchool reads the bookings of the school's contracted children in its
// tenant transaction and amends each contract whose care changed.
func (c *Conclusions) amendSchool(ctx context.Context, organizationID int64, school carecontract.School,
	contracts following, today calendar.Date, run *carecontract.AmendmentRun) error {
	atSchool, children := contracts.at(school.ID)
	if len(children) == 0 {
		return nil
	}
	read := schoolRead{school: school, offerings: map[int64]carecontract.Offering{}}
	if err := c.intake.runtime.WithinSchool(ctx, school.ID, func(txCtx context.Context) error {
		if err := c.intake.readSchool(txCtx, &read, children); err != nil {
			return err
		}
		return c.intake.readParentRequests(txCtx, &read)
	}); err != nil {
		return fmt.Errorf("care contract: read school %d: %w", school.ID, err)
	}
	for _, contract := range atSchool.active {
		if err := c.amendContract(ctx, organizationID, read, contract, today, run); err != nil {
			return err
		}
	}
	for _, contract := range atSchool.sent {
		if err := c.followSent(ctx, organizationID, read, contract, today, run); err != nil {
			return err
		}
	}
	return nil
}

// amendContract makes the next version of one contract, or records in run
// why its changed care makes none. A change the parents asked for
// themselves holds at once; any other waits for their signature (#4816).
func (c *Conclusions) amendContract(ctx context.Context, organizationID int64, read schoolRead, contract AmendableContract,
	today calendar.Date, run *carecontract.AmendmentRun) error {
	application, ok := findApplication(read.applications, contract.Key.RequestChildID)
	if !ok {
		run.Skipped = append(run.Skipped, carecontract.AmendmentSkip{ContractID: contract.ID, Reason: carecontract.SkipApplicationGone})
		return nil
	}
	plan, reason, next := nextChange(read, application, contract, today)
	if reason != "" {
		run.Skipped = append(run.Skipped, carecontract.AmendmentSkip{ContractID: contract.ID, Reason: reason})
		return nil
	}
	if plan == nil {
		return c.dropWaiting(ctx, organizationID, contract)
	}
	consent := parentConsent(read, application, contract, next)
	if consent == nil && waitingCarries(contract.Waiting, plan.version, today) {
		return nil
	}
	amended := carecontract.AmendedContract{ContractID: contract.ID, VersionNumber: plan.version.Number, EffectiveFrom: plan.version.EffectiveFrom}
	done, reason, err := c.nextVersion(ctx, organizationID, contract, *plan, consent)
	switch {
	case reason != "":
		run.Skipped = append(run.Skipped, carecontract.AmendmentSkip{ContractID: contract.ID, Reason: reason})
	case done && consent != nil:
		run.Amended = append(run.Amended, amended)
	case done:
		run.Awaiting = append(run.Awaiting, amended)
	}
	return err
}

// nextVersion stores the new version of an active contract. With the
// parents' own request it joins the timeline and the request is recorded as
// its signature; without one it waits as beantragt, with a one-time link to
// sign it (#4816). A contract that changed since the read (another run, a
// termination) is left for the next run; one whose PDF or mail cannot be
// made yet is held back with the reason.
func (c *Conclusions) nextVersion(ctx context.Context, organizationID int64, contract AmendableContract, plan amendmentPlan,
	consent *signedRequest) (bool, string, error) {
	change := versionChange{version: plan.version, step: timelineStep(contract, plan), purpose: carecontract.MailPurposeAmended,
		details: map[string]any{"replaced_version_id": replacedID(plan), "change_request_id": consent.requestID()}}
	if consent == nil {
		change.version.Status, change.step, change.purpose = carecontract.VersionRequested, waitingStep(contract), carecontract.MailPurposeAmendment
	}
	amended := false
	reason, err := c.amend(ctx, organizationID, contract.ID, func(txCtx context.Context) error {
		record, unchanged, err := c.lockedTimeline(txCtx, organizationID, contract)
		if err != nil || !unchanged {
			return err
		}
		if consent != nil {
			if overtaken, err := c.overtakeWaiting(txCtx, organizationID, contract); err != nil || !overtaken {
				return err
			}
		}
		if record, amended, err = c.storeVersion(txCtx, organizationID, record, change); err != nil || !amended {
			return err
		}
		return c.recordRequest(txCtx, organizationID, record, consent)
	})
	return amended && reason == "", reason, err
}

// overtakeWaiting ends the wait of the contract's waiting version, if one
// waits: the version the parents asked for themselves takes its place, and
// its link must sign nothing any more. False when another write moved it.
func (c *Conclusions) overtakeWaiting(ctx context.Context, organizationID int64, contract AmendableContract) (bool, error) {
	if contract.Waiting == nil {
		return true, nil
	}
	err := c.intake.store.OvertakeVersion(ctx, organizationID, contract.ID, contract.Waiting.ID.Int64())
	if errors.Is(err, ports.ErrVersionMoved) {
		return false, nil
	}
	return err == nil, err
}

// amend runs one write of a contract's versions in the contract's own
// Träger transaction; the write takes the row lock of the contract. A
// write held back (errHoldBack) rolls back and answers its reason, so the
// next run finds the same change.
func (c *Conclusions) amend(ctx context.Context, organizationID, contractID int64, write func(context.Context) error) (string, error) {
	err := c.intake.runtime.WithinTraeger(ctx, organizationID, write)
	if reason := holdBackReason(err); reason != "" {
		return reason, nil
	}
	if err != nil {
		return "", fmt.Errorf("care contract: amend contract %d: %w", contractID, err)
	}
	return "", nil
}

// versionChange is a new version of a contract with what it does to the
// versions before it, the mail that brings it to the parents and what the
// trail names besides.
type versionChange struct {
	version carecontract.Version
	step    VersionStep
	purpose string
	details map[string]any
}

// storeVersion stores the changed version of the contract locked as record,
// records it in the trail, freezes its PDF and brings it to the parents. It
// answers the record pointed at the stored version; false when another
// write moved the version it steps on.
func (c *Conclusions) storeVersion(ctx context.Context, organizationID int64, record ContractRecord, change versionChange) (ContractRecord, bool, error) {
	contractID, version := record.Summary.ID.Int64(), change.version
	versionID, err := c.intake.store.InsertVersion(ctx, organizationID, contractID, change.step, version)
	if errors.Is(err, ports.ErrVersionMoved) {
		return record, false, nil
	}
	if err != nil {
		return record, false, err
	}
	details := map[string]any{
		"version_id": versionID, "version_number": version.Number, "source": version.Source,
		"effective_from": version.EffectiveFrom.String(), "status": version.Status, "overtaken_version_id": overtakenID(change.step),
	}
	maps.Copy(details, change.details)
	if err := trailContract(ctx, c.intake.store, organizationID, 0, record, ActionCreate, details); err != nil {
		return record, false, err
	}
	if record, err = c.withStoredVersion(ctx, organizationID, record, versionID); err != nil {
		return record, false, err
	}
	return record, true, changeHoldBack(c.contracts.deliverChange(ctx, organizationID, record, change.purpose))
}

// withStoredVersion points record at the version just stored, as the store
// reads it back: the checksum the parents sign counts the stored version,
// with the instant the database gave it.
func (c *Conclusions) withStoredVersion(ctx context.Context, organizationID int64, record ContractRecord, versionID int64) (ContractRecord, error) {
	versions, err := c.intake.store.Versions(ctx, organizationID, record.Summary.ID.Int64())
	if err != nil {
		return record, err
	}
	for _, version := range versions {
		if version.ID == ident.ID(versionID) {
			record.Version, record.DocumentID, record.Issuer = version, nil, nil
			return record, nil
		}
	}
	return record, fmt.Errorf("care contract: the stored version %d is missing", versionID)
}

// changeHoldBack holds a changed version back for the next run when its PDF
// or its mail cannot be made yet: the Träger-Büro fixes a missing letterhead
// or contract partner, and a mail that still waits is through by then. The
// transaction rolls back, so the next run finds the same change.
func changeHoldBack(err error) error {
	if errors.Is(err, carecontract.ErrLetterheadMissing) {
		return errHoldBack{reason: carecontract.SkipLetterheadMissing}
	}
	if reason, ok := sendSkipReason(err); ok {
		return errHoldBack{reason: reason}
	}
	return err
}

// dropWaiting ends the wait of a changed version whose change the bookings
// no longer carry: the school took it back before the parents signed.
func (c *Conclusions) dropWaiting(ctx context.Context, organizationID int64, contract AmendableContract) error {
	if contract.Waiting == nil {
		return nil
	}
	waiting := *contract.Waiting
	_, err := c.amend(ctx, organizationID, contract.ID, func(txCtx context.Context) error {
		record, unchanged, err := c.lockedTimeline(txCtx, organizationID, contract)
		if err != nil || !unchanged {
			return err
		}
		err = c.intake.store.OvertakeVersion(txCtx, organizationID, contract.ID, waiting.ID.Int64())
		if errors.Is(err, ports.ErrVersionMoved) {
			return nil
		}
		if err != nil {
			return err
		}
		return trailContract(txCtx, c.intake.store, organizationID, 0, record, ActionDiscard, map[string]any{
			"version_id": waiting.ID.Int64(), "version_number": waiting.Number, "status": carecontract.VersionOvertaken,
			"reason": "change_taken_back",
		})
	})
	return err
}

// waitingStep is what a new waiting version does to the one that waits
// already: it overtakes it. The timeline stays as it is.
func waitingStep(contract AmendableContract) VersionStep {
	if contract.Waiting == nil {
		return VersionStep{}
	}
	return VersionStep{Overtake: contract.Waiting.ID.Int64(), Status: carecontract.VersionRequested}
}

func overtakenID(step VersionStep) any {
	if step.Overtake == 0 {
		return nil
	}
	return step.Overtake
}

// timelineStep is what the new version does to the timeline: it replaces the
// version starting on its day (rule 3), supersedes the wirksam version as
// the newest (rule 2), or, before a planned version, changes nothing (rule
// 4).
func timelineStep(contract AmendableContract, plan amendmentPlan) VersionStep {
	switch {
	case plan.replace != nil:
		return VersionStep{Replace: plan.replace.ID.Int64(), Status: plan.replace.Status}
	case plan.version.Status == carecontract.VersionEffective:
		return VersionStep{Supersede: contract.Latest.ID.Int64(), Status: carecontract.VersionEffective}
	}
	return VersionStep{}
}

func replacedID(plan amendmentPlan) any {
	if plan.replace == nil {
		return nil
	}
	return plan.replace.ID
}

// lockedTimeline takes the row lock of the contract, the same lock the
// conclusion takes (#4680), and tells whether the contract is still active,
// still follows the application child whose bookings the version was
// planned from, and has the timeline it was planned on. A contract that
// ended or got another version meanwhile is left for the next run. So is an
// imported contract the office took off its application child since the
// read (UnbindApplication, ADR 0309), or bound to another one: it no longer
// follows the bookings that were read, and the binding and its way back
// take this row lock too.
//
// The application child alone does not show a contract that was unbound and
// bound again to the same child in between: the school may have changed the
// bookings before the second binding proved them, and the version planned
// from the first read would bring the old ones back. So the row must also be
// unwritten since the read: its stamp (updated_at, set by the trigger of the
// table on every update, the binding and its way back included) is the one
// AmendableContracts read. Any other write of the row in between leaves the
// contract for the next run as well.
//
// The timeline counts the version that waits for a signature too (#4816):
// a signature or another run that changed it since the read leaves the
// contract for the next run, so no second version comes to wait.
func (c *Conclusions) lockedTimeline(ctx context.Context, organizationID int64, contract AmendableContract) (ContractRecord, bool, error) {
	record, err := c.intake.store.Contract(ctx, organizationID, contract.ID, true)
	if err != nil || record.Summary.Status != carecontract.StatusActive ||
		record.RequestChildID == nil || *record.RequestChildID != contract.Key.RequestChildID ||
		!record.UpdatedAt.Equal(contract.UpdatedAt) {
		return record, false, err
	}
	versions, err := c.intake.store.Versions(ctx, organizationID, contract.ID)
	if err != nil {
		return record, false, err
	}
	planned := contract.Versions
	if contract.Waiting != nil {
		planned = append(slices.Clone(planned), *contract.Waiting)
	}
	return record, sameTimeline(versions, planned), nil
}

func sameTimeline(all, planned []carecontract.Version) bool {
	effective := []string{}
	for _, version := range all {
		if version.Status == carecontract.VersionEffective || version.Status == carecontract.VersionSuperseded ||
			version.Status == carecontract.VersionRequested {
			effective = append(effective, fmt.Sprint(version.ID, version.Status))
		}
	}
	want := make([]string, len(planned))
	for i, version := range planned {
		want[i] = fmt.Sprint(version.ID, version.Status)
	}
	slices.Sort(effective)
	slices.Sort(want)
	return slices.Equal(effective, want)
}

func findApplication(applications []carecontract.Application, requestChildID int64) (carecontract.Application, bool) {
	for _, application := range applications {
		if application.RequestChildID == requestChildID {
			return application, true
		}
	}
	return carecontract.Application{}, false
}
