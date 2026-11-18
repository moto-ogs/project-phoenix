package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const emailDeliveryStateRecordedAtVersion = "20261118081724"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     emailDeliveryStateRecordedAtVersion,
		Description: "Zustellfristen auf der Uhr von Delivery messen (#7383)",
		DependsOn:   []string{emailDeliveryEventsVersion},
	})
	Migrations.MustRegister(emailDeliveryStateRecordedAtUp, emailDeliveryStateRecordedAtDown)
}

func emailDeliveryStateRecordedAtUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, `ALTER TABLE platform.email_outbox ADD COLUMN delivery_state_recorded_at TIMESTAMPTZ`); err != nil {
		return fmt.Errorf("add email delivery state recording time: %w", err)
	}
	return nil
}

func emailDeliveryStateRecordedAtDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, `ALTER TABLE platform.email_outbox DROP COLUMN delivery_state_recorded_at`); err != nil {
		return fmt.Errorf("drop email delivery state recording time: %w", err)
	}
	return nil
}
