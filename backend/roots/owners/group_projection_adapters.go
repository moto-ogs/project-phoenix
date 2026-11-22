package owners

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/schoolstructure"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
)

// NewGroupSupervisionRecords names the groups of the supervision blockers
// through the School Structure owner.
func NewGroupSupervisionRecords(records studentpresence.SupervisionRecords, groups schoolstructure.Query) studentpresence.SupervisionRecords {
	return groupSupervisorRepository{SupervisionRecords: records, groups: groups}
}

type groupSupervisorRepository struct {
	studentpresence.SupervisionRecords
	groups groupNameQuery
}

func (r groupSupervisorRepository) ListActiveSupervisionBlockers(ctx context.Context, staffID int64) ([]studentpresence.SupervisionBlocker, error) {
	rows, err := r.SupervisionRecords.ListActiveSupervisionBlockers(ctx, staffID)
	if err != nil {
		return nil, err
	}
	pointers := make([]*studentpresence.SupervisionBlocker, len(rows))
	for index := range rows {
		pointers[index] = &rows[index]
	}
	if _, err := EnrichGroupNames(ctx, r.groups, pointers,
		func(row *studentpresence.SupervisionBlocker) int64 { return row.GroupID },
		func(row *studentpresence.SupervisionBlocker, name string) { row.GroupName = name },
		schoolstructure.UnknownGroupName, "supervision blockers"); err != nil {
		return nil, err
	}
	return rows, nil
}
