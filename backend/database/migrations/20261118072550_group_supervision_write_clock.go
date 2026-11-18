package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const groupSupervisionWriteClockVersion = "20261118072550"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     groupSupervisionWriteClockVersion,
		Description: "Aufsichtsänderungen beim Schreiben stempeln (#7383)",
		DependsOn:   []string{GroupSupervisorsVersion},
	})
	Migrations.MustRegister(groupSupervisionWriteClockUp, groupSupervisionWriteClockDown)
}

func groupSupervisionWriteClockUp(ctx context.Context, db *bun.DB) error {
	_, err := db.ExecContext(ctx, `
		CREATE FUNCTION active.stamp_group_supervision_update() RETURNS TRIGGER
		LANGUAGE plpgsql AS $$
		BEGIN
			NEW.updated_at := clock_timestamp();
			RETURN NEW;
		END;
		$$;

		CREATE OR REPLACE TRIGGER update_supervision_updated_at
		BEFORE UPDATE ON active.group_supervisors
		FOR EACH ROW EXECUTE FUNCTION active.stamp_group_supervision_update();
	`)
	if err != nil {
		return fmt.Errorf("stamp group supervision at write time: %w", err)
	}
	return nil
}

func groupSupervisionWriteClockDown(ctx context.Context, db *bun.DB) error {
	_, err := db.ExecContext(ctx, `
		CREATE OR REPLACE TRIGGER update_supervision_updated_at
		BEFORE UPDATE ON active.group_supervisors
		FOR EACH ROW EXECUTE FUNCTION update_modified_column();

		DROP FUNCTION active.stamp_group_supervision_update();
	`)
	if err != nil {
		return fmt.Errorf("restore the previous group supervision trigger: %w", err)
	}
	return nil
}
