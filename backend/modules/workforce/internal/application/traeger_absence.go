package application

import (
	"context"
	"log/slog"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The Abwesenheitsarten of a Träger (#4710, ADR 0089 section 10 with its
// addendum of 14.11.2026). The Personalverwaltung keeps them in the Träger
// transaction; afterwards Workforce carries each one into every school of
// the Träger, each in its own tenant transaction (ADR 0105). A school that
// fails is carried by the next change of the type; until then the list
// shows it as not carried.

var _ workforce.TraegerAbsenceTypes = (*TraegerStaff)(nil)

// ListAbsenceTypes lists the Träger's types with how each school carries
// them. It shows no person, so no access log entry is written.
func (t *TraegerStaff) ListAbsenceTypes(ctx context.Context, actor workforce.TraegerStaffActor) (workforce.TraegerAbsenceTypeList, error) {
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return workforce.TraegerAbsenceTypeList{}, err
	}
	list := workforce.TraegerAbsenceTypeList{Schools: schools, Types: []workforce.TraegerAbsenceType{}}
	var types []domain.TraegerAbsenceType
	err = t.ports.Runtime.WithinTraeger(ctx, actor.OrganizationID, func(ctx context.Context) error {
		release, err := t.store.TraegerStaffRelease(ctx, actor.OrganizationID)
		if err != nil || release == nil {
			return err
		}
		list.Release = publicRelease(*release)
		types, err = t.store.ListTraegerAbsenceTypes(ctx, actor.OrganizationID)
		return err
	})
	if err != nil || list.Release == nil {
		return list, err
	}
	carried, err := t.schoolAbsenceTypes(ctx, schools)
	if err != nil {
		return workforce.TraegerAbsenceTypeList{}, err
	}
	for _, value := range types {
		list.Types = append(list.Types, publicTraegerAbsenceType(value, schools, carried))
	}
	return list, nil
}

// CreateAbsenceType stores a new type and carries it into every school.
func (t *TraegerStaff) CreateAbsenceType(ctx context.Context, actor workforce.TraegerStaffActor, input workforce.TraegerAbsenceTypeInput) (workforce.TraegerAbsenceType, error) {
	value := traegerAbsenceTypeOf(actor.OrganizationID, 0, input)
	if reason := value.TraegerAbsenceTypeReason(); reason != "" {
		return workforce.TraegerAbsenceType{}, &workforce.TraegerAbsenceTypeError{Reason: reason}
	}
	value.IsActive = true
	err := t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		value, err = t.store.SaveTraegerAbsenceType(ctx, value)
		return err
	})
	if err != nil {
		return workforce.TraegerAbsenceType{}, err
	}
	return t.carryAbsenceType(ctx, actor, value)
}

// UpdateAbsenceType rewrites a type and carries it into every school. A new
// name needs a type no school has booked yet: bookings keep their name.
func (t *TraegerStaff) UpdateAbsenceType(ctx context.Context, actor workforce.TraegerStaffActor, id int64, input workforce.TraegerAbsenceTypeInput) (workforce.TraegerAbsenceType, error) {
	value := traegerAbsenceTypeOf(actor.OrganizationID, id, input)
	if reason := value.TraegerAbsenceTypeReason(); reason != "" {
		return workforce.TraegerAbsenceType{}, &workforce.TraegerAbsenceTypeError{Reason: reason}
	}
	var current domain.TraegerAbsenceType
	err := t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		current, err = t.store.FindTraegerAbsenceType(ctx, actor.OrganizationID, id, false)
		return err
	})
	if err != nil {
		return workforce.TraegerAbsenceType{}, err
	}
	if current.Name != value.Name {
		if err := t.refuseRenameOfBookedType(ctx, actor.OrganizationID, id); err != nil {
			return workforce.TraegerAbsenceType{}, err
		}
	}
	err = t.released(ctx, actor, func(ctx context.Context) error {
		if _, err := t.store.FindTraegerAbsenceType(ctx, actor.OrganizationID, id, true); err != nil {
			return err
		}
		value, err = t.store.SaveTraegerAbsenceType(ctx, value)
		return err
	})
	if err != nil {
		return workforce.TraegerAbsenceType{}, err
	}
	return t.carryAbsenceType(ctx, actor, value)
}

func traegerAbsenceTypeOf(organizationID, id int64, input workforce.TraegerAbsenceTypeInput) domain.TraegerAbsenceType {
	return domain.TraegerAbsenceType{
		ID: id, OrganizationID: organizationID, Name: input.Name, AllowanceEnabled: input.AllowanceEnabled,
		StandardDays: input.StandardDays, CarryoverUntil: input.CarryoverUntil, Requestable: input.Requestable, IsActive: input.IsActive,
	}
}

