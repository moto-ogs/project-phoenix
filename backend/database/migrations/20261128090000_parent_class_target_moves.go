package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const parentClassTargetMovesVersion = "20261128090000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     parentClassTargetMovesVersion,
		Description: "Klassen-Nachrichten an Eltern und Mitteilungs-Entwürfe folgen dem Schuljahreswechsel (#8214)",
		DependsOn:   []string{parentGroupThreadsVersion, parentAnnouncementsVersion},
	})
	Migrations.MustRegister(parentClassTargetMovesUp, parentClassTargetMovesDown)
}

// Each column is the stack of school-year changes that moved the row, newest
// last: a revert pops the entry of its own transition and puts the row back
// exactly as the entry recorded it. Reverts unwind in strict reverse order
// (gradetransition.ErrNotLatestApplied), so the newest entry is always the
// one to undo.
const parentClassTargetMovesUpSQL = `
ALTER TABLE users.parent_group_threads
 ADD COLUMN class_moves JSONB NOT NULL DEFAULT '[]'::jsonb
  CONSTRAINT chk_parent_group_threads_class_moves CHECK (jsonb_typeof(class_moves) = 'array');
COMMENT ON COLUMN users.parent_group_threads.class_moves IS
 'School-year changes that moved this class thread, newest last: {transition_id, from_class, to_class}; to_class null = the class left and the change closed the thread (#8214).';
ALTER TABLE users.parent_announcements
 ADD COLUMN class_target_moves JSONB NOT NULL DEFAULT '[]'::jsonb
  CONSTRAINT chk_parent_announcements_class_target_moves CHECK (jsonb_typeof(class_target_moves) = 'array');
COMMENT ON COLUMN users.parent_announcements.class_target_moves IS
 'School-year changes that moved the class targets of this draft, newest last: {transition_id, targets: [{target_id, from_class, to_class}]}; to_class null = the target was removed (#8214).';
`

const parentClassTargetMovesDownSQL = `
ALTER TABLE users.parent_announcements DROP COLUMN class_target_moves;
ALTER TABLE users.parent_group_threads DROP COLUMN class_moves;
`

func parentClassTargetMovesUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, parentClassTargetMovesUpSQL); err != nil {
		return fmt.Errorf("add parent class target moves: %w", err)
	}
	return nil
}

func parentClassTargetMovesDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, parentClassTargetMovesDownSQL); err != nil {
		return fmt.Errorf("drop parent class target moves: %w", err)
	}
	return nil
}
