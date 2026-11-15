package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

func (r *Store) ActiveDuplicateChildren(ctx context.Context, phaseID int64, guardianEmail string, children []enrollment.DuplicateChildKey, excludedRequestID int64) ([]enrollment.DuplicateChildKey, error) {
	if phaseID <= 0 {
		return nil, fmt.Errorf("phase id must be positive")
	}
	email := strings.ToLower(strings.TrimSpace(guardianEmail))
	if email == "" {
		return nil, nil
	}
	if len(children) == 0 {
		return nil, nil
	}

	type row struct {
		FirstName string `bun:"first_name"`
		LastName  string `bun:"last_name"`
	}
	var rows []row

	tenantID, err := r.tenantID(ctx)
	if err != nil {
		return nil, err
	}
	db, err := r.resolve(ctx)
	if err != nil {
		return nil, err
	}
	q := db.NewSelect().
		ColumnExpr(`LOWER(TRIM(rc.first_name)) AS first_name`).
		ColumnExpr(`LOWER(TRIM(rc.last_name)) AS last_name`).
		TableExpr(`enrollment.request_children AS rc`).
		Join(`JOIN enrollment.requests AS req ON req.id = rc.request_id AND req.tenant_id = rc.tenant_id`).
		Where(`req.tenant_id = ?`, tenantID).
		Where(`req.phase_id = ?`, phaseID).
		Where(`LOWER(TRIM(req.guardian_email)) = ?`, email).
		Where(`rc.status NOT IN (?, ?)`, enrollment.ChildStatusRejected, enrollment.ChildStatusWithdrawn)
	if excludedRequestID > 0 {
		q = q.Where(`req.id <> ?`, excludedRequestID)
	}

	keys := normalizedDuplicateKeys(children)
	if len(keys) == 0 {
		return nil, nil
	}
	q = q.WhereGroup(" AND ", func(group *bun.SelectQuery) *bun.SelectQuery {
		for _, key := range keys {
			group = group.WhereOr(`(LOWER(TRIM(rc.first_name)) = ? AND LOWER(TRIM(rc.last_name)) = ?)`, key.FirstName, key.LastName)
		}
		return group
	})

	if err := q.Distinct().Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("failed to check duplicate enrollments: %w", err)
	}

	out := make([]enrollment.DuplicateChildKey, 0, len(rows))
	for _, rr := range rows {
		out = append(out, enrollment.DuplicateChildKey{FirstName: rr.FirstName, LastName: rr.LastName})
	}
	return out, nil
}

// normalizedDuplicateKeys lower-cases and trims the child names, dropping
// children without both names.
func normalizedDuplicateKeys(children []enrollment.DuplicateChildKey) []enrollment.DuplicateChildKey {
	keys := make([]enrollment.DuplicateChildKey, 0, len(children))
	for _, c := range children {
		fn := strings.ToLower(strings.TrimSpace(c.FirstName))
		ln := strings.ToLower(strings.TrimSpace(c.LastName))
		if fn == "" || ln == "" {
			continue
		}
		keys = append(keys, enrollment.DuplicateChildKey{FirstName: fn, LastName: ln})
	}
	return keys
}

func (r *Store) HasActiveRequestForMatchedStudent(ctx context.Context, phaseID, studentID, excludeRequestChildID int64) (bool, error) {
	if phaseID <= 0 || studentID <= 0 {
		return false, nil
	}
	tenantID, err := r.tenantID(ctx)
	if err != nil {
		return false, err
	}
	db, err := r.resolve(ctx)
	if err != nil {
		return false, err
	}
	q := db.NewSelect().
		TableExpr(`enrollment.request_children AS rc`).
		Join(`JOIN enrollment.requests AS req ON req.id = rc.request_id AND req.tenant_id = rc.tenant_id`).
		Where(`req.tenant_id = ?`, tenantID).
		Where(`req.phase_id = ?`, phaseID).
		Where(`(rc.matched_student_id = ? OR rc.created_student_id = ?)`, studentID, studentID).
		Where(`rc.status NOT IN (?, ?)`, enrollment.ChildStatusRejected, enrollment.ChildStatusWithdrawn)
	if excludeRequestChildID > 0 {
		q = q.Where(`rc.id <> ?`, excludeRequestChildID)
	}
	exists, err := q.Exists(ctx)
	if err != nil {
		return false, fmt.Errorf("failed to check active request for matched student: %w", err)
	}
	return exists, nil
}

// PhaseRequestsHoldingStudents names, per student, the active request child
// of the phase that created or renews it, excluding the given request
// children. A
// student several requests hold reports the oldest of them (#6247).
func (r *Store) PhaseRequestsHoldingStudents(ctx context.Context, phaseID int64, studentIDs, excludedChildIDs []int64) (map[int64]enrollment.CandidatePhaseRequest, error) {
	if phaseID <= 0 || len(studentIDs) == 0 {
		return nil, nil
	}
	tenantID, err := r.tenantID(ctx)
	if err != nil {
		return nil, err
	}
	db, err := r.resolve(ctx)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		StudentID         int64  `bun:"student_id"`
		RequestID         int64  `bun:"request_id"`
		ChildStatus       string `bun:"child_status"`
		GuardianFirstName string `bun:"guardian_first_name"`
		GuardianLastName  string `bun:"guardian_last_name"`
	}
	// A row holds the student it created or renews, like
	// HasActiveRequestForMatchedStudent: either column counts.
	q := db.NewSelect().
		DistinctOn(`held.student_id`).
		ColumnExpr(`held.student_id`).
		ColumnExpr(`req.id AS request_id`).
		ColumnExpr(`rc.status AS child_status`).
		ColumnExpr(`req.guardian_first_name, req.guardian_last_name`).
		TableExpr(`enrollment.request_children AS rc`).
		Join(`JOIN enrollment.requests AS req ON req.id = rc.request_id AND req.tenant_id = rc.tenant_id`).
		Join(`CROSS JOIN LATERAL (VALUES (rc.created_student_id), (rc.matched_student_id)) AS held(student_id)`).
		Where(`req.tenant_id = ?`, tenantID).
		Where(`req.phase_id = ?`, phaseID).
		Where(`(rc.created_student_id = ANY(?) OR rc.matched_student_id = ANY(?))`, pgdialect.Array(studentIDs), pgdialect.Array(studentIDs)).
		Where(`held.student_id = ANY(?)`, pgdialect.Array(studentIDs)).
		Where(`rc.status NOT IN (?, ?)`, enrollment.ChildStatusRejected, enrollment.ChildStatusWithdrawn).
		OrderExpr(`held.student_id, req.submitted_at, req.id`)
	if len(excludedChildIDs) > 0 {
		q = q.Where(`rc.id <> ALL(?)`, pgdialect.Array(excludedChildIDs))
	}
	if err := q.Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("failed to read phase requests holding students: %w", err)
	}
	out := make(map[int64]enrollment.CandidatePhaseRequest, len(rows))
	for _, row := range rows {
		out[row.StudentID] = enrollment.CandidatePhaseRequest{
			RequestID: row.RequestID, ChildStatus: row.ChildStatus,
			GuardianFirstName: row.GuardianFirstName, GuardianLastName: row.GuardianLastName,
		}
	}
	return out, nil
}
