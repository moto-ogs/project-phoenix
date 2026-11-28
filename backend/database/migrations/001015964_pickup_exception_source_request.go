package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const pickupExceptionSourceRequestVersion = "1.15.964"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     pickupExceptionSourceRequestVersion,
		Description: "Genehmigte Abholzeit behält den Verweis auf ihre Elternanfrage (#8209)",
		DependsOn: []string{
			traegerExportRecipientsVersion,    // the newest migration on development (1.15.963)
			careScheduleChangeRequestsVersion, // the requests the column points at
		},
	})
	Migrations.MustRegister(pickupExceptionSourceRequestUp, pickupExceptionSourceRequestDown)
}

// pickupExceptionSourceRequestUpSQL lets a pickup time approved from a
// parent request keep that request (#8209). The approver and the moment of
// the decision stay on the request and are joined at read time, so the
// exception names its origin without copying it.
//
//   - NULL for a time the school entered itself. A later staff edit of the
//     day clears it: the time is then the school's own.
//   - No foreign key: a deleted request only takes the note of origin with
//     it, the read finds nothing and shows a plain exception. Without a key
//     the table's incoming-key fingerprint of the school erasure stays as it
//     is; both tables are erased per school.
const pickupExceptionSourceRequestUpSQL = `
ALTER TABLE schedule.student_pickup_exceptions ADD COLUMN source_request_id BIGINT;
COMMENT ON COLUMN schedule.student_pickup_exceptions.source_request_id IS
	'The approved parent request (schedule.care_schedule_change_requests) this pickup time came from (#8209); NULL for a time the school entered.';
`

const pickupExceptionSourceRequestDownSQL = `ALTER TABLE schedule.student_pickup_exceptions DROP COLUMN IF EXISTS source_request_id;`

func pickupExceptionSourceRequestUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, pickupExceptionSourceRequestUpSQL); err != nil {
		return fmt.Errorf("add the source request of pickup exceptions: %w", err)
	}
	return nil
}

func pickupExceptionSourceRequestDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, pickupExceptionSourceRequestDownSQL); err != nil {
		return fmt.Errorf("drop the source request of pickup exceptions: %w", err)
	}
	return nil
}
