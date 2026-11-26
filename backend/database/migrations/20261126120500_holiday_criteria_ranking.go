package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const holidayCriteriaRankingVersion = "20261126120500"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     holidayCriteriaRankingVersion,
		Description: "Ferien: Kriterien nach Reihenfolge, Anzahl oder Punkten werten (#8135)",
		DependsOn:   []string{holidayCriteriaAllocationVersion}, // the criteria and decisions it extends
	})
	Migrations.MustRegister(holidayCriteriaRankingUp, holidayCriteriaRankingDown)
}

const holidayCriteriaRankingUpSQL = `
ALTER TABLE enrollment.holiday_allocation_criteria ADD COLUMN points SMALLINT NOT NULL DEFAULT 1
 CONSTRAINT chk_holiday_allocation_criteria_points CHECK (points BETWEEN 1 AND 100);
COMMENT ON COLUMN enrollment.holiday_allocation_criteria.position IS
 'Catalog order; breaks differences criterion by criterion in priority mode.';
COMMENT ON COLUMN enrollment.holiday_allocation_criteria.points IS
 'Weight of a met criterion in points mode; other modes do not use this value.';

CREATE TABLE enrollment.holiday_allocation_rules (
 organization_id BIGINT PRIMARY KEY REFERENCES platform.organizations(id) ON DELETE CASCADE,
 criteria_ranking TEXT NOT NULL DEFAULT 'priority',
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_by_account_id BIGINT REFERENCES auth.accounts(id) ON DELETE SET NULL,
 CONSTRAINT chk_holiday_allocation_rules_ranking CHECK (criteria_ranking IN ('priority', 'equal', 'points'))
);
COMMENT ON TABLE enrollment.holiday_allocation_rules IS
 'How a Träger ranks bookings by its criteria (#8135); no row means priority.';
ALTER TABLE enrollment.holiday_allocation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment.holiday_allocation_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_enrollment_holiday_allocation_rules ON enrollment.holiday_allocation_rules FOR ALL
 USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
 WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);
REVOKE ALL ON enrollment.holiday_allocation_rules FROM PUBLIC, phoenix_tenant;
GRANT SELECT, INSERT, UPDATE ON enrollment.holiday_allocation_rules TO phoenix_tenant;

ALTER TABLE enrollment.holiday_allocation_decisions
 ADD COLUMN criteria_ranking TEXT NOT NULL DEFAULT 'priority'
  CONSTRAINT chk_holiday_allocation_decisions_ranking CHECK (criteria_ranking IN ('priority', 'equal', 'points')),
 ADD COLUMN score INTEGER,
 ADD COLUMN max_score INTEGER;
COMMENT ON COLUMN enrollment.holiday_allocation_decisions.score IS
 'Score at decision time, excluding the holiday care wish. NULL for decisions predating scores.';
COMMENT ON COLUMN enrollment.holiday_allocation_decisions.max_score IS
 'Maximum score at decision time. NULL for decisions predating scores.';
`

const holidayCriteriaRankingDownSQL = `
ALTER TABLE enrollment.holiday_allocation_decisions
 DROP COLUMN max_score, DROP COLUMN score, DROP COLUMN criteria_ranking;
DROP TABLE enrollment.holiday_allocation_rules;
COMMENT ON COLUMN enrollment.holiday_allocation_criteria.position IS NULL;
ALTER TABLE enrollment.holiday_allocation_criteria DROP COLUMN points;
`

func holidayCriteriaRankingUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, holidayCriteriaRankingUpSQL); err != nil {
		return fmt.Errorf("add holiday criteria ranking: %w", err)
	}
	return nil
}

func holidayCriteriaRankingDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, holidayCriteriaRankingDownSQL); err != nil {
		return fmt.Errorf("drop holiday criteria ranking: %w", err)
	}
	return nil
}
