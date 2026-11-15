package api

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/http/traegerstaff"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
)

// mountTraegerStaffRoutes serves the Personalstamm of ADR 0089 (#4705) at
// /traeger/staff-records, its Nachweise (#4707) at /traeger/staff-proofs and
// the Abwesenheitsarten of the Träger (#4710) at /traeger/absence-types and
// the Einsatzplanung (#4708) at /traeger/staff-planning and the
// Vertretungspool (#4709) at /traeger/staff-pool (the school's side at
// /api/staff-pool) behind the Träger
// right „Personal“, over the personnel record staffAdmin the root built for
// the schools and the Dienstplan of the schools.
func mountTraegerStaffRoutes(root, tenant chi.Router, staffAdmin *workforce.StaffAdmin, months workforce.TraegerStaffMonths, organizations HolidayOrganizations,
	persons TraegerPersons, membership TraegerStaff, accessLog owners.DataAccessAppender, sites workforce.TraegerShiftSites,
	identity identityaccess.Owner,
) error {
	if staffAdmin == nil || months == nil {
		return errors.New("traeger staff records: the personnel record and the school months are required")
	}
	springers, err := springerAccessOf(identity)
	if err != nil {
		return err
	}
	collaborators := workforce.TraegerStaffPorts{
		Schools:     traegerStaffSchools{organizations: organizations},
		Employments: traegerSchoolEmployments{staff: membership},
		Persons:     traegerSchoolPersons{persons: persons},
		Access:      traegerStaffAccessLog{log: accessLog},
		Runtime:     traegerDocumentRuntime{},
		// The import log names colleagues like the export protocol (#4693).
		Names:  parentBillingActorNames{names: owners.NewTraegerMemberNames()},
		Months: months,
		// The first block employs a Springer at the school (#7173).
		Springers: traegerSpringerEmployments{access: springers},
	}
	records := staffAdmin.TraegerStaffRecords(collaborators)
	requireStaff := common.RequiresPermission(identityaccess.TraegerRightStaffManage)
	absences := staffAdmin.TraegerAbsenceTypes(collaborators)
	// The Personalstamm serves the Stundenkonto over the same records (#4711).
	timeAccounts, ok := records.(workforce.TraegerStaffTimeAccounts)
	if !ok {
		return errors.New("traeger staff records: the Personalstamm serves no Stundenkonto")
	}
	resource := traegerstaff.NewRecordsResource(records, staffAdmin.TraegerStaffContracts(collaborators), absences, timeAccounts, requireStaff)
	root.Mount("/traeger/staff-records", resource.TraegerRouter(ProtectedTraegerRoutes))
	// The Personalstamm serves its Nachweise over the same records (#4707).
	proofs, ok := records.(workforce.TraegerStaffProofs)
	if !ok {
		return errors.New("traeger staff records: the Personalstamm serves no Nachweise")
	}
	root.Mount("/traeger/staff-proofs", traegerstaff.NewProofsResource(proofs, requireStaff).TraegerRouter(ProtectedTraegerRoutes))
	// The Personal-Import fills the same records from a file (#4724).
	imports, ok := records.(workforce.TraegerStaffImports)
	if !ok {
		return errors.New("traeger staff records: the Personalstamm serves no Personal-Import")
	}
	root.Mount("/traeger/staff-record-imports", traegerstaff.NewImportsResource(imports, requireStaff).TraegerRouter(ProtectedTraegerRoutes))
	// The Träger's Abwesenheitsarten and Kontingente (#4710).
	root.Mount("/traeger/absence-types", traegerstaff.NewAbsenceTypesResource(absences, requireStaff).TraegerRouter(ProtectedTraegerRoutes))
	// The Einsatzplanung over all Einsatzorte (#4708).
	planning := staffAdmin.TraegerStaffPlanning(collaborators, sites)
	root.Mount("/traeger/staff-planning", traegerstaff.NewPlanningResource(planning, requireStaff).TraegerRouter(ProtectedTraegerRoutes))
	// The Vertretungspool over the same records (#4709): the Träger's view
	// and, under /api with the right that plans shifts, the school's.
	pool, ok := records.(workforce.TraegerStaffPool)
	schoolPool, schoolOK := records.(workforce.SchoolStaffPool)
	if !ok || !schoolOK {
		return errors.New("traeger staff records: the Personalstamm serves no Vertretungspool")
	}
	root.Mount("/traeger/staff-pool", traegerstaff.NewTraegerPoolResource(pool, requireStaff).TraegerRouter(ProtectedTraegerRoutes))
	tenant.Mount("/staff-pool", traegerstaff.NewSchoolPoolResource(schoolPool,
		common.RequiresPermission(permissions.TimeTrackingManage)).Router(ProtectedTenantRoutes))
	return nil
}

// traegerStaffSchools lists the undeleted schools of the Träger by name.
type traegerStaffSchools struct {
	organizations HolidayOrganizations
}

