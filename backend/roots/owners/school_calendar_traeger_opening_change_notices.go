package owners

import (
	"context"
	"log/slog"
	"sync"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewTraegerOpeningChangeNotices binds School Calendar's notice about an
// opening change of the Träger (#8231) to Delivery: each named school gets
// the notice of a change it entered itself (#8178), written in a school
// transaction of that school, so its staff, its families and the members of
// its Träger read it under the school's own switch. The Träger request holds
// no school; the unit opens on its own, as the holiday closures do, and
// commits before the Träger transaction. A school's notice that fails is
// logged and leaves the Träger's write standing. Should the Träger
// transaction not commit, each school whose notice committed is told the
// retraction in a school transaction of its own: the request's context
// carries the pending retractions and the transaction's outcome
// (WithTraegerOpeningChangeRetractions), and a retraction that fails is
// logged. actor
// names the account of the request, which is left out. Without Delivery's
// notifications it is nil, and School Calendar tells nobody.
func NewTraegerOpeningChangeNotices(notifications DeliveryNotifications, actor func(context.Context) int64, logger *slog.Logger) traegercalendar.OpeningChangeNotices {
	school := NewSchoolCalendarOpeningChangeNotices(notifications, actor)
	if school == nil {
		return nil
	}
	if logger == nil {
		logger = slog.Default()
	}
	return traegerOpeningChangeNotices{school: school, logger: logger.With("component", "traeger_opening_change_notices")}
}

type traegerOpeningChangeNotices struct {
	school schoolcalendar.OpeningChangeNotices
	logger *slog.Logger
}

func (n traegerOpeningChangeNotices) NotifySchool(ctx context.Context, schoolID int64, notice, retraction schoolcalendar.OpeningChangeNotice) error {
	if !n.notify(ctx, schoolID, notice, slog.LevelWarn, "school calendar: Träger opening change notice failed") {
		return nil
	}
	if retractions, ok := ctx.Value(traegerOpeningChangeRetractionsKey{}).(*traegerOpeningChangeRetractions); ok {
		retractions.add(traegerOpeningChangeRetraction{notices: n, schoolID: schoolID, retraction: retraction})
	}
	return nil
}

// traegerOpeningChangeRetraction is the retraction of one school's notice.
type traegerOpeningChangeRetraction struct {
	notices    traegerOpeningChangeNotices
	schoolID   int64
	retraction schoolcalendar.OpeningChangeNotice
}

// tell writes the retraction after a Träger transaction that ended with
// outcome and did not commit.
func (r traegerOpeningChangeRetraction) tell(ctx context.Context, outcome tenant.UnitOfWorkResult) {
	if outcome == tenant.UnitOfWorkCommitUnknown {
		// The change may stand: the notice stays, and the doubt is logged.
		r.notices.logger.ErrorContext(ctx, "school calendar: Träger opening change commit unknown, notice kept",
			slog.Int64("school_id", r.schoolID),
			slog.Int64("opening_change_id", r.retraction.OpeningChangeID))
		return
	}
	r.notices.notify(ctx, r.schoolID, r.retraction, slog.LevelError, "school calendar: Träger opening change retraction failed")
}

// notify writes notice in a school transaction of schoolID and reports
// whether it committed; a failure is logged without personal data.
func (n traegerOpeningChangeNotices) notify(ctx context.Context, schoolID int64, notice schoolcalendar.OpeningChangeNotice, level slog.Level, failure string) bool {
	id, err := tenant.NewTenantID(schoolID)
	if err == nil {
		err = tenant.WithinTenant(tenant.ContextWithoutTransaction(ctx), id, func(ctx context.Context) error {
			return n.school.NotifyOpeningChangeChanged(ctx, notice)
		})
	}
	if err != nil {
		n.logger.Log(ctx, level, failure,
			slog.Int64("school_id", schoolID),
			slog.Int64("opening_change_id", notice.OpeningChangeID),
			slog.Any("error", err))
		return false
	}
	return true
}

type traegerOpeningChangeRetractionsKey struct{}

// traegerOpeningChangeRetractions holds the retractions of the notices one
// Träger request committed and the outcome of its Träger transaction.
type traegerOpeningChangeRetractions struct {
	mu      sync.Mutex
	pending []traegerOpeningChangeRetraction
	// handled is set when the handler returns inside the Träger transaction;
	// the first transaction to finish after it is that transaction.
	handled, decided bool
	outcome          tenant.UnitOfWorkResult
}

func (r *traegerOpeningChangeRetractions) add(retract traegerOpeningChangeRetraction) {
	r.mu.Lock()
	r.pending = append(r.pending, retract)
	r.mu.Unlock()
}

// observe keeps the outcome of the Träger transaction: the school
// transactions of the notices finish while the handler runs, the
// transactions of after-commit hooks after the Träger transaction.
func (r *traegerOpeningChangeRetractions) observe(event tenant.UnitOfWorkEvent) {
	if event.Kind != tenant.UnitOfWorkTransaction {
		return
	}
	r.mu.Lock()
	if r.handled && !r.decided {
		r.outcome, r.decided = event.Result, true
	}
	r.mu.Unlock()
}

// WithTraegerOpeningChangeRetractions prepares ctx, the context of a Träger
// request before its Träger transaction opens, for the retractions of
// NewTraegerOpeningChangeNotices (#8231). The handler's return inside that
// transaction is marked with TraegerOpeningChangeHandled; settle runs once
// the transaction has ended: unless it committed, it tells each school the
// retraction of its notice, once, without retry. A commit of unknown outcome
// keeps the notices and is logged.
func WithTraegerOpeningChangeRetractions(ctx context.Context) (prepared context.Context, settle func(context.Context)) {
	retractions := &traegerOpeningChangeRetractions{}
	prepared = context.WithValue(tenant.WithAdditionalUnitOfWorkObserver(ctx, retractions.observe), traegerOpeningChangeRetractionsKey{}, retractions)
	return prepared, func(ctx context.Context) {
		retractions.mu.Lock()
		pending, outcome := retractions.pending, retractions.outcome
		retractions.pending = nil
		retractions.mu.Unlock()
		if outcome == tenant.UnitOfWorkCommitted {
			return
		}
		for _, retract := range pending {
			retract.tell(ctx, outcome)
		}
	}
}

// TraegerOpeningChangeHandled marks that the handler of a request prepared
// by WithTraegerOpeningChangeRetractions returned inside its Träger
// transaction; the next transaction to finish is that transaction.
func TraegerOpeningChangeHandled(ctx context.Context) {
	if retractions, ok := ctx.Value(traegerOpeningChangeRetractionsKey{}).(*traegerOpeningChangeRetractions); ok {
		retractions.mu.Lock()
		retractions.handled = true
		retractions.mu.Unlock()
	}
}
