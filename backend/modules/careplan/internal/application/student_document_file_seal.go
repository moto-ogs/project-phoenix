package application

import (
	"context"
	"errors"

	careplan "github.com/moto-ogs/project-phoenix/modules/careplan"
)

// StudentDocumentFileSealStore locks one bounded batch of live documents of
// the given categories of a school, ordered by ID, and visits each stored name.
type StudentDocumentFileSealStore interface {
	LockSealableStudentDocuments(ctx context.Context, schoolID, afterID int64, limit int, categories []string,
		visit func(storedName, category string) (bool, error)) (careplan.StudentDocumentFileSealResult, error)
}

// StudentDocumentFileSeal is the maintenance backfill and rekey of the sealed
// child health document files (#3840).
type StudentDocumentFileSeal struct{ store StudentDocumentFileSealStore }

func NewStudentDocumentFileSeal(store StudentDocumentFileSealStore) *StudentDocumentFileSeal {
	if store == nil {
		panic("student document file seal requires a store")
	}
	return &StudentDocumentFileSeal{store: store}
}

func (s *StudentDocumentFileSeal) Batch(ctx context.Context, schoolID, afterID int64, limit int, reseal careplan.StudentDocumentFileReseal) (careplan.StudentDocumentFileSealResult, error) {
	if schoolID <= 0 || afterID < 0 || limit < 1 || limit > 1000 || reseal == nil {
		return careplan.StudentDocumentFileSealResult{}, errors.New("student document file seal requires school, nonnegative cursor, batch size 1..1000 and the object store")
	}
	var categories []string
	for _, category := range careplan.StudentDocumentCategories {
		if careplan.StudentDocumentKeyRing(category) != "" {
			categories = append(categories, category)
		}
	}
	return s.store.LockSealableStudentDocuments(ctx, schoolID, afterID, limit, categories, func(storedName, category string) (bool, error) {
		changed, err := reseal(ctx, storedName, careplan.StudentDocumentKeyRing(category))
		if err != nil {
			return false, errors.New("student document file seal: a stored file could not be sealed")
		}
		return changed, nil
	})
}
