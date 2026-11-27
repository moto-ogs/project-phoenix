package owners

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// NewParentExcusedRequestReads binds the absence request read of the parent
// request sharing. Like the other request bindings, a missing row answers
// with the workflow's not-found.
func NewParentExcusedRequestReads(source careplan.Capability) parentExcusedRequestReads {
	return parentExcusedRequestReads{source: source}
}

type parentExcusedRequestReads struct {
	source careplan.Capability
}

func (r parentExcusedRequestReads) FindIdentity(ctx context.Context, id int64) (int64, int64, error) {
	row, err := r.source.FindExcusedAbsenceRequest(ctx, id, false)
	if errors.Is(err, careplan.ErrExcusedRequestNotFound) {
		return 0, 0, parentportal.ErrRequestSharingNotFound
	}
	return row.SubmittedBy, row.StudentID, err
}