func (s traegerStaffSchools) TraegerSchools(ctx context.Context, organizationID int64) ([]workforce.TraegerStaffSchool, error) {
	schools, err := s.organizations.ListSchoolsByOrganization(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	result := make([]workforce.TraegerStaffSchool, 0, len(schools))
	for _, school := range schools {
		if !school.IsDeleted() {
			result = append(result, workforce.TraegerStaffSchool{ID: school.ID, Name: school.Name})
		}
	}
	slices.SortFunc(result, func(a, b workforce.TraegerStaffSchool) int {
		if order := strings.Compare(a.Name, b.Name); order != 0 {
			return order
		}
		return int(a.ID - b.ID)
	})
	return result, nil
}

// traegerSchoolEmployments reads the live employments of the school of the
// tenant transaction from School Membership. External caregivers are no
// staff of the Träger (ADR 0089 section 1) and stay out.
type traegerSchoolEmployments struct {
	staff TraegerStaff
}

func (s traegerSchoolEmployments) SchoolEmployments(ctx context.Context, staffIDs []int64) ([]workforce.TraegerSchoolEmployment, error) {
	members, err := s.staff.ListStaff(ctx, schoolmembership.StaffFilter{IDs: staffIDs})
	if err != nil {
		return nil, err
	}
	result := make([]workforce.TraegerSchoolEmployment, 0, len(members))
	for _, member := range members {
		if member.IsDeleted() || member.HasExternalCaregiverRecord {
			continue
		}
		result = append(result, workforce.TraegerSchoolEmployment{StaffID: member.ID, PersonID: member.PersonID, PersonnelNumber: member.PersonnelNumber})
	}
	return result, nil
}

// traegerSchoolPersons reads the persons behind the employments from the
// People Directory.
type traegerSchoolPersons struct {
	persons TraegerPersons
}

func (p traegerSchoolPersons) SchoolPersons(ctx context.Context, personIDs []int64) ([]workforce.TraegerSchoolPerson, error) {
	persons, err := p.persons.ListPersonsByID(ctx, personIDs)
	if err != nil {
		return nil, err
	}
	result := make([]workforce.TraegerSchoolPerson, 0, len(persons))
	for _, person := range persons {
		result = append(result, workforce.TraegerSchoolPerson{
			PersonID: person.ID, AccountID: person.AccountID, FirstName: person.FirstName, LastName: person.LastName, Birthday: person.Birthday,
		})
	}
	return result, nil
}

// traegerStaffAccessLog writes a read of the Personalverwaltung into the
// access log of the school of the tenant transaction (ADR 0084 section 7).
type traegerStaffAccessLog struct {
	log owners.DataAccessAppender
}

func (l traegerStaffAccessLog) RecordTraegerStaffAccess(ctx context.Context, access workforce.TraegerStaffAccess) error {
	resource := auditModels.ResourceTypeTraegerStaffRecords
	if access.View == workforce.TraegerStaffViewFinancial || access.View == workforce.TraegerStaffViewFinancialReveal {
		resource = auditModels.ResourceTypeTraegerStaffFinancial
	}
	now := time.Now()
	metadata := map[string]any{
		"channel": "traeger_portal", "organization_id": access.OrganizationID, "view": access.View, "rows": access.Rows,
		"staff_ids": access.StaffIDs, "staff_record_id": access.RecordID,
	}
	if len(access.RecordIDs) > 0 {
		metadata["staff_record_ids"] = access.RecordIDs
	}
	return l.log.Create(ctx, &auditModels.DataAccessLog{
		ActorAccountID: access.AccountID, ActorRole: traegerAccessActorRole, ResourceType: resource,
		RangeStart: now, RangeEnd: now, Metadata: metadata,
	})
}

// traegerSpringerEmployments employs a Springer at the blocking school
// through Identity & Access, in the school's tenant transaction (ADR 0249).
type traegerSpringerEmployments struct {
	access identityaccess.SpringerAccess
}

func (e traegerSpringerEmployments) EmploySpringer(ctx context.Context, request workforce.SpringerEmploymentRequest) (int64, error) {
	employment, err := e.access.GrantSpringerWindow(ctx, identityaccess.SpringerWindow{
		AccountID: request.AccountID, FirstName: request.FirstName, LastName: request.LastName,
		BlockID: request.BlockID, StartsAt: request.StartsAt, EndsAt: request.EndsAt,
	})
	return employment.StaffID, err
}

func (e traegerSpringerEmployments) EndSpringerAccess(ctx context.Context, blockID int64) error {
	return e.access.EndSpringerWindow(ctx, blockID)
}

// springerAccessOf reads the Springer access, a capability of its own beside
// the Identity & Access facade (ADR 0249), like the pool beside the records.
func springerAccessOf(identity identityaccess.Owner) (identityaccess.SpringerAccess, error) {
	springers, ok := identity.(identityaccess.SpringerAccess)
	if !ok {
		return nil, errors.New("traeger staff records: Identity & Access serves no Springer access")
	}
	return springers, nil
}
