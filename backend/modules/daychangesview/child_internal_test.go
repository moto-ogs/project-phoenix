package daychangesview

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// childSourceFunc lets a function serve as a ChildChangeSource.
type childSourceFunc func(context.Context, calendar.Date, ChildFilter) ([]SourceEntry, error)

func (f childSourceFunc) ChildDayChanges(ctx context.Context, day calendar.Date, child ChildFilter) ([]SourceEntry, error) {
	return f(ctx, day, child)
}

// TestChildDayKeepsOtherSourcesWhenOneFails is Seam 2 of the child's day
// (#7671): every source gets the child, a failed source is marked failed
// and the others still answer, with the guardian's own entry marked.
func TestChildDayKeepsOtherSourcesWhenOneFails(t *testing.T) {
	t.Parallel()
	day := calendar.NewDate(2026, 9, 9)
	child := ChildFilter{StudentID: ident.ID(42), AccountID: 7}
	seen := []ChildFilter{}
	source := func(entries ...SourceEntry) ChildChangeSource {
		return childSourceFunc(func(_ context.Context, got calendar.Date, filter ChildFilter) ([]SourceEntry, error) {
			assert.Equal(t, day, got)
			seen = append(seen, filter)
			return entries, nil
		})
	}
	failing := childSourceFunc(func(context.Context, calendar.Date, ChildFilter) ([]SourceEntry, error) {
		return nil, errors.New("relation does not exist")
	})
	query, err := NewChild(ChildDependencies{
		Today: func() calendar.Date { return day }, Isolation: fakeIsolation{},
		Children:   source(SourceEntry{Kind: KindChildAbsent, Involved: true, EnteredByYou: true}),
		Closing:    source(SourceEntry{Kind: KindClosingDay, Involved: true, Closing: &DayClosing{Name: "Pädagogischer Tag"}}),
		Activities: failing,
		Classes:    source(),
	})
	require.NoError(t, err)

	overview, err := query.ChildDay(context.Background(), child)
	require.NoError(t, err)
	assert.Equal(t, []SourceStatus{
		{Source: SourceChildren, Status: SourceLoaded},
		{Source: SourceClosingDays, Status: SourceLoaded},
		{Source: SourceActivities, Status: SourceFailed},
		{Source: SourceClasses, Status: SourceLoaded},
	}, overview.Sources)
	assert.Equal(t, []ChildFilter{child, child, child}, seen, "every source reads the one child")
	require.Len(t, overview.Entries, 2)
	assert.Equal(t, KindClosingDay, overview.Entries[0].Kind, "the closed school stands first")
	assert.True(t, overview.Entries[1].EnteredByYou)

	_, err = NewChild(ChildDependencies{Today: func() calendar.Date { return day }, Isolation: fakeIsolation{}})
	assert.ErrorIs(t, err, ErrDependencies)
}
