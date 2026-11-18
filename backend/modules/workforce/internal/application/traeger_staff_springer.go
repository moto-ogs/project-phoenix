package application

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
)

// The first block of a Springer at a school creates the employment there,
// and every block opens the Springer's access for its time (#7173, ADR
// 0089 section 9, ADR 0251). Both run in the tenant transaction of the
// blocking school, so a refused step undoes the block with them.

var errSpringerEmploymentsUnbound = errors.New("workforce: the Springer employments are not bound")

// employSpringer gives the Springer of a new block the employment and the
// access at the school. The identity read locks the record first, so two
// first blocks of one Springer wait for each other and the second finds the
// employment of the first. A regular Einsatzort and a Springer without an
// account get no employment (ADR 0251 points 3 and 8).
func (t *TraegerStaff) employSpringer(ctx context.Context, block domain.PoolBlock, actor workforce.SchoolPoolActor) error {
	identity, found, err := t.store.PoolSpringerIdentity(ctx, block.RecordID)
	if err != nil {
		return err
	}
	if !found {
		return workforce.ErrPoolSpringerNotFound
	}
	if identity.RegularSite() || identity.AccountID <= 0 {
		return nil
	}
	if t.ports.Springers == nil {
		return errSpringerEmploymentsUnbound
	}
	startsAt, endsAt, err := domain.PoolAccessWindow(block.Date, block.Start, block.End)
	if err != nil {
		return errors.Join(workforce.ErrPoolBlockInvalid, err)
	}
	staffID, err := t.ports.Springers.EmploySpringer(ctx, workforce.SpringerEmploymentRequest{
		AccountID: identity.AccountID, FirstName: identity.FirstName, LastName: identity.LastName,
		BlockID: block.ID, StartsAt: startsAt, EndsAt: endsAt,
	})
	if err != nil {
		return err
	}
	if err := t.store.LinkPoolEmployment(ctx, block.RecordID, staffID, actor.AccountID); err != nil {
		return err
	}
	// A block after the last one resumes the former employment the pool
	// created (#7197, ADR 0021): the trail shows it beside its end.
	if identity.ViaPool && !identity.MembershipLive && identity.MembershipID == staffID {
		return t.store.RecordPoolResumed(ctx, block.RecordID, actor.AccountID)
	}
	return nil
}

// endSpringerAccess ends the access of a lifted block in the tenant
// transaction of its school. A block that opened no access is no error.
func (t *TraegerStaff) endSpringerAccess(ctx context.Context, blockID int64) error {
	if t.ports.Springers == nil {
		return errSpringerEmploymentsUnbound
	}
	return t.ports.Springers.EndSpringerAccess(ctx, blockID)
}
