package planning

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// CategoryLinker syncs the optional Kategorie↔Schichtart mapping. The FK
// lives on activities.categories, so the write belongs to the Timetable
// owner; a nil linker leaves every mapping untouched. expected carries the
// link token per category the form read (ADR 0311); the administration
// always passes a map, nil skips the check for internal callers.
type CategoryLinker func(ctx context.Context, shiftTypeID int64, categoryIDs []int64, expected map[int64]string) error

type shiftTypeAdministration struct {
	types  ShiftTypeService
	linker CategoryLinker
}

// NewShiftTypeAdministration binds the /api/shift-types capability to the
// retained shift type service and the timetable category linker.
func NewShiftTypeAdministration(types ShiftTypeService, linker CategoryLinker) workforce.ShiftTypeAdministration {
	if types == nil {
		panic("shift type administration: shift type service is required")
	}
	return shiftTypeAdministration{types: types, linker: linker}
}

func (a shiftTypeAdministration) ListShiftTypes(ctx context.Context) ([]workforce.ShiftType, error) {
	types, err := a.types.ListShiftTypes(ctx)
	if err != nil {
		return nil, mapShiftTypeError(err)
	}
	return shiftTypesToCapability(types), nil
}

func (a shiftTypeAdministration) CreateShiftType(ctx context.Context, input workforce.ShiftTypeInput) (workforce.ShiftType, error) {
	shiftType := shiftTypeInputToModel(input)
	if input.IsActive == nil {
		shiftType.IsActive = true
	}
	saved, err := a.types.CreateShiftType(ctx, shiftType)
	if err != nil {
		return workforce.ShiftType{}, mapShiftTypeError(err)
	}
	// Linking a category moves it from the type it was linked to: the form
	// read that link with the category list and sends its token, like an
	// edit (ADR 0311).
	if err := a.syncCategoryLinks(ctx, saved.ID, input.CategoryIDs, expectedCategoryLinks(input)); err != nil {
		return workforce.ShiftType{}, err
	}
	return shiftTypeToCapability(saved), nil
}

func (a shiftTypeAdministration) CreateDefaultShiftTypes(ctx context.Context) ([]workforce.ShiftType, error) {
	types, err := a.types.CreateDefaultShiftTypes(ctx)
	if err != nil {
		return nil, mapShiftTypeError(err)
	}
	return shiftTypesToCapability(types), nil
}

// UpdateShiftType preserves the stored active flag when the client omitted
// it, so a rename cannot silently reactivate a retired type. The type and
// the links it changes are written only over what its editor read (ADR
// 0311): the type's version, and the link token of each category whose
// link the write changes.
func (a shiftTypeAdministration) UpdateShiftType(ctx context.Context, input workforce.ShiftTypeInput) (workforce.ShiftType, error) {
	shiftType := shiftTypeInputToModel(input)
	if input.IsActive == nil {
		existing, err := a.types.GetShiftType(ctx, input.ID)
		if err != nil {
			return workforce.ShiftType{}, mapShiftTypeError(err)
		}
		shiftType.IsActive = existing.IsActive
	}
	saved, err := a.types.UpdateShiftType(ctx, shiftType, input.ExpectedVersion)
	if err != nil {
		return workforce.ShiftType{}, mapShiftTypeError(err)
	}
	if err := a.syncCategoryLinks(ctx, saved.ID, input.CategoryIDs, expectedCategoryLinks(input)); err != nil {
		return workforce.ShiftType{}, err
	}
	return shiftTypeToCapability(saved), nil
}

// DeleteShiftType archives a type planned shifts or series still carry and
// deletes an unused one (#6845). An archived type keeps its category
// mapping like every other reference; a deleted one loses it through the
// FK.
func (a shiftTypeAdministration) DeleteShiftType(ctx context.Context, id int64) (workforce.ShiftTypeRemoval, error) {
	removal, err := a.types.DeleteShiftType(ctx, id)
	return removal, mapShiftTypeError(err)
}

// expectedCategoryLinks is never nil: a nil map would skip the link check,
// and a write naming categories always changes links its form read.
func expectedCategoryLinks(input workforce.ShiftTypeInput) map[int64]string {
	if input.ExpectedCategoryLinks == nil {
		return map[int64]string{}
	}
	return input.ExpectedCategoryLinks
}

// syncCategoryLinks applies the optional mapping after a write. A nil set
// (field omitted) leaves the mapping untouched; a present set, including an
// empty one, replaces it. It runs in the same tenant transaction as the
// shift-type write, so the caller must roll the request back when unknown
// category ids reject it.
func (a shiftTypeAdministration) syncCategoryLinks(ctx context.Context, shiftTypeID int64, categoryIDs []int64, expected map[int64]string) error {
	if categoryIDs == nil || a.linker == nil {
		return nil
	}
	if err := a.linker(ctx, shiftTypeID, categoryIDs, expected); err != nil {
		if errors.Is(err, timetable.ErrUnknownCategoryIDs) {
			return &capabilityError{kind: workforce.ErrShiftTypeCategoryUnknown, cause: err}
		}
		return err
	}
	return nil
}

func shiftTypeInputToModel(input workforce.ShiftTypeInput) *workforce.ShiftTypeRecord {
	shiftType := &workforce.ShiftTypeRecord{Name: input.Name, Color: input.Color, Description: input.Description}
	shiftType.ID = input.ID
	if input.IsActive != nil {
		shiftType.IsActive = *input.IsActive
	}
	return shiftType
}

func shiftTypeToCapability(shiftType *workforce.ShiftTypeRecord) workforce.ShiftType {
	if shiftType == nil {
		return workforce.ShiftType{}
	}
	return workforce.ShiftType{
		ID: shiftType.ID, TenantID: shiftType.TenantID, Name: shiftType.Name, Color: shiftType.Color,
		Description: shiftType.Description, IsActive: shiftType.IsActive, ArchivedAt: shiftType.ArchivedAt, CreatedAt: shiftType.CreatedAt, UpdatedAt: shiftType.UpdatedAt,
	}
}

func shiftTypesToCapability(types []*workforce.ShiftTypeRecord) []workforce.ShiftType {
	result := make([]workforce.ShiftType, 0, len(types))
	for _, shiftType := range types {
		if shiftType == nil {
			continue
		}
		result = append(result, shiftTypeToCapability(shiftType))
	}
	return result
}

var shiftTypeErrorKinds = []struct {
	service    error
	capability error
}{
	{ErrShiftTypeNameTaken, workforce.ErrShiftTypeNameTaken},
	{ErrShiftTypeNotFound, workforce.ErrShiftTypeNotFound},
	{ErrShiftTypeInvalid, workforce.ErrInvalidShiftType},
}

func mapShiftTypeError(err error) error {
	if err == nil {
		return nil
	}
	for _, kind := range shiftTypeErrorKinds {
		if errors.Is(err, kind.service) {
			return &capabilityError{kind: kind.capability, cause: err}
		}
	}
	return err
}
