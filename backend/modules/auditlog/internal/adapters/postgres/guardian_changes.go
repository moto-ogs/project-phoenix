package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/auditlog"
	"github.com/uptrace/bun"
)

// guardianChangeRow omits id so the table's BIGSERIAL fills it. changed_at
// is the instant of the Audit clock, like every row of the retained
// repository: the Träger access log lists the change up to an instant of the
// root clock (ADR 0281).
type guardianChangeRow struct {
	bun.BaseModel      `bun:"table:audit.guardian_changes"`
	TenantID           int64     `bun:"tenant_id"`
	StudentID          int64     `bun:"student_id"`
	GuardianProfileID  int64     `bun:"guardian_profile_id"`
	ActorAccountID     *int64    `bun:"actor_account_id"`
	ActorNameSnapshot  *string   `bun:"actor_name_snapshot"`
	ActorEmailSnapshot *string   `bun:"actor_email_snapshot"`
	ChangeType         string    `bun:"change_type"`
	FieldName          string    `bun:"field_name"`
	OldValue           *string   `bun:"old_value"`
	NewValue           *string   `bun:"new_value"`
	ChangedAt          time.Time `bun:"changed_at"`
}

type GuardianChanges struct {
	database Database
	now      func() time.Time
}

// NewGuardianChanges binds the guardian-change append to the caller's
// transaction; now is the Audit clock and is required.
func NewGuardianChanges(database Database, now func() time.Time) *GuardianChanges {
	if now == nil {
		panic("audit guardian changes: clock is required")
	}
	return &GuardianChanges{database: database, now: now}
}

func (s *GuardianChanges) RecordGuardianChanges(ctx context.Context, changes []auditlog.GuardianChange) error {
	if len(changes) == 0 {
		return nil
	}
	db, tenantID, err := s.database(ctx)
	if err != nil {
		return err
	}
	rows := make([]guardianChangeRow, 0, len(changes))
	changedAt := s.now()
	for _, change := range changes {
		rows = append(rows, guardianChangeRow{
			TenantID: tenantID, StudentID: change.StudentID, GuardianProfileID: change.GuardianProfileID,
			ActorAccountID: change.ActorAccountID, ActorNameSnapshot: change.ActorNameSnapshot, ActorEmailSnapshot: change.ActorEmailSnapshot,
			ChangeType: change.ChangeType, FieldName: change.FieldName, OldValue: change.OldValue, NewValue: change.NewValue,
			ChangedAt: changedAt,
		})
	}
	if _, err := db.NewInsert().Model(&rows).Exec(ctx); err != nil {
		return fmt.Errorf("audit database error during append audit.guardian_changes: %w", err)
	}
	return nil
}
