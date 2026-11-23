package application

import (
	"context"

	directory "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
)

// The bound facade invokes the exact same retained reads, including their
// canonical hydration, error mapping and gate-before-row mutation lock order.
func (r *StudentRecords) StudentSnapshotByID(ctx context.Context, id int64) (*directory.StudentSnapshot, error) {
	row, err := r.FindByID(ctx, id)
	return directory.StudentSnapshotFromState(row), err
}
func (r *StudentRecords) StudentSnapshotForUpdate(ctx context.Context, id int64) (*directory.StudentSnapshot, error) {
	row, err := r.FindByIDForUpdate(ctx, id)
	return directory.StudentSnapshotFromState(row), err
}
func (r *StudentRecords) StudentSnapshotForNoKeyUpdate(ctx context.Context, id int64) (*directory.StudentSnapshot, error) {
	row, err := r.findByIDLocked(ctx, id, "NO KEY UPDATE", "find by id for no key update")
	return directory.StudentSnapshotFromState(row), err
}
