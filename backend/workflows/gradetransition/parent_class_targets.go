package gradetransition

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/schoolstructure"
)

// Kinds of parent channel a school-year change moves (#8214).
const (
	ParentTargetGroupThread       = "group_thread"
	ParentTargetAnnouncementDraft = "announcement_draft"
)

// ClassRename is one mapping as the parent channels follow it; a nil ToClass
// means the class leaves.
type ClassRename struct {
	FromClass string
	ToClass   *string
}

// ParentClassTarget is an open class thread to parents or a draft
// announcement with a class target, in one of the mapped classes.
type ParentClassTarget struct {
	Kind  string
	ID    int64
	Title string
	Class string
}

// ParentTargetPreview is what an apply does to one such target: it moves to
// ToClass, or, for a leaving class, the thread is closed and the draft loses
// the class target (ToClass nil).
type ParentTargetPreview struct {
	ParentClassTarget
	ToClass *string
}

// ParentClassTargets is the Communication port, bound by the root. The class
// threads and the class targets of draft announcements follow the children
// like the class teachers and the class lists (#8214); the revert puts back
// exactly what the apply moved.
type ParentClassTargets struct {
	List   func(ctx context.Context, classes []string) ([]ParentClassTarget, error)
	Follow func(ctx context.Context, transitionID int64, actor Actor, at time.Time, renames []ClassRename) error
	Revert func(ctx context.Context, transitionID int64) error
}

func (p ParentClassTargets) complete() bool {
	return p.List != nil && p.Follow != nil && p.Revert != nil
}

// parentTargetPreviews names every parent channel the mappings move.
func (w *Workflow) parentTargetPreviews(ctx context.Context, mappings []schoolstructure.TransitionMapping) ([]ParentTargetPreview, error) {
	targets, err := w.deps.ParentTargets.List(ctx, mappedClassNames(mappings))
	if err != nil {
		return nil, fmt.Errorf("failed to list parent class targets: %w", err)
	}
	byClass := make(map[string]*string, len(mappings))
	for _, mapping := range mappings {
		byClass[parentClassKey(mapping.FromClass)] = mapping.ToClass
	}
	out := make([]ParentTargetPreview, 0, len(targets))
	for _, target := range targets {
		to, mapped := byClass[parentClassKey(target.Class)]
		if !mapped {
			continue
		}
		out = append(out, ParentTargetPreview{ParentClassTarget: target, ToClass: to})
	}
	return out, nil
}

// followParentClassTargets moves the parent channels with the renames.
func (w *Workflow) followParentClassTargets(ctx context.Context, actor Actor, transition schoolstructure.Transition) error {
	renames := make([]ClassRename, 0, len(transition.Mappings))
	for _, mapping := range transition.Mappings {
		renames = append(renames, ClassRename{FromClass: mapping.FromClass, ToClass: mapping.ToClass})
	}
	if err := w.deps.ParentTargets.Follow(ctx, transition.ID, actor, w.deps.Now(), renames); err != nil {
		return fmt.Errorf("failed to move parent class targets: %w", err)
	}
	return nil
}

// parentClassKey matches a class the way the parent audience does.
func parentClassKey(class string) string {
	return strings.ToLower(strings.TrimSpace(class))
}
