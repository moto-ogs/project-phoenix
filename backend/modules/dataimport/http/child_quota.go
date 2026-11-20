package importapi

import (
	"context"
	"slices"

	importModels "github.com/moto-ogs/project-phoenix/modules/dataimport"
)

// ChildQuotaPreview tells the import preview whether the new children fit
// into the Kinderkontingent (#3571). The place names match the details of the
// 409 refusal (students.child_quota_reached), so the client reads both alike.
type ChildQuotaPreview struct {
	BookedPlaces    int  `json:"booked_places"`
	OccupiedPlaces  int  `json:"occupied_places"`
	RequestedPlaces int  `json:"requested_places"`
	FreePlaces      int  `json:"free_places"`
	Fits            bool `json:"fits"`
}

// StudentPreviewResponse is the preview result plus the Kinderkontingent,
// which is left out for a school without one.
type StudentPreviewResponse struct {
	importModels.StudentImportResult
	ChildQuota *ChildQuotaPreview `json:"child_quota,omitempty"`
	// result is the preview for the audit row; it is not on the wire.
	result *importModels.ImportResult[importModels.StudentImportRow]
}

// previewStudents runs the preview's dry run and judges its new children
// against the Kinderkontingent.
func (rs *Resource) previewStudents(ctx context.Context, request importModels.ImportRequest[importModels.StudentImportRow]) (StudentPreviewResponse, error) {
	result, err := rs.studentImportService.Import(ctx, request)
	if err != nil {
		return StudentPreviewResponse{}, err
	}
	quota, err := rs.previewChildQuota(ctx, result.ChildQuotaRequested)
	if err != nil {
		return StudentPreviewResponse{}, err
	}
	return StudentPreviewResponse{StudentImportResult: importModels.NewStudentImportResult(result), ChildQuota: quota, result: result}, nil
}

// previewChildQuota judges the children a preview adds to the
// Kontingentzahl: new children that count and updates that bring a child
// back into the count, never a plain update.
func (rs *Resource) previewChildQuota(ctx context.Context, requested int) (*ChildQuotaPreview, error) {
	quota, limited, err := rs.runtime.ChildQuota(ctx)
	if err != nil || !limited {
		return nil, err
	}
	return &ChildQuotaPreview{
		BookedPlaces: quota.Booked, OccupiedPlaces: quota.Occupied, RequestedPlaces: requested,
		FreePlaces: quota.Free, Fits: quota.Admit(requested) == nil,
	}, nil
}

// admitStudentImport refuses an import whose new children do not all fit
// into the Kinderkontingent before its first batch runs, so an import is
// applied whole or not at all (#3571). It counts them with the preview's dry
// run, in every mode: an update can resume a child's care. Every batch still
// checks under the quota lock, which catches children created by others
// between this check and the batch.
// It returns the owner's refusal, or nil when the import may start.
func (rs *Resource) admitStudentImport(ctx context.Context, request importModels.ImportRequest[importModels.StudentImportRow]) error {
	quota, limited, err := rs.runtime.ChildQuota(ctx)
	if err != nil || !limited {
		return err
	}
	// The dry run may normalize its rows; the batches get the upload as sent.
	request.Rows, request.DryRun = slices.Clone(request.Rows), true
	dryRun, err := rs.studentImportService.Import(ctx, request)
	if err != nil {
		return err
	}
	return quota.Admit(dryRun.ChildQuotaRequested)
}
