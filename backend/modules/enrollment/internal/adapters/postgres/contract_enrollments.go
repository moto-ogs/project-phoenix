package postgres

import (
	"context"
	"fmt"
	"slices"

	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// ContractEnrollmentHolders lists, for the students, every request child of
// the phase that created or renews one of them and is neither rejected nor
// withdrawn, with the source of its request (#7760, ADR 0309): one read for
// a phase, however many students. A row holds the student it created or was
// matched to, like PhaseRequestsHoldingStudents; either column counts.
func (r *Store) ContractEnrollmentHolders(ctx context.Context, phaseID int64, studentIDs []int64) ([]enrollment.ContractEnrollmentHolder, error) {
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
		CreatedStudentID *int64 `bun:"created_student_id"`
		MatchedStudentID *int64 `bun:"matched_student_id"`
		RequestID        int64  `bun:"request_id"`
		RequestChildID   int64  `bun:"request_child_id"`
		Status           string `bun:"status"`
		SubmissionSource string `bun:"submission_source"`
		MatchedByOffice  bool   `bun:"matched_by_office"`
	}
	if err := db.NewRaw(`SELECT rc.created_student_id, rc.matched_student_id, req.id AS request_id, rc.id AS request_child_id,
			rc.status, req.submission_source, rc.matched_by_office
		FROM enrollment.request_children AS rc
		JOIN enrollment.requests AS req ON req.id = rc.request_id AND req.tenant_id = rc.tenant_id
		WHERE req.tenant_id = ? AND req.phase_id = ? AND (rc.created_student_id = ANY(?) OR rc.matched_student_id = ANY(?))
			AND rc.status NOT IN (?, ?)
		ORDER BY req.submitted_at, req.id, rc.id`,
		tenantID, phaseID, pgdialect.Array(studentIDs), pgdialect.Array(studentIDs),
		enrollment.ChildStatusRejected, enrollment.ChildStatusWithdrawn).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("failed to read the phase requests of contract children: %w", err)
	}
	holders := make([]enrollment.ContractEnrollmentHolder, 0, len(rows))
	for _, row := range rows {
		holder := enrollment.ContractEnrollmentHolder{RequestID: row.RequestID, RequestChildID: row.RequestChildID,
			Status: row.Status, SubmissionSource: row.SubmissionSource, MatchedByOffice: row.MatchedByOffice}
		if row.CreatedStudentID != nil && slices.Contains(studentIDs, *row.CreatedStudentID) {
			holder.StudentID, holder.Created = *row.CreatedStudentID, true
			holders = append(holders, holder)
		}
		if matched := row.MatchedStudentID; matched != nil && slices.Contains(studentIDs, *matched) &&
			(row.CreatedStudentID == nil || *row.CreatedStudentID != *matched) {
			holder.StudentID, holder.Created = *matched, false
			holders = append(holders, holder)
		}
	}
	return holders, nil
}
