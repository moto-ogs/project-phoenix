package audit

import (
	"context"
	"fmt"
	"time"

	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
)

// StaffMasterDataChangeRepository is the append-only writer for
// audit.staff_master_data_changes (#1423).
type StaffMasterDataChangeRepository struct {
	runtime Runtime
	now     func() time.Time
}

// NewStaffMasterDataChangeRepository creates the audit writer.
func NewStaffMasterDataChangeRepository(runtime Runtime, now func() time.Time) auditModels.StaffMasterDataChangeCreator {
	return &StaffMasterDataChangeRepository{runtime: requireRuntime(runtime), now: now}
}

// Create inserts one field-level change row.
func (r *StaffMasterDataChangeRepository) Create(ctx context.Context, event *auditModels.StaffMasterDataChange) error {
	if event == nil {
		return fmt.Errorf("staff master data change audit event is required")
	}
	if err := event.Validate(); err != nil {
		return fmt.Errorf("invalid staff master data change audit event: %w", err)
	}
	return NewAppender(r.runtime, r.now).Append(ctx, event)
}
