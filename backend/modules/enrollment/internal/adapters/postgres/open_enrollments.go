package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// OpenEnrollmentStore counts the children of the online enrollment that wait
// for a decision, for the Träger dashboard (#4675). It reads in the Träger
// projection's administrative transaction, which reads across schools; the
// statement filters on the given schools.
type OpenEnrollmentStore struct{}

var _ enrollment.OpenEnrollments = OpenEnrollmentStore{}

// NewOpenEnrollmentStore builds the store.
func NewOpenEnrollmentStore() OpenEnrollmentStore { return OpenEnrollmentStore{} }

// enrollmentDemandQuery counts, per school, the children waiting for a
// decision (?1) and those on the waitlist (?2) of requests that are not
// withdrawn.
const enrollmentDemandQuery = `SELECT request_child.tenant_id,
		COUNT(*) FILTER (WHERE request_child.status IN (?1)) AS open,
		COUNT(*) FILTER (WHERE request_child.status = ?2) AS waitlisted
	FROM enrollment.request_children AS request_child
	JOIN enrollment.requests AS request
		ON request.id = request_child.request_id AND request.tenant_id = request_child.tenant_id
	WHERE request_child.tenant_id = ANY(?0) AND (request_child.status IN (?1) OR request_child.status = ?2)
		AND request.withdrawn_at IS NULL
	GROUP BY request_child.tenant_id`

type enrollmentDemandRow struct {
	TenantID   int64 `bun:"tenant_id"`
	Open       int   `bun:"open"`
	Waitlisted int   `bun:"waitlisted"`
}

// OpenEnrollmentChildrenByTenant counts the waiting children of each school.
func (store OpenEnrollmentStore) OpenEnrollmentChildrenByTenant(ctx context.Context, schools []int64) (map[int64]int, error) {
	open, _, err := store.EnrollmentDemandByTenant(ctx, schools)
	return open, err
}

// EnrollmentDemandByTenant counts the waiting and the waitlisted children of
// each school; a school without such a child is missing from both maps, a
// count of 0 from its map.
func (OpenEnrollmentStore) EnrollmentDemandByTenant(ctx context.Context, schools []int64) (map[int64]int, map[int64]int, error) {
	open, waitlisted := map[int64]int{}, map[int64]int{}
	if len(schools) == 0 {
		return open, waitlisted, nil
	}
	if !tenant.IsAdminTx(ctx) {
		return nil, nil, errors.New("enrollment postgres: open enrollments need the administrative transaction")
	}
	db, err := NewDatabase()(ctx)
	if err != nil {
		return nil, nil, err
	}
	var rows []enrollmentDemandRow
	if err := db.NewRaw(enrollmentDemandQuery, pgdialect.Array(schools), bun.List(enrollment.OpenEnrollmentChildStatuses()), enrollment.ChildStatusWaitlisted).Scan(ctx, &rows); err != nil {
		return nil, nil, fmt.Errorf("enrollment postgres: open enrollments: %w", err)
	}
	for _, row := range rows {
		if row.Open > 0 {
			open[row.TenantID] = row.Open
		}
		if row.Waitlisted > 0 {
			waitlisted[row.TenantID] = row.Waitlisted
		}
	}
	return open, waitlisted, nil
}
