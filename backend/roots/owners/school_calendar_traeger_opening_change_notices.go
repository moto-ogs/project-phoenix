package owners

import (
	"context"
	"log/slog"

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
	tenant.RegisterUnitOfWorkOutcomeCallback(ctx, func(ctx context.Context, outcome tenant.UnitOfWorkResult) {
		n.retract(ctx, schoolID, retraction, outcome)
	})
	return nil
}

// retract writes the retraction after a Träger transaction that ended with
// outcome and did not commit.
func (n traegerOpeningChangeNotices) retract(ctx context.Context, schoolID int64, retraction schoolcalendar.OpeningChangeNotice, outcome tenant.UnitOfWorkResult) {
	if outcome == tenant.UnitOfWorkCommitUnknown {
		// The change may stand: the notice stays, and the doubt is logged.
		n.logger.ErrorContext(ctx, "school calendar: Träger opening change commit unknown, notice kept",
			slog.Int64("school_id", schoolID),
			slog.Int64("opening_change_id", retraction.OpeningChangeID))
		return
	}
	n.notify(ctx, schoolID, retraction, slog.LevelError, "school calendar: Träger opening change retraction failed")
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
