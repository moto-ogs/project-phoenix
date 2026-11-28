package owners

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	timetablePorts "github.com/moto-ogs/project-phoenix/modules/timetable/ports"
)

// parentGroupActivityReads is the Timetable read the group threads name their
// AGs through.
type parentGroupActivityReads interface {
	ListGroups(context.Context, timetable.GroupFilter) ([]timetable.Group, error)
}

// NewParentGroupTargetNames binds the read-time names of the group threads
// (#8207): a group from School Structure, an AG from the Timetable. Both
// reads run in the caller's school transaction and see only its rows.
func NewParentGroupTargetNames(groups timetableGroupLookup, activities parentGroupActivityReads) communication.ParentGroupTargetNames {
	return parentGroupTargetNames{groups: TimetableEducationGroupNames(groups), activities: activities}
}

type parentGroupTargetNames struct {
	groups     timetablePorts.EducationGroupNames
	activities parentGroupActivityReads
}

// GroupTargetNames names the given groups and AGs, one read per kind.
func (n parentGroupTargetNames) GroupTargetNames(ctx context.Context, groupIDs, activityGroupIDs []int64) (map[int64]string, map[int64]string, error) {
	groups, activities := map[int64]string{}, map[int64]string{}
	if len(groupIDs) > 0 {
		names, err := n.groups.EducationGroupNames(ctx, groupIDs)
		if err != nil {
			return nil, nil, err
		}
		groups = names
	}
	if len(activityGroupIDs) > 0 {
		rows, err := n.activities.ListGroups(ctx, timetable.GroupFilter{IDs: activityGroupIDs})
		if err != nil {
			return nil, nil, err
		}
		for _, row := range rows {
			activities[row.ID] = row.Name
		}
	}
	return groups, activities, nil
}
