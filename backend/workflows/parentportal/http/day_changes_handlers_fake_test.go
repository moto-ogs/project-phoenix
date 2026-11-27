package parent

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"

	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// GetChildDayChanges completes the handler fake; the route's behaviour is
// proven against the database in api/day_changes_child_test.go (#7671).
func (f *fakeParentService) GetChildDayChanges(context.Context, int64, int64, *calendar.Date) (parentService.ChildDay, error) {
	return parentService.ChildDay{}, nil
}
