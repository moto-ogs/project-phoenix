package application

import (
	"context"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// A write of a Träger opening change tells every school it names, or named
// before, with the notice of a school's own change (#8231): a school added
// reads it as new, a school removed as deleted, a school that stays as
// changed. The rules of openingChangeNotice decide per school, so a write
// that keeps the days and times of a school tells it nothing.

// NewNoticedTraegerOpeningChanges builds the Träger's opening changes over
// store and tells each named school through notices; today names the day
// (YYYY-MM-DD) the push window counts from. Without notices they tell nobody.
func NewNoticedTraegerOpeningChanges(store TraegerOpeningChangeStore, schools traegercalendar.Schools,
	notices traegercalendar.OpeningChangeNotices, today func() string,
) *TraegerOpeningChanges {
	changes := NewTraegerOpeningChanges(store, schools)
	if notices == nil {
		return changes
	}
	if today == nil {
		panic("school calendar: the day of the Träger opening change notices is required")
	}
	changes.notices, changes.today = notices, today
	return changes
}

// notify tells every school of previous and current of the write; previous
// is nil for a new change and current nil for a deleted one.
func (t *TraegerOpeningChanges) notify(ctx context.Context, id int64, previous *domain.TraegerOpeningChange, current *traegercalendar.OpeningChange) error {
	if t.notices == nil {
		return nil
	}
	var before, after []int64
	if previous != nil {
		before = previous.SchoolIDs
	}
	if current != nil {
		after = ident.Int64s(current.SchoolIDs)
	}
	today := t.today()
	for _, schoolID := range affectedSchoolIDs(before, after) {
		var was, is *schoolcalendar.OpeningChangeSpan
		var reason string
		if slices.Contains(before, schoolID) {
			was = &schoolcalendar.OpeningChangeSpan{StartsOn: previous.StartDate, EndsOn: previous.EndDate, OpensAt: previous.OpensAt, ClosesAt: previous.ClosesAt}
			reason = previous.Reason
		}
		if slices.Contains(after, schoolID) {
			is = &schoolcalendar.OpeningChangeSpan{StartsOn: current.StartDate, EndsOn: current.EndDate, OpensAt: current.OpensAt, ClosesAt: current.ClosesAt}
			reason = current.Reason
		}
		notice, ok := openingChangeNotice(today, id, reason, was, is)
		if !ok {
			continue
		}
		notice.Traeger = true
		if err := t.notices.NotifySchool(ctx, schoolID, notice); err != nil {
			return notifyOpeningChangeError(err)
		}
	}
	return nil
}
