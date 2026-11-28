package owners

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/workflows/gradetransition"
)

// GradeTransitionParentTargets binds the grade transition's parent-channel
// port to Communication's class transitions (#8214), translating the
// workflow's values into Communication's.
func GradeTransitionParentTargets(transitions communication.ParentClassTransitions) gradetransition.ParentClassTargets {
	return gradetransition.ParentClassTargets{
		List: func(ctx context.Context, classes []string) ([]gradetransition.ParentClassTarget, error) {
			rows, err := transitions.ListParentClassTargets(ctx, classes)
			if err != nil {
				return nil, err
			}
			out := make([]gradetransition.ParentClassTarget, 0, len(rows))
			for _, row := range rows {
				out = append(out, gradetransition.ParentClassTarget{Kind: row.Kind, ID: row.ID, Title: row.Title, Class: row.Class})
			}
			return out, nil
		},
		Follow: func(ctx context.Context, transitionID int64, actor gradetransition.Actor, at time.Time, renames []gradetransition.ClassRename) error {
			mapped := make([]communication.ParentClassRename, 0, len(renames))
			for _, rename := range renames {
				mapped = append(mapped, communication.ParentClassRename{FromClass: rename.FromClass, ToClass: rename.ToClass})
			}
			return transitions.FollowParentClassRenames(ctx, transitionID, actor.AccountID, at, mapped)
		},
		Revert: transitions.RevertParentClassRenames,
	}
}
