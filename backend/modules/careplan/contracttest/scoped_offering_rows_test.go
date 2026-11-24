package contracttest_test

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	enrollmentTest "github.com/moto-ogs/project-phoenix/modules/enrollment/enrollmenttest"
	offeringContract "github.com/moto-ogs/project-phoenix/modules/enrollment/offeringcontract"
)

// scopedCareOfferingRows is the fixture root around catalog administration,
// including its cross-owner validation reads before its first mutation.
type scopedCareOfferingRows struct {
	*enrollmentTest.CareOfferingRows
}

func newScopedOfferingRows(catalog careplan.CareOfferingCatalog) *scopedCareOfferingRows {
	return &scopedCareOfferingRows{enrollmentTest.NewCareOfferingRows(catalog)}
}
func (r *scopedCareOfferingRows) Create(ctx context.Context, row *offeringContract.CareOfferingRecord) (*offeringContract.CareOfferingRecord, error) {
	return fixtureEnrollmentQuery(ctx, func(txCtx context.Context) (*offeringContract.CareOfferingRecord, error) {
		return r.CareOfferingRows.Create(txCtx, row)
	})
}

// Update saves row over the version a read of the stored offering answers
// right before, as the editor sends it (ADR 0311).
func (r *scopedCareOfferingRows) Update(ctx context.Context, row *offeringContract.CareOfferingRecord) error {
	stored, err := r.GetByID(ctx, row.ID)
	if err != nil {
		return err
	}
	return r.UpdateRead(ctx, row, stored.Version)
}

// UpdateRead saves row over the version the caller read.
func (r *scopedCareOfferingRows) UpdateRead(ctx context.Context, row *offeringContract.CareOfferingRecord, version string) error {
	return fixtureEnrollmentCommand(ctx, func(txCtx context.Context) error { return r.CareOfferingRows.Update(txCtx, row, version) })
}
func (r *scopedCareOfferingRows) Delete(ctx context.Context, id int64) error {
	return fixtureEnrollmentCommand(ctx, func(txCtx context.Context) error { return r.CareOfferingRows.Delete(txCtx, id) })
}
func (r *scopedCareOfferingRows) ListByPhase(ctx context.Context, id int64) ([]*offeringContract.CareOfferingRecord, error) {
	return fixtureEnrollmentQuery(ctx, func(txCtx context.Context) ([]*offeringContract.CareOfferingRecord, error) {
		return r.CareOfferingRows.ListByPhase(txCtx, id)
	})
}
func (r *scopedCareOfferingRows) GetByID(ctx context.Context, id int64) (*offeringContract.CareOfferingRecord, error) {
	return fixtureEnrollmentQuery(ctx, func(txCtx context.Context) (*offeringContract.CareOfferingRecord, error) {
		return r.CareOfferingRows.GetByID(txCtx, id)
	})
}
func (r *scopedCareOfferingRows) Clone(ctx context.Context, source, target int64) (*offeringContract.CareOfferingRecord, error) {
	return fixtureEnrollmentQuery(ctx, func(txCtx context.Context) (*offeringContract.CareOfferingRecord, error) {
		return r.CareOfferingRows.Clone(txCtx, source, target)
	})
}