// refuseRenameOfBookedType reads every school before the Träger writes:
// a school that booked the type keeps its name.
func (t *TraegerStaff) refuseRenameOfBookedType(ctx context.Context, organizationID, id int64) error {
	schools, err := t.ports.Schools.TraegerSchools(ctx, organizationID)
	if err != nil {
		return err
	}
	for _, school := range schools {
		err := t.ports.Runtime.WithinSchool(ctx, school.ID.Int64(), func(ctx context.Context) error {
			row, found, err := t.carriedRow(ctx, id)
			if err != nil || !found {
				return err
			}
			inUse, err := t.store.SchoolAbsenceTypeInUse(ctx, row.ID)
			if err == nil && inUse {
				return workforce.ErrTraegerAbsenceTypeInUse
			}
			return err
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func (t *TraegerStaff) carriedRow(ctx context.Context, traegerTypeID int64) (domain.StaffAbsenceType, bool, error) {
	rows, err := t.store.SchoolAbsenceTypes(ctx)
	if err != nil {
		return domain.StaffAbsenceType{}, false, err
	}
	for _, row := range rows {
		if row.TraegerAbsenceTypeID != nil && *row.TraegerAbsenceTypeID == traegerTypeID {
			return row, true, nil
		}
	}
	return domain.StaffAbsenceType{}, false, nil
}

// carryAbsenceType writes value into every school of the Träger and returns
// the type as the schools now carry it.
func (t *TraegerStaff) carryAbsenceType(ctx context.Context, actor workforce.TraegerStaffActor, value domain.TraegerAbsenceType) (workforce.TraegerAbsenceType, error) {
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return workforce.TraegerAbsenceType{}, err
	}
	carried := make(map[int64][]domain.StaffAbsenceType, len(schools))
	for _, school := range schools {
		// A school that fails keeps its previous state and shows as not
		// carried; the next change of the type tries it again.
		err := t.ports.Runtime.WithinSchool(ctx, school.ID.Int64(), func(ctx context.Context) error {
			if err := t.carryInto(ctx, value); err != nil {
				return err
			}
			rows, err := t.store.SchoolAbsenceTypes(ctx)
			carried[school.ID.Int64()] = rows
			return err
		})
		if err != nil {
			slog.Default().WarnContext(ctx, "traeger absence type not carried into school",
				"organization_id", actor.OrganizationID,
				"school_id", school.ID,
				"traeger_absence_type_id", value.ID,
				"error", err.Error(),
			)
		}
	}
	return publicTraegerAbsenceType(value, schools, carried), nil
}

// carryInto writes the type into the school of the tenant transaction: into
// the row that already carries it, else into the school's own type of the
// same name (taken over once, with its bookings and wage type), else into a
// new row.
func (t *TraegerStaff) carryInto(ctx context.Context, value domain.TraegerAbsenceType) error {
	rows, err := t.store.SchoolAbsenceTypes(ctx)
	if err != nil {
		return err
	}
	target := int64(0)
	for _, row := range rows {
		if row.TraegerAbsenceTypeID != nil && *row.TraegerAbsenceTypeID == value.ID {
			target = row.ID
			break
		}
		if row.TraegerAbsenceTypeID == nil && strings.EqualFold(strings.TrimSpace(row.Name), value.Name) {
			target = row.ID
		}
	}
	return t.store.CarryTraegerAbsenceType(ctx, target, value)
}

// schoolAbsenceTypes reads the absence types of every school, each in its
// own tenant transaction.
func (t *TraegerStaff) schoolAbsenceTypes(ctx context.Context, schools []workforce.TraegerStaffSchool) (map[int64][]domain.StaffAbsenceType, error) {
	result := make(map[int64][]domain.StaffAbsenceType, len(schools))
	for _, school := range schools {
		err := t.ports.Runtime.WithinSchool(ctx, school.ID.Int64(), func(ctx context.Context) error {
			rows, err := t.store.SchoolAbsenceTypes(ctx)
			result[school.ID.Int64()] = rows
			return err
		})
		if err != nil {
			return nil, err
		}
	}
	return result, nil
}

func publicTraegerAbsenceType(value domain.TraegerAbsenceType, schools []workforce.TraegerStaffSchool, carried map[int64][]domain.StaffAbsenceType) workforce.TraegerAbsenceType {
	result := workforce.TraegerAbsenceType{
		ID: ident.ID(value.ID), Name: value.Name, AllowanceEnabled: value.AllowanceEnabled, StandardDays: value.StandardDays,
		CarryoverUntil: value.CarryoverUntil, Requestable: value.Requestable, IsActive: value.IsActive,
		Schools: make([]workforce.TraegerAbsenceTypeSchool, 0, len(schools)), CreatedAt: value.CreatedAt,
	}
	for _, school := range schools {
		entry := workforce.TraegerAbsenceTypeSchool{SchoolID: school.ID, SchoolName: school.Name}
		for _, row := range carried[school.ID.Int64()] {
			if row.TraegerAbsenceTypeID != nil && *row.TraegerAbsenceTypeID == value.ID {
				entry.Carried, entry.Offered, entry.SchoolLimitDays = true, row.Offered, row.SchoolLimitDays
				break
			}
		}
		result.Schools = append(result.Schools, entry)
	}
	return result
}

// errNoAbsenceAllowance refuses days for a type without a Kontingent.
var errNoAbsenceAllowance = &workforce.InvalidAbsenceAllowanceError{Reason: "Diese Abwesenheitsart hat kein Kontingent."}
