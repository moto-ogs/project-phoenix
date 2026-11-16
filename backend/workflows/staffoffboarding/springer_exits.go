package staffoffboarding

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The end of a Springer's employment after the last block (#7197, ADR
// 0089 section 8, ADR 0252). The first block of a Springer at a school
// creates an employment there (ADR 0251). Once the school's last block is
// over, the scheduler offboards that employment through the same path as
// the immediate and the planned exit, so it becomes a former employment.
// The next block resumes it (ADR 0021).

// SpringerExit is an employment the pool created whose last block at the
// school is over. The exit acts in the name of ActorAccountID with the
// employment ActorStaffID at the school: the most recent blocking Leitung
// who still works there.
type SpringerExit struct {
	TenantID       int64
	RecordID       int64
	StaffID        int64
	LastBlockDay   calendar.Date
	ActorAccountID int64
	ActorStaffID   int64
}

// SpringerExitPorts are the owners the Springer exits need beyond the
// offboarding. Due lists the exits of the school in ctx; Lock locks one
// record as a block of it does and reads its exit again (due is false once
// a new block keeps it); Record writes the end into the record's trail.
// HoldsOnlySpringerAccess reports whether the account's roles at the school
// are only the ones the pool gave it; PruneWindows deletes ended windows.
type SpringerExitPorts struct {
	Due                     func(context.Context, calendar.Date) ([]SpringerExit, error)
	Lock                    func(context.Context, int64, calendar.Date) (SpringerExit, bool, error)
	Record                  func(context.Context, SpringerExit) error
	HoldsOnlySpringerAccess func(context.Context, int64) (bool, error)
	PruneWindows            func(context.Context) error
}

// Outcome of a Springer exit that found nothing to end: a new block keeps
// the employment, the school gave the account a role of its own, or the
// account has no other school and would be deactivated.
const ExitKept = "kept"

// ErrSpringerExitWithoutActor defers an exit no blocking Leitung of the
// school can act for any more. The employment stays; without a window it
// admits no one (ADR 0251 point 6).
var ErrSpringerExitWithoutActor = errors.New("staff offboarding: no Leitung of the school can act for the Springer exit")

// SpringerExits ends the employments of Springer after their last block.
// It runs each exit like a planned exit: in a transaction of its own, with
// bounded lock waits, through the offboarding's one execution path.
type SpringerExits struct {
	due   *DueExits
	ports SpringerExitPorts
}

func NewSpringerExits(due *DueExits, ports SpringerExitPorts) (*SpringerExits, error) {
	if due == nil || ports.Due == nil || ports.Lock == nil || ports.Record == nil || ports.HoldsOnlySpringerAccess == nil || ports.PruneWindows == nil {
		return nil, errors.New("staff offboarding springer exits: all dependencies are required")
	}
	return &SpringerExits{due: due, ports: ports}, nil
}

// RunDue deletes the ended windows of the school in ctx and ends every
// Springer employment whose last block is over. A failing exit neither
// blocks the others nor undoes their work.
func (s *SpringerExits) RunDue(ctx context.Context) (DueRun, error) {
	var run DueRun
	today, err := s.due.planner.today()
	if err != nil {
		return run, err
	}
	failed, err := s.due.deps.Within(ctx, s.ports.PruneWindows)
	if err != nil {
		return run, fmt.Errorf("prune springer windows: %w", err)
	}
	if failed != nil {
		// Ended windows admit no one; the next run prunes them.
		s.due.deps.Logger.Warn("springer windows not pruned",
			"error", failed,
		)
	}
	exits, err := s.ports.Due(ctx, today)
	if err != nil {
		return run, err
	}
	for _, exit := range exits {
		result, err := s.runUnit(ctx, exit, today)
		s.logResult(exit, result)
		run.Exits = append(run.Exits, result)
		if err != nil {
			return run, fmt.Errorf("springer exit of staff %d: %w", exit.StaffID, err)
		}
	}
	return run, nil
}

