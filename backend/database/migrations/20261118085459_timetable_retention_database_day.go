package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const timetableRetentionDatabaseDayVersion = "20261118085459"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     timetableRetentionDatabaseDayVersion,
		Description: "Stundenplan-Aufbewahrung auf den Berliner Datenbanktag beziehen (#7383)",
		DependsOn:   []string{auditRetentionCapabilitiesVersion},
	})
	Migrations.MustRegister(timetableRetentionDatabaseDayUp, timetableRetentionDatabaseDayDown)
}

func timetableRetentionDatabaseDayUp(ctx context.Context, db *bun.DB) error {
	_, err := db.ExecContext(ctx, `
		CREATE FUNCTION audit.timetable_retention_cutoff(retention_days INTEGER) RETURNS DATE
		LANGUAGE sql VOLATILE
		SET search_path = pg_catalog
		AS $$
			SELECT (clock_timestamp() AT TIME ZONE 'Europe/Berlin')::DATE - retention_days
		$$;
		REVOKE ALL ON FUNCTION audit.timetable_retention_cutoff(INTEGER) FROM PUBLIC;
		GRANT EXECUTE ON FUNCTION audit.timetable_retention_cutoff(INTEGER) TO phoenix_tenant, phoenix_admin;
	`)
	if err != nil {
		return fmt.Errorf("add the timetable retention cutoff: %w", err)
	}
	return nil
}

func timetableRetentionDatabaseDayDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, `DROP FUNCTION audit.timetable_retention_cutoff(INTEGER)`); err != nil {
		return fmt.Errorf("drop the timetable retention cutoff: %w", err)
	}
	return nil
}
