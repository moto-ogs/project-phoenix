package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	careplan "github.com/moto-ogs/project-phoenix/modules/careplan"
	carePlanCompose "github.com/moto-ogs/project-phoenix/modules/careplan/compose"
	"github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	transactionRuntimeCompose "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	workforceCompose "github.com/moto-ogs/project-phoenix/modules/workforce/compose"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/spf13/cobra"
)

func init() { RootCmd.AddCommand(newUploadSealCommand()) }

func newUploadSealCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:          "upload-seal",
		Short:        "Seal stored sick notes, payslips and child health documents in bounded, restartable batches (#3840)",
		SilenceUsage: true, RunE: runUploadSeal,
	}
	cmd.Flags().Int64("school", 0, "School ID")
	cmd.Flags().String("uploads", "", "Uploads root of this installation (the directory holding staff-documents/ and student-documents/)")
	cmd.Flags().Int("batch-size", 100, "Documents per transaction (1..1000)")
	return cmd
}

func runUploadSeal(cmd *cobra.Command, _ []string) error {
	schoolID, _ := cmd.Flags().GetInt64("school")
	uploads, _ := cmd.Flags().GetString("uploads")
	batchSize, _ := cmd.Flags().GetInt("batch-size")
	if schoolID <= 0 || uploads == "" || batchSize < 1 || batchSize > 1000 {
		return errors.New("school, uploads and batch-size 1..1000 are required")
	}
	if info, err := os.Stat(uploads); err != nil || !info.IsDir() {
		return errors.New("upload seal: the uploads root is not a directory")
	}
	health, bank, err := uploadFileCiphers()
	if err != nil {
		return fmt.Errorf("upload seal: %w", err)
	}
	db, err := transactionRuntimeCompose.OpenDatabase()
	if err != nil {
		return errors.New("upload seal: maintenance database unavailable")
	}
	defer func() { _ = db.Close() }()
	store := objects.NewPrivateUploads(objects.NewLocal(uploads), objects.FileKeys{Health: health, Bank: bank})
	ctx := tenant.WithUnitOfWork(cmd.Context(), db.UnitOfWork())
	return runUploadSealJob(ctx, workforceCompose.NewStaffDocumentFileSeal(), carePlanCompose.NewStudentDocumentFileSeal(), store, schoolID, batchSize, cmd.OutOrStdout())
}

// uploadSealBatch runs one bounded batch from cursor through reseal.
type uploadSealBatch func(ctx context.Context, cursor int64, reseal func(ctx context.Context, storedName, ring string) (bool, error)) (scanned, changed int, lastID int64, err error)

// runUploadSealJob seals the staff and the child documents of one school; the
// production CLI and its integration test use the same traversal. Each batch
// runs in its own school transaction. A document whose file is already gone
// is counted as missing, not sealed.
func runUploadSealJob(ctx context.Context, staff workforce.StaffDocumentFileSeal, students careplan.StudentDocumentFileSeal,
	store *objects.PrivateUploads, schoolID int64, batchSize int, output io.Writer,
) error {
	school, err := tenant.NewTenantID(schoolID)
	if err != nil {
		return errors.New("upload seal: school is required")
	}
	sources := []struct {
		name, kind string
		batch      uploadSealBatch
	}{
		{"staff_documents", workforce.StaffDocumentStorageKind, func(ctx context.Context, cursor int64, reseal func(context.Context, string, string) (bool, error)) (scanned, changed int, lastID int64, err error) {
			err = tenant.WithinTenant(ctx, school, func(ctx context.Context) error {
				result, err := staff.Batch(ctx, schoolID, cursor, batchSize, reseal)
				scanned, changed, lastID = result.Scanned, result.Changed, result.LastID
				return err
			})
			return
		}},
		{"student_documents", careplan.StudentDocumentStorageKind, func(ctx context.Context, cursor int64, reseal func(context.Context, string, string) (bool, error)) (scanned, changed int, lastID int64, err error) {
			err = tenant.WithinTenant(ctx, school, func(ctx context.Context) error {
				result, err := students.Batch(ctx, schoolID, cursor, batchSize, reseal)
				scanned, changed, lastID = result.Scanned, result.Changed, result.LastID
				return err
			})
			return
		}},
	}
	for _, source := range sources {
		if err := runUploadSealSource(ctx, source.name, source.kind, schoolID, store, source.batch, output); err != nil {
			return err
		}
	}
	return nil
}

func runUploadSealSource(ctx context.Context, source, kind string, schoolID int64, store *objects.PrivateUploads, batch uploadSealBatch, output io.Writer) error {
	// Leftovers of an interrupted run hold bytes the exchange replaced.
	stale, err := store.RemoveStaleReplacements(ctx, kind, schoolID)
	if err != nil {
		return fmt.Errorf("upload seal: source %s: stale replacements could not be removed", source)
	}
	if _, err := fmt.Fprintf(output, "source=%s stale_removed=%d\n", source, stale); err != nil {
		return err
	}
	var cursor int64
	var scannedTotal, changedTotal, missingTotal int
	for {
		missing := 0
		var cause error
		reseal := func(ctx context.Context, storedName, ring string) (bool, error) {
			changed, err := store.ResealPrivate(ctx, kind, schoolID, storedName, ring)
			if errors.Is(err, objects.ErrNotFound) {
				missing++
				return false, nil
			}
			cause = err
			return changed, err
		}
		scanned, changed, lastID, err := batch(ctx, cursor, reseal)
		if err != nil {
			return fmt.Errorf("upload seal: source %s failed after cursor %d (%s)", source, cursor, uploadSealFailure(cause))
		}
		if scanned == 0 {
			break
		}
		if _, err := fmt.Fprintf(output, "source=%s scanned=%d changed=%d missing=%d\n", source, scanned, changed, missing); err != nil {
			return err
		}
		scannedTotal += scanned
		changedTotal += changed
		missingTotal += missing
		cursor = lastID
	}
	_, err = fmt.Fprintf(output, "source=%s scanned_total=%d changed_total=%d missing_total=%d\n", source, scannedTotal, changedTotal, missingTotal)
	return err
}

// uploadSealFailure names the class of a failed batch without names, keys or
// content: a ring that does not open the file, or a storage or database error.
func uploadSealFailure(cause error) string {
	switch {
	case cause == nil:
		return "database"
	case errors.Is(cause, objects.ErrSealedUnavailable):
		return "sealed file does not open with the configured rings"
	default:
		return "storage"
	}
}
