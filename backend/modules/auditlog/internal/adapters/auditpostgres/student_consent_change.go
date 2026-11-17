package audit

import (
	"context"
	"errors"
	"fmt"
	"time"

	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
)

const studentConsentChangeTableExpr = `audit.student_consent_changes AS "student_consent_change"`

type studentConsentChangeRepository struct {
	runtime Runtime
	now     func() time.Time
}

func NewStudentConsentChangeRepository(runtime Runtime, now func() time.Time) auditModels.StudentConsentChangeRepository {
	return &studentConsentChangeRepository{runtime: requireRuntime(runtime), now: now}
}

func (r *studentConsentChangeRepository) Create(ctx context.Context, entry *auditModels.StudentConsentChange) error {
	return NewAppender(r.runtime, r.now).Append(ctx, entry)
}

// CreateAll appends every entry in one statement, all or nothing.
func (r *studentConsentChangeRepository) CreateAll(ctx context.Context, entries []*auditModels.StudentConsentChange) error {
	events, err := studentConsentChangeEvents(entries)
	if err != nil || len(events) == 0 {
		return err
	}
	return NewAppender(r.runtime, r.now).AppendAll(ctx, events)
}

// studentConsentChangeEvents rejects a nil entry before any row is written.
func studentConsentChangeEvents(entries []*auditModels.StudentConsentChange) ([]any, error) {
	events := make([]any, 0, len(entries))
	for _, entry := range entries {
		if entry == nil {
			return nil, errors.New("student consent change cannot be nil")
		}
		events = append(events, entry)
	}
	return events, nil
}

// ListByStudentID is a custom ordered audit projection; the generic repository
// cannot express the stable created_at/id ordering needed by history readers.
func (r *studentConsentChangeRepository) ListByStudentID(ctx context.Context, studentID int64) ([]*auditModels.StudentConsentChange, error) {
	if studentID <= 0 {
		return nil, fmt.Errorf("student_id is required")
	}
	var rows []*auditModels.StudentConsentChange
	ambientDB1, databaseErr1 := runtimeDB(ctx, r.runtime)
	if databaseErr1 != nil {
		return *new([]*auditModels.StudentConsentChange), databaseErr1
	}
	err := ambientDB1.NewSelect().
		Model(&rows).
		ModelTableExpr(studentConsentChangeTableExpr).
		Where(`"student_consent_change".student_id = ?`, studentID).
		OrderExpr(`"student_consent_change".created_at DESC, "student_consent_change".id DESC`).
		Scan(ctx)
	if err != nil {
		return nil, wrapDatabase("list student consent changes", err)
	}
	return rows, nil
}
