package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const holidayExtraDaysVersion = "20261127124000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     holidayExtraDaysVersion,
		Description: "Ferien: einzelne Zusatztage wie Brückentage, im Monatsbeitrag enthalten oder mit Tagespreis (#4817)",
		DependsOn:   []string{traegerHolidayPeriodsVersion}, // the periods it extends
	})
	Migrations.MustRegister(holidayExtraDaysUp, holidayExtraDaysDown)
}

const holidayExtraDaysUpSQL = `
ALTER TABLE enrollment.holiday_periods
 ADD COLUMN kind TEXT NOT NULL DEFAULT 'holiday'
  CONSTRAINT chk_holiday_periods_kind CHECK (kind IN ('holiday', 'extra_day')),
 ADD COLUMN included_in_fee BOOLEAN NOT NULL DEFAULT false,
 ADD CONSTRAINT chk_holiday_periods_included_in_fee CHECK (kind = 'extra_day' OR NOT included_in_fee);
COMMENT ON COLUMN enrollment.holiday_periods.kind IS
 'holiday: weeks of holiday care. extra_day: one extra care day outside the holidays, one single-day week per school (#4817).';
COMMENT ON COLUMN enrollment.holiday_periods.included_in_fee IS
 'An extra day the monthly contribution covers: parents only register, nothing is billed (#4817).';
`

const holidayExtraDaysDownSQL = `
ALTER TABLE enrollment.holiday_periods
 DROP CONSTRAINT chk_holiday_periods_included_in_fee,
 DROP COLUMN included_in_fee,
 DROP COLUMN kind;
`

func holidayExtraDaysUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, holidayExtraDaysUpSQL); err != nil {
		return fmt.Errorf("add holiday extra days: %w", err)
	}
	return nil
}

func holidayExtraDaysDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, holidayExtraDaysDownSQL); err != nil {
		return fmt.Errorf("drop holiday extra days: %w", err)
	}
	return nil
}
