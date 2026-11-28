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
func LabelParentGroupThreads(ctx context.Context, names ParentGroupTargetNames, threads ...*ParentGroupThread) error {
	var groupIDs, activityIDs []int64
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
	var groups, activities map[int64]string
	if names != nil && len(groupIDs)+len(activityIDs) > 0 {
		var err error
		if groups, activities, err = names.GroupTargetNames(ctx, groupIDs, activityIDs); err != nil {
			return fmt.Errorf("messaging: group thread target names: %w", err)
		}
	}
	for _, thread := range threads {
		if thread != nil {
			thread.Target.Label = currentGroupTargetLabel(thread.Target, groups, activities)
		}
	}
	return nil
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
