package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// StaffDocumentFileSealStore locks the document rows whose files the
// maintenance seal rewrites (#3840). It writes no row.
type StaffDocumentFileSealStore struct{}

func NewStaffDocumentFileSealStore() *StaffDocumentFileSealStore {
	return &StaffDocumentFileSealStore{}
}

type staffDocumentSealRow struct {
	ID             int64  `bun:"id"`
	FilenameStored string `bun:"filename_stored"`
	Category       string `bun:"category"`
}

// LockSealableStaffDocuments locks one bounded batch of live documents of one
// school, ordered by ID and without skipped locks, so the cursor never passes
// a concurrent delete: a delete waits for the batch, and its file removal
// runs after the sealed file is in place.
func (s *StaffDocumentFileSealStore) LockSealableStaffDocuments(ctx context.Context, schoolID, afterID int64, limit int, categories []string,
	visit func(storedName, category string) (bool, error),
) (workforce.StaffDocumentFileSealResult, error) {
	tx, err := schoolTransaction(ctx, schoolID)
	if err != nil {
		return workforce.StaffDocumentFileSealResult{}, err
	}
	if err := tenant.OrderLock(ctx, tenant.LockLeaf, "users.staff_documents"); err != nil {
		return workforce.StaffDocumentFileSealResult{}, err
	}
	// Fail fast behind a long-held document row; a rerun resumes from zero.
	if _, err := tx.ExecContext(ctx, "SET LOCAL lock_timeout = '5s'"); err != nil {
		tenant.MarkRollback(ctx)
		return workforce.StaffDocumentFileSealResult{}, err
	}
	var rows []staffDocumentSealRow
	if err := tx.NewRaw(`SELECT id, filename_stored, category FROM users.staff_documents
   WHERE tenant_id = ? AND id > ? AND category IN (?) AND deleted_at IS NULL AND file_deleted_at IS NULL
   ORDER BY id LIMIT ? FOR UPDATE`, schoolID, afterID, bun.List(categories), limit).Scan(ctx, &rows); err != nil {
		tenant.MarkRollback(ctx)
		return workforce.StaffDocumentFileSealResult{}, errors.New("staff document file seal: batch could not be locked")
	}
	result := workforce.StaffDocumentFileSealResult{}
	for _, row := range rows {
		changed, err := visit(row.FilenameStored, row.Category)
		if err != nil {
			tenant.MarkRollback(ctx)
			return result, err
		}
		result.Scanned++
		result.LastID = row.ID
		if changed {
			result.Changed++
		}
	}
	return result, nil
}

// schoolTransaction requires the school transaction of exactly this school.
func schoolTransaction(ctx context.Context, schoolID int64) (bun.Tx, error) {
	if schoolID <= 0 || tenant.FromContext(ctx) != schoolID {
		return bun.Tx{}, errors.New("workforce postgres: the school transaction of this school is required")
	}
	transaction, ok := tenant.TransactionFromContext(ctx)
	if !ok {
		return bun.Tx{}, errors.New("workforce postgres: transaction is required")
	}
	tx, ok := transaction.(bun.Tx)
	if !ok {
		return bun.Tx{}, fmt.Errorf("workforce postgres: unsupported transaction %T", transaction)
	}
	return tx, nil
}