// runUnit ends one employment in its own transaction. err aborts the run.
func (s *SpringerExits) runUnit(ctx context.Context, listed SpringerExit, today calendar.Date) (DueExitResult, error) {
	result := DueExitResult{StaffID: listed.StaffID, Outcome: ExitSucceeded}
	var (
		exitErr error
		kept    bool
	)
	failed, err := s.due.deps.Within(ctx, func(txCtx context.Context) error {
		exitErr, kept = nil, false
		return s.due.deps.BoundLockWaits(txCtx, func(lockCtx context.Context) error {
			var err error
			kept, exitErr, err = s.end(lockCtx, listed.RecordID, today)
			return err
		})
	})
	switch {
	case err != nil:
		result.Outcome, result.Err = ExitAborted, err
		return result, err
	case errors.Is(failed, ErrExitLocked):
		result.Outcome, result.Err = ExitDeferred, failed
	case failed != nil:
		result.Outcome, result.Err = ExitFailed, failed
	case exitErr != nil:
		result.Outcome, result.Err = ExitDeferred, exitErr
	case kept:
		result.Outcome = ExitKept
	}
	return result, nil
}

// end takes the exit's locks in the order of a block and an offboarding
// (record, then Konto → Schule → Profil), decides again on the locked state
// and offboards. exitErr is an exit that waits: one blocked by a
// supervision (ErrInUse) or without an actor. err rolls the unit back.
func (s *SpringerExits) end(ctx context.Context, recordID int64, today calendar.Date) (kept bool, exitErr, err error) {
	exit, due, err := s.ports.Lock(ctx, recordID, today)
	if err != nil || !due {
		return !due, nil, err
	}
	if exit.ActorAccountID <= 0 || exit.ActorStaffID <= 0 {
		return false, ErrSpringerExitWithoutActor, nil
	}
	accounts, err := s.due.lockAccounts(ctx, exit.StaffID)
	if err != nil {
		return false, nil, err
	}
	if err := s.due.planner.workflow.deps.Workforce.Lock(ctx, exit.StaffID); err != nil {
		return false, nil, err
	}
	if keep, err := s.keepsAccess(ctx, accounts); err != nil || keep {
		return keep, nil, err
	}
	result, err := s.due.planner.workflow.executeAs(ctx, "springer_exit", exit.StaffID, "", springerActor(exit))
	if errors.Is(err, ErrInUse) {
		return false, err, nil
	}
	if err != nil || result.StaffID == 0 {
		return false, nil, err
	}
	return false, nil, s.ports.Record(ctx, exit)
}

// keepsAccess reports whether the exit must leave the employment: the
// school gave the account a role of its own, or the exit would deactivate
// the account because it has no other school. The pool contract still
// runs, so the next block must find a working account (ADR 0252).
func (s *SpringerExits) keepsAccess(ctx context.Context, accounts []int64) (bool, error) {
	for _, account := range accounts {
		only, err := s.ports.HoldsOnlySpringerAccess(ctx, account)
		if err != nil || !only {
			return !only, err
		}
		access, err := s.due.planner.workflow.deps.PreviewAccess(ctx, account)
		if err != nil || access.DeactivateAccount {
			return access.DeactivateAccount, err
		}
	}
	return false, nil
}

// springerActor is the Leitung whose last block ended the employment.
func springerActor(exit SpringerExit) func(context.Context) (Actor, error) {
	actor := Actor{
		TenantID: exit.TenantID, AccountID: exit.ActorAccountID, StaffID: exit.ActorStaffID,
		SpringerLastBlockDay: &exit.LastBlockDay,
	}
	return func(context.Context) (Actor, error) { return actor, nil }
}

// logResult writes the one result line of an exit, by IDs only.
func (s *SpringerExits) logResult(exit SpringerExit, result DueExitResult) {
	level := slog.LevelInfo
	switch result.Outcome {
	case ExitKept:
		level = slog.LevelDebug
	case ExitDeferred:
		level = slog.LevelWarn
	case ExitFailed, ExitAborted:
		level = slog.LevelError
	}
	attrs := []slog.Attr{
		slog.Int64("tenant_id", exit.TenantID),
		slog.Int64("staff_id", exit.StaffID),
		slog.Int64("staff_record_id", exit.RecordID),
		slog.String("outcome", result.Outcome),
	}
	if result.Err != nil {
		attrs = append(attrs, slog.String("error", result.Err.Error()))
	}
	s.due.deps.Logger.LogAttrs(context.Background(), level, "springer employment exit", attrs...)
}
