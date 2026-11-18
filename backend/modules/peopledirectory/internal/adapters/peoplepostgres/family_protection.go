package users

import (
	"context"
	"fmt"
	"time"

	"github.com/uptrace/bun"

	userModels "github.com/moto-ogs/project-phoenix/modules/peopledirectory/internal/rows"
	ports "github.com/moto-ogs/project-phoenix/modules/peopledirectory/ports"
)

const familyProtectionTable = "users.student_family_protection_events"

type FamilyProtectionEventRepository struct {
	runtime Runtime
	now     func() time.Time // stamps created_at (ADR 0281)
}

func NewFamilyProtectionEventRepository(runtime Runtime, now func() time.Time) ports.FamilyProtectionRecords {
	return nativeFamilyProtectionRecords{FamilyProtectionEventRepository: &FamilyProtectionEventRepository{runtime: requireRuntime(runtime), now: requireClock(now)}}
}

// Create overrides the generic insert so created_at is the owner's instant.
// Sharing and protection events live in separate tables, and visibility compares
// their creation order, so both ledgers stamp on the same clock (ADR 0281).
func (r *FamilyProtectionEventRepository) Create(ctx context.Context, event *userModels.FamilyProtectionEvent) error {
	if event == nil {
		return fmt.Errorf("family protection event cannot be nil")
	}
	ensureTenantID(ctx, r.runtime, event)
	at := r.now()
	ambientDB1, databaseErr1 := r.runtime.DB(ctx)
	if databaseErr1 != nil {
		return databaseErr1
	}
	if _, err := ambientDB1.NewInsert().Model(event).
		ModelTableExpr(familyProtectionTable).
		Value("created_at", "?", at).
		Value("updated_at", "?", at).
		Exec(ctx); err != nil {
		return &ports.DatabaseError{Op: "create family protection event", Err: translateNotFound(err)}
	}
	return nil
}

// CurrentForStudents uses DISTINCT ON because the generic filter API cannot
// select the newest immutable event independently for each child.
func (r *FamilyProtectionEventRepository) CurrentForStudents(ctx context.Context, studentIDs []int64) (map[int64]*userModels.FamilyProtectionEvent, error) {
	result := make(map[int64]*userModels.FamilyProtectionEvent, len(studentIDs))
	if len(studentIDs) == 0 {
		return result, nil
	}
	var rows []*userModels.FamilyProtectionEvent
	ambientDB2, databaseErr2 := r.runtime.DB(ctx)
	if databaseErr2 != nil {
		return *new(map[int64]*userModels.FamilyProtectionEvent), databaseErr2
	}
	query := ambientDB2.NewSelect().
		Model(&rows).
		ModelTableExpr(`users.student_family_protection_events AS "family_protection_event"`).
		Where(`"family_protection_event".student_id IN (?)`, bun.List(studentIDs)).
		DistinctOn(`"family_protection_event".student_id`).
		OrderExpr(`"family_protection_event".student_id, "family_protection_event".id DESC`)
	query = withTenantFilter(ctx, r.runtime, query, "family_protection_event")
	if err := query.Scan(ctx); err != nil {
		return nil, &ports.DatabaseError{Op: "list current family protection", Err: translateNotFound(err)}
	}
	for _, row := range rows {
		result[row.StudentID] = row
	}
	return result, nil
}
