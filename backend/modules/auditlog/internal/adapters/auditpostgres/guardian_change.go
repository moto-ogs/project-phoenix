package audit

import (
	"context"
	"fmt"
	"time"

	audit "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
)

const guardianChangeTableExpr = `audit.guardian_changes AS "guardian_change"`

type guardianChangeRepository struct {
	runtime Runtime
	now     func() time.Time
}

func NewGuardianChangeRepository(runtime Runtime, now func() time.Time) audit.GuardianChangeRepository {
	return &guardianChangeRepository{runtime: requireRuntime(runtime), now: now}
}

func (r *guardianChangeRepository) Create(ctx context.Context, entry *audit.GuardianChange) error {
	return NewAppender(r.runtime, r.now).Append(ctx, entry)
}

func (r *guardianChangeRepository) ListByStudentID(ctx context.Context, studentID int64) ([]*audit.GuardianChange, error) {
	if studentID <= 0 {
		return nil, fmt.Errorf("student_id is required")
	}
	var rows []*audit.GuardianChange
	ambientDB1, databaseErr1 := runtimeDB(ctx, r.runtime)
	if databaseErr1 != nil {
		return *new([]*audit.GuardianChange), databaseErr1
	}
	err := ambientDB1.NewSelect().
		Model(&rows).
		ModelTableExpr(guardianChangeTableExpr).
		Where(`"guardian_change".student_id = ?`, studentID).
		OrderExpr(`"guardian_change".changed_at DESC, "guardian_change".id DESC`).
		Scan(ctx)
	if err != nil {
		return nil, wrapDatabase("list guardian changes", err)
	}
	return rows, nil
}
