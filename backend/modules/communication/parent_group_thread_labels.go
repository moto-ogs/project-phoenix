package communication

import (
	"context"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/sharedkernel/collation"
)

// LabelParentGroupThreads replaces each thread's stored target label with the
// name its target carries now (#8207): a renamed group or AG shows its new
// name, a class thread names the class it writes to. A group or AG that is
// gone, or that the caller's school does not hold, keeps the label the thread
// was opened with. One name lookup for all threads; without names every
// group and AG thread keeps its stored label.
//
// A group or AG the lookup no longer finds was deleted (both are deleted for
// good, ids are not reused): its thread reads closed with the reason
// ParentGroupThreadClosedGroupDeleted (#8213). The thread follows its target
// at read time, so every deletion path closes it in its own transaction.
func LabelParentGroupThreads(ctx context.Context, names ParentGroupTargetNames, threads ...*ParentGroupThread) error {
	groupIDs, activityIDs := groupTargetIDs(threads)
	if names == nil || len(groupIDs)+len(activityIDs) == 0 {
		for _, thread := range threads {
			if thread != nil {
				thread.Target.Label = currentGroupTargetLabel(thread.Target, nil, nil)
			}
		}
		return nil
	}
	groups, activities, err := names.GroupTargetNames(ctx, groupIDs, activityIDs)
	if err != nil {
		return fmt.Errorf("messaging: group thread target names: %w", err)
	}
	for _, thread := range threads {
		if thread == nil {
			continue
		}
		thread.Target.Label = currentGroupTargetLabel(thread.Target, groups, activities)
		if groupTargetGone(thread.Target, groups, activities) {
			thread.ClosedReason = ParentGroupThreadClosedGroupDeleted
		}
	}
	return nil
}

// groupTargetIDs collects the group and AG ids the threads write to.
func groupTargetIDs(threads []*ParentGroupThread) (groupIDs, activityIDs []int64) {
	for _, thread := range threads {
		if thread == nil || thread.Target.RefID == nil {
			continue
		}
		switch thread.Target.Type {
		case ParentGroupTargetGroup:
			groupIDs = append(groupIDs, *thread.Target.RefID)
		case ParentGroupTargetActivityGroup:
			activityIDs = append(activityIDs, *thread.Target.RefID)
		}
	}
	return groupIDs, activityIDs
}

// groupTargetGone reports whether the lookup no longer found the group or AG
// of a thread. A class thread has no row to lose.
func groupTargetGone(target ParentGroupTarget, groups, activities map[int64]string) bool {
	if target.RefID == nil {
		return false
	}
	switch target.Type {
	case ParentGroupTargetGroup:
		_, found := groups[*target.RefID]
		return !found
	case ParentGroupTargetActivityGroup:
		_, found := activities[*target.RefID]
		return !found
	}
	return false
}

func currentGroupTargetLabel(target ParentGroupTarget, groups, activities map[int64]string) string {
	switch target.Type {
	case ParentGroupTargetClass:
		if target.RefText != nil {
			if label := collation.SchoolClassLabel(*target.RefText); label != "" {
				return label
			}
		}
	case ParentGroupTargetGroup:
		if name := currentTargetName(target.RefID, groups); name != "" {
			return "Gruppe " + name
		}
	case ParentGroupTargetActivityGroup:
		if name := currentTargetName(target.RefID, activities); name != "" {
			return "AG " + name
		}
	}
	return target.Label
}

func currentTargetName(id *int64, names map[int64]string) string {
	if id == nil {
		return ""
	}
	return strings.TrimSpace(names[*id])
}
