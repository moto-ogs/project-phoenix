package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/uptrace/bun"

	careplan "github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// StudentDocumentFileSealStore locks the document rows whose files the
// maintenance seal rewrites (#3840). It writes no row.
type StudentDocumentFileSealStore struct{}

func NewStudentDocumentFileSealStore() *StudentDocumentFileSealStore {
	return &StudentDocumentFileSealStore{}
}

type studentDocumentSealRow struct {
	ID             int64  `bun:"id"`
	FilenameStored string `bun:"filename_stored"`
	Category       string `bun:"category"`
}

// LockSealableStudentDocuments locks one bounded batch of live documents of
// one school, ordered by ID and without skipped locks, so the cursor never
// passes a concurrent delete: a delete waits for the batch, and its file
// removal runs after the sealed file is in place.
func (s *StudentDocumentFileSealStore) LockSealableStudentDocuments(ctx context.Context, schoolID, afterID int64, limit int, categories []string,
	visit func(storedName, category string) (bool, error),
) (careplan.StudentDocumentFileSealResult, error) {
	if schoolID <= 0 || tenant.FromContext(ctx) != schoolID {
		return careplan.StudentDocumentFileSealResult{}, errors.New("care plan postgres: the school transaction of this school is required")
	}
	transaction, ok := tenant.TransactionFromContext(ctx)
	if !ok {
		return careplan.StudentDocumentFileSealResult{}, errors.New("care plan postgres: transaction is required")
	}
	tx, ok := transaction.(bun.Tx)
	if !ok {
		return careplan.StudentDocumentFileSealResult{}, fmt.Errorf("care plan postgres: unsupported transaction %T", transaction)
	}
	if err := tenant.OrderLock(ctx, tenant.LockLeaf, "users.student_documents"); err != nil {
		return careplan.StudentDocumentFileSealResult{}, err
	}
	var rows []studentDocumentSealRow
	if err := tx.NewRaw(`SELECT id, filename_stored, category FROM users.student_documents
   WHERE tenant_id = ? AND id > ? AND category IN (?) AND deleted_at IS NULL AND file_deleted_at IS NULL
   ORDER BY id LIMIT ? FOR UPDATE`, schoolID, afterID, bun.List(categories), limit).Scan(ctx, &rows); err != nil {
		tenant.MarkRollback(ctx)
		return careplan.StudentDocumentFileSealResult{}, errors.New("student document file seal: batch could not be locked")
	}
	result := careplan.StudentDocumentFileSealResult{}
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
