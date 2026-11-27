package daychangesview

import (
	"context"
	"log/slog"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// ChildFilter is the one child whose day the parents portal reads (#7671).
// The caller resolved the child through the guardian's relationship
// permission (parent_portal.access) and runs the read in the child's school.
// AccountID is the guardian's account: an entry it wrote itself is marked
// EnteredByYou.
type ChildFilter struct {
	StudentID ident.ID
	AccountID int64
}

// ChildChangeSource is a source of the child's day: what is different today
// for this child, without the name of a staff member and without the
// school's free texts. The source filters on the child; the projection
// never filters (ADR 0299 point 4).
type ChildChangeSource interface {
	ChildDayChanges(ctx context.Context, day calendar.Date, child ChildFilter) ([]SourceEntry, error)
}

// ChildDependencies are the ports of the child's day. Today, Isolation and
// every source are required; Logger is optional. A sister ticket adds its
// source here and in childSources.
type ChildDependencies struct {
	Today     func() calendar.Date
	Isolation Isolation
	// Children is Kinder: sick or excused, changed pickup time, goes home
	// alone, the child's class trip.
	Children ChildChangeSource
	// Activities is Stundenplan: the child's cancelled, reinstated, moved
	// and covered blocks.
	Activities ChildChangeSource
	// Classes is the Unterrichtsschluss of the child's class.
	Classes ChildChangeSource
	// Closing is the closing days of the child's school.
	Closing ChildChangeSource
	// Meals is Essen: lunch cancelled on a day the child is booked (#8160).
	Meals  ChildChangeSource
	Logger *slog.Logger
}

// ChildQuery reads the day of one child: today, or on a day that must be
// today or tomorrow of the school (#8236, day.go).
type ChildQuery interface {
	ChildDay(ctx context.Context, child ChildFilter) (Overview, error)
	ChildDayOn(ctx context.Context, day calendar.Date, child ChildFilter) (Overview, error)
}

type childView struct {
	deps   ChildDependencies
	logger *slog.Logger
}

// NewChild builds the child's day of the projection.
func NewChild(deps ChildDependencies) (ChildQuery, error) {
	if deps.Today == nil || deps.Isolation == nil || deps.Children == nil || deps.Activities == nil || deps.Classes == nil || deps.Closing == nil || deps.Meals == nil {
		return nil, ErrDependencies
	}
	logger := deps.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &childView{deps: deps, logger: logger}, nil
}

// ChildDay reads every source for the child, with the same isolation,
// partial failure and order as the staff overview.
func (v *childView) ChildDay(ctx context.Context, child ChildFilter) (Overview, error) {
	return v.read(child).Today(ctx)
}

// ChildDayOn reads the child's day on day with the same rules as today;
// a day other than today or tomorrow is ErrDayOutOfRange (#8236).
func (v *childView) ChildDayOn(ctx context.Context, day calendar.Date, child ChildFilter) (Overview, error) {
	return v.read(child).On(ctx, day)
}

// read binds every source of the child's day to the child.
func (v *childView) read(child ChildFilter) *view {
	bind := func(source ChildChangeSource) func(context.Context, calendar.Date) ([]SourceEntry, error) {
		return func(ctx context.Context, day calendar.Date) ([]SourceEntry, error) {
			return source.ChildDayChanges(ctx, day, child)
		}
	}
	return &view{
		today: v.deps.Today, isolation: v.deps.Isolation, logger: v.logger,
		sources: []sourceRead{
			{source: SourceChildren, read: bind(v.deps.Children)},
			{source: SourceClosingDays, read: bind(v.deps.Closing)},
			{source: SourceActivities, read: bind(v.deps.Activities)},
			{source: SourceClasses, read: bind(v.deps.Classes)},
			{source: SourceMealPlan, read: bind(v.deps.Meals)},
		},
	}
}
