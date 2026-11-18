package enrollmenthttp

import (
	"encoding/json"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// AdminLegalEvidenceEntry is a historical record exposed by the managed
// request detail. The stored schema IDs stay internal.
type AdminLegalEvidenceEntry struct {
	WordingUnavailable bool                            `json:"wording_unavailable,omitempty"`
	SnapshotAt         time.Time                       `json:"snapshot_at"`
	Blocks             []enrollment.LegalBlockSnapshot `json:"blocks"`
	ConsentFlags       json.RawMessage                 `json:"consent_flags"`
	VersionUnknown     bool                            `json:"version_unknown,omitempty"`
	VersionMismatch    bool                            `json:"version_mismatch,omitempty"`
	StaffRecorded      bool                            `json:"staff_recorded,omitempty"`
	ChangeRequest      bool                            `json:"change_request,omitempty"`
}

func adminLegalEvidence(request *enrollment.Request) []AdminLegalEvidenceEntry {
	out := make([]AdminLegalEvidenceEntry, 0, len(request.LegalBlocksSnapshot))
	for i, entry := range request.LegalBlocksSnapshot {
		out = append(out, AdminLegalEvidenceEntry{
			SnapshotAt:         entry.SnapshotAt,
			WordingUnavailable: entry.WordingUnavailable,
			Blocks:             entry.Blocks,
			ConsentFlags:       entry.ConsentFlags,
			VersionUnknown:     entry.DisplayedFormSchemaID == 0 && entry.FormSchemaID != 0,
			VersionMismatch:    entry.DisplayedFormSchemaID != 0 && entry.DisplayedFormSchemaID != entry.FormSchemaID,
			ChangeRequest:      entry.ChangeRequest,
			StaffRecorded:      i == 0 && !entry.ChangeRequest && request.SubmissionSource == enrollment.RequestSourceAdminManual,
		})
	}
	slices.SortStableFunc(out, func(a, b AdminLegalEvidenceEntry) int {
		return b.SnapshotAt.Compare(a.SnapshotAt)
	})
	return out
}
