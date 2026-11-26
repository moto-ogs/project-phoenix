package application

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership/internal/domain"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// FindStaffIDByPerson returns the live staff ID of a person from the
// membership row alone, without the Workforce employment half (#2753).
func (s *Service) FindStaffIDByPerson(ctx context.Context, personID int64) (int64, bool, error) {
	if personID <= 0 {
		return 0, false, invalid("person ID is required")
	}
	staff, err := s.findStaffMembershipByPerson(ctx, personID)
	if errors.Is(err, schoolmembership.ErrStaffNotFound) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return staff.ID, true, nil
}

// ResolveStaffIdentityByAccount runs the whole Account → Person → Staff →
// Teacher chain in one read of the context's tenant. It never takes the
// admin fallback: the identity read answers for one school, so a missing
// tenant is an error.
func (s *Service) ResolveStaffIdentityByAccount(ctx context.Context, accountID int64, persons schoolmembership.AccountPersons) (schoolmembership.StaffIdentity, error) {
	if accountID <= 0 {
		return schoolmembership.StaffIdentity{}, invalid("account ID is required")
	}
	if persons == nil {
		return schoolmembership.StaffIdentity{}, invalid("a person directory is required")
	}
	if _, err := tenant.TenantFromContext(ctx); err != nil {
		return schoolmembership.StaffIdentity{}, fmt.Errorf("school membership: staff identity: %w", err)
	}
	var identity schoolmembership.StaffIdentity
	err := s.runRead(ctx, "resolve_staff_identity", func(ctx context.Context, _ *domain.OperationStats) error {
		personID, found, err := persons.FindPersonIDByAccount(ctx, accountID)
		if err != nil {
			return err
		}
		if !found {
			identity = schoolmembership.StaffIdentity{Link: schoolmembership.StaffLinkNoPerson}
			return nil
		}
		identity, err = s.resolveStaffIdentity(ctx, personID)
		return err
	})
	if err != nil {
		return schoolmembership.StaffIdentity{}, err
	}
	return identity, nil
}

func (s *Service) resolveStaffIdentity(ctx context.Context, personID int64) (schoolmembership.StaffIdentity, error) {
	if personID <= 0 {
		return schoolmembership.StaffIdentity{}, invalid("person ID is required")
	}
	staff, err := s.findStaffMembershipByPerson(ctx, personID)
	if errors.Is(err, schoolmembership.ErrStaffNotFound) {
		return schoolmembership.StaffIdentity{Link: schoolmembership.StaffLinkNotStaff, PersonID: personID}, nil
	}
	if err != nil {
		return schoolmembership.StaffIdentity{}, err
	}
	teacher, err := s.FindTeacherByStaff(ctx, staff.ID)
	if errors.Is(err, schoolmembership.ErrTeacherNotFound) {
		return schoolmembership.StaffIdentity{Link: schoolmembership.StaffLinkStaff, PersonID: personID, StaffID: staff.ID}, nil
	}
	if err != nil {
		return schoolmembership.StaffIdentity{}, err
	}
	return schoolmembership.StaffIdentity{Link: schoolmembership.StaffLinkTeacher, PersonID: personID, StaffID: staff.ID, TeacherID: teacher.ID}, nil
}

// FindStaffClassesByPerson returns the live staff ID of a person and the
// school classes assigned to it, read together (#8155). The classes are
// trimmed, without empty ones and duplicates, in class order.
func (s *Service) FindStaffClassesByPerson(ctx context.Context, personID int64) (staffID int64, classes []string, found bool, err error) {
	if personID <= 0 {
		return 0, nil, false, invalid("person ID is required")
	}
	var raw []string
	err = s.runRead(ctx, "find_staff_classes_by_person", func(txCtx context.Context, stats *domain.OperationStats) error {
		var queryStats domain.OperationStats
		staffID, raw, found, queryStats, err = s.store.FindStaffClassesByPerson(txCtx, personID)
		stats.Add(queryStats)
		return err
	})
	if err != nil || !found {
		return 0, nil, false, err
	}
	return staffID, distinctClasses(raw), true, nil
}

// distinctClasses trims the classes and drops empty ones and repeats.
func distinctClasses(raw []string) []string {
	classes := make([]string, 0, len(raw))
	seen := make(map[string]bool, len(raw))
	for _, class := range raw {
		trimmed := strings.TrimSpace(class)
		key := strings.ToLower(trimmed)
		if trimmed == "" || seen[key] {
			continue
		}
		seen[key] = true
		classes = append(classes, trimmed)
	}
	return classes
}
