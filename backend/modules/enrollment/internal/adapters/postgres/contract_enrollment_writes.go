package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// The set-based writes of the enrollment of the children of imported care
// contracts (#7760, ADR 0309): each statement writes the rows of every
// child of a run. The caller holds the approval gates and the match lock of
// each phase, read the phases under them and stamps the rows itself, so the
// store reads nothing and needs no clock.

// InsertContractEnrollments stores the requests, then their children, then
// the submitted choices of the children, in three statements, and fills in
// the stored rows. A request and its child are new rows, so no choice meets
// a stored one.
func (r *Store) InsertContractEnrollments(ctx context.Context, writes []enrollment.ContractEnrollmentWrite, stamp enrollment.ContractEnrollmentStamp) error {
	if len(writes) == 0 {
		return nil
	}
	tenantID, err := r.tenantID(ctx)
	if err != nil {
		return err
	}
	db, err := r.resolve(ctx)
	if err != nil {
		return err
	}
	batch := contractEnrollmentBatch{db: db, tenantID: tenantID, stamp: stamp, writes: writes}
	if err := batch.insertRequests(ctx); err != nil {
		return err
	}
	if err := batch.insertChildren(ctx); err != nil {
		return err
	}
	return batch.insertChoices(ctx)
}

// contractEnrollmentBatch is one run's rows on their way into the store.
type contractEnrollmentBatch struct {
	db       bun.IDB
	tenantID int64
	stamp    enrollment.ContractEnrollmentStamp
	writes   []enrollment.ContractEnrollmentWrite
}

// insertRequests stores every request in one statement and hands each
// write its stored request.
func (b contractEnrollmentBatch) insertRequests(ctx context.Context) error {
	rows := make([]*requestRow, len(b.writes))
	for i, write := range b.writes {
		if write.Request == nil || write.Child == nil || (write.Request.TenantID != 0 && write.Request.TenantID != b.tenantID) {
			return fmt.Errorf("contract enrollment %d: request and child of the tenant are required", i)
		}
		row, err := requestStorage(write.Request)
		if err != nil {
			return err
		}
		row.TenantID, row.CreatedAt, row.UpdatedAt = b.tenantID, b.stamp.At, b.stamp.At
		rows[i] = row
	}
	if _, err := b.db.NewInsert().Model(&rows).ModelTableExpr(requestTableExpr).Returning("*").Exec(ctx); err != nil {
		return fmt.Errorf("failed to create the requests of contract enrollments: %w", err)
	}
	for i, write := range b.writes {
		stored, err := rows[i].value()
		if err != nil {
			return err
		}
		*write.Request = *stored
	}
	return nil
}

// insertChildren stores the child of every stored request in one statement
// and hands each write its stored child.
func (b contractEnrollmentBatch) insertChildren(ctx context.Context) error {
	rows := make([]*requestChildRow, len(b.writes))
	for i, write := range b.writes {
		write.Child.RequestID = write.Request.ID
		row, err := childStorage(write.Child)
		if err != nil {
			return err
		}
		row.TenantID, row.CreatedAt, row.UpdatedAt = b.tenantID, b.stamp.At, b.stamp.At
		rows[i] = row
	}
	if _, err := b.db.NewInsert().Model(&rows).ModelTableExpr(requestChildTableExpr).Returning("*").Exec(ctx); err != nil {
		return fmt.Errorf("failed to create the children of contract enrollments: %w", markChildWriteError(err))
	}
	for i, write := range b.writes {
		stored, err := rows[i].value()
		if err != nil {
			return err
		}
		*write.Child = *stored
	}
	return nil
}

// insertChoices stores the submitted choices of every stored child in one
// statement.
func (b contractEnrollmentBatch) insertChoices(ctx context.Context) error {
	rows := []*submittedOfferingRow{}
	for _, write := range b.writes {
		for _, choice := range write.Choices {
			rows = append(rows, &submittedOfferingRow{TenantID: b.tenantID, RequestChildID: write.Child.ID, CareOfferingID: choice.CareOfferingID,
				SelectedDays: choice.SelectedDays, Notes: choice.Notes, Terms: choice.Terms})
		}
	}
	if len(rows) == 0 {
		return nil
	}
	if _, err := b.db.NewInsert().Model(&rows).Exec(ctx); err != nil {
		return fmt.Errorf("failed to record the offering choices of contract enrollments: %w", err)
	}
	return nil
}

// approveContractChildrenSQL approves every child of the input in one
// statement, as UpdateChildStatus approves one: the status, its reason, the
// instant the contract reads as the acceptance, the reviewer, and no review
// reason left.
const approveContractChildrenSQL = `WITH input AS (
	SELECT * FROM jsonb_to_recordset(?::jsonb) AS i(request_child_id bigint, reviewed_by bigint)
)
UPDATE enrollment.request_children AS rc
SET status = ?, status_reason = ?, reviewed_at = ?, reviewed_by = i.reviewed_by, review_reason = NULL
FROM input AS i
WHERE rc.tenant_id = ? AND rc.id = i.request_child_id`

// ApproveContractChildren approves the children of a run in one statement.
// A child the statement does not find is a fault: the run inserted it.
func (r *Store) ApproveContractChildren(ctx context.Context, approvals []enrollment.ContractChildApproval, stamp enrollment.ContractEnrollmentStamp) error {
	if len(approvals) == 0 {
		return nil
	}
	tenantID, err := r.tenantID(ctx)
	if err != nil {
		return err
	}
	db, err := r.resolve(ctx)
	if err != nil {
		return err
	}
	type record struct {
		RequestChildID int64 `json:"request_child_id"`
		ReviewedBy     int64 `json:"reviewed_by"`
	}
	records := make([]record, len(approvals))
	for i, approval := range approvals {
		records[i] = record(approval)
	}
	input, err := json.Marshal(records)
	if err != nil {
		return fmt.Errorf("failed to encode the approvals of contract children: %w", err)
	}
	result, err := db.NewRaw(approveContractChildrenSQL, string(input), enrollment.ChildStatusApproved, stamp.Reason, stamp.At, tenantID).Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to approve the children of contract enrollments: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if int(rows) != len(approvals) {
		return fmt.Errorf("approved %d of %d children of contract enrollments", rows, len(approvals))
	}
	return nil
}
