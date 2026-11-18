package application

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// StaffDocumentFileSealStore locks one bounded batch of live documents of the
// given categories of a school, ordered by ID, and visits each stored name.
type StaffDocumentFileSealStore interface {
	LockSealableStaffDocuments(ctx context.Context, schoolID, afterID int64, limit int, categories []string,
		visit func(storedName, category string) (bool, error)) (workforce.StaffDocumentFileSealResult, error)
}

// StaffDocumentFileSeal is the maintenance backfill and rekey of the sealed
// staff document files (#3840): every live document whose category names a
// ring is brought onto that ring and its active key.
type StaffDocumentFileSeal struct{ store StaffDocumentFileSealStore }

func NewStaffDocumentFileSeal(store StaffDocumentFileSealStore) *StaffDocumentFileSeal {
	if store == nil {
		panic("staff document file seal requires a store")
	}
	return &StaffDocumentFileSeal{store: store}
}

func (s *StaffDocumentFileSeal) Batch(ctx context.Context, schoolID, afterID int64, limit int, reseal workforce.StaffDocumentFileReseal) (workforce.StaffDocumentFileSealResult, error) {
	if schoolID <= 0 || afterID < 0 || limit < 1 || limit > 1000 || reseal == nil {
		return workforce.StaffDocumentFileSealResult{}, errors.New("staff document file seal requires school, nonnegative cursor, batch size 1..1000 and the object store")
	}
	categories := []string{workforce.StaffDocumentCategoryAUBescheinigung, workforce.StaffDocumentCategoryLohnabrechnung}
	return s.store.LockSealableStaffDocuments(ctx, schoolID, afterID, limit, categories, func(storedName, category string) (bool, error) {
		changed, err := reseal(ctx, storedName, workforce.StaffDocumentKeyRing(category))
		if err != nil {
			return false, errors.New("staff document file seal: a stored file could not be sealed")
		}
		return changed, nil
	})
}
