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
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/http/traegerstaff"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// mountTraegerStaffRoutes serves the Personalstamm of ADR 0089 (#4705) at
// /traeger/staff-records, its Nachweise (#4707) at /traeger/staff-proofs and
// the Abwesenheitsarten of the Träger (#4710) at /traeger/absence-types and
// the Einsatzplanung (#4708) at /traeger/staff-planning and the
// Vertretungspool (#4709) at /traeger/staff-pool (the school's side at
// /api/staff-pool) behind the Träger
// right „Personal“, over the personnel record staffAdmin the root built for
// the schools and the Dienstplan of the schools; today is the root's calendar
// day the Kontingente default their year to.
func mountTraegerStaffRoutes(root, tenant chi.Router, staffAdmin *workforce.StaffAdmin, months workforce.TraegerStaffMonths, organizations HolidayOrganizations,
	persons TraegerPersons, membership TraegerStaff, accessLog owners.DataAccessAppender, sites workforce.TraegerShiftSites,
	exports workforce.TraegerStaffExportSchool, settings TraegerBrandingSettings,
	identity identityaccess.Owner, today func() timezone.Date,
) error {
	if staffAdmin == nil || months == nil || exports == nil || settings == nil {
		return errors.New("traeger staff records: the personnel record, the school months and exports and the settings are required")
	}
	collaborators, err := traegerStaffCollaborators(months, organizations, persons, membership, accessLog, exports, settings, identity)
	if err != nil {
		return err
	}
	records := staffAdmin.TraegerStaffRecords(collaborators)
	requireStaff := common.RequiresPermission(identityaccess.TraegerRightStaffManage)
	absences := staffAdmin.TraegerAbsenceTypes(collaborators)
	// The Personalstamm serves the Stundenkonto over the same records (#4711).
	timeAccounts, ok := records.(workforce.TraegerStaffTimeAccounts)
	if !ok {
		return errors.New("traeger staff records: the Personalstamm serves no Stundenkonto")
	}
	hires, ok := records.(workforce.TraegerStaffHires)
	if !ok {
		return errors.New("traeger staff records: the Personalstamm hires nobody")
	}
	lists := traegerListRenderer(NewSimpleListRenderer())
	resource := traegerstaff.NewRecordsResource(records, staffAdmin.TraegerStaffContracts(collaborators), absences, timeAccounts, hires, requireStaff, lists, today)
	root.Mount("/traeger/staff-records", resource.TraegerRouter(ProtectedTraegerRoutes))
	// The Personalstamm serves its Nachweise over the same records (#4707).
	proofs, ok := records.(workforce.TraegerStaffProofs)
	if !ok {
		return errors.New("traeger staff records: the Personalstamm serves no Nachweise")
	}
	root.Mount("/traeger/staff-proofs", traegerstaff.NewProofsResource(proofs, requireStaff, lists).TraegerRouter(ProtectedTraegerRoutes))
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
	root.Mount("/traeger/staff-planning", traegerstaff.NewPlanningResource(planning, requireStaff, lists).TraegerRouter(ProtectedTraegerRoutes))
	// The payroll file and the time export over all schools (#4712).
	staffExports, ok := records.(workforce.TraegerStaffExports)
	if !ok {
		return errors.New("traeger staff records: the Personalstamm serves no exports")
	}
	root.Mount("/traeger/staff-exports", traegerstaff.NewExportsResource(staffExports, requireStaff).TraegerRouter(ProtectedTraegerRoutes))
	return mountTraegerStaffPool(root, tenant, records, requireStaff)
}

// traegerStaffCollaborators binds what the Personalstamm does not own: the
// schools, their employments and persons, the access log and the two
// transactions, and the commands that employ a Springer (#7173) and create a
// hired person at an Einsatzort (#7206).
func traegerStaffCollaborators(months workforce.TraegerStaffMonths, organizations HolidayOrganizations, persons TraegerPersons, membership TraegerStaff,
	accessLog owners.DataAccessAppender, exports workforce.TraegerStaffExportSchool, settings TraegerBrandingSettings, identity identityaccess.Owner,
) (workforce.TraegerStaffPorts, error) {
	springers, err := springerAccessOf(identity)
	if err != nil {
		return workforce.TraegerStaffPorts{}, err
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
		// The payroll file and the time export (#4712).
		Exports: exports,
		Payroll: traegerPayrollSettings{settings: settings},
	}
	// „Person einstellen“ creates person and employment at each Einsatzort
	// (#7206).
	if collaborators.HirePersons, collaborators.HireEmployments, err = schoolHiresOf(persons, membership); err != nil {
		return workforce.TraegerStaffPorts{}, err
	}
	return collaborators, nil
}

// mountTraegerStaffPool mounts the Vertretungspool over the same records
// (#4709): the Träger's view and, under /api with the right that plans
// shifts, the school's.
func mountTraegerStaffPool(root, tenant chi.Router, records workforce.TraegerStaffRecords, requireStaff common.Middleware) error {
	pool, ok := records.(workforce.TraegerStaffPool)
	schoolPool, schoolOK := records.(workforce.SchoolStaffPool)
	if !ok || !schoolOK {
		return errors.New("traeger staff records: the Personalstamm serves no Vertretungspool")
	}
	root.Mount("/traeger/staff-pool", traegerstaff.NewTraegerPoolResource(pool, requireStaff, traegerListRenderer(NewSimpleListRenderer())).TraegerRouter(ProtectedTraegerRoutes))
	tenant.Mount("/staff-pool", traegerstaff.NewSchoolPoolResource(schoolPool,
		common.RequiresPermission(permissions.TimeTrackingManage)).Router(ProtectedTenantRoutes))
	return nil
}

// traegerPayrollSettings reads the Träger values of the payroll file
// (#4712): its DATEV client and a Lohnart per category and kind, or the
// empty registry defaults.
type traegerPayrollSettings struct {
	settings TraegerBrandingSettings
}

func (s traegerPayrollSettings) TraegerPayrollSettings(ctx context.Context, organizationID int64) (workforce.TraegerPayrollSettings, error) {
	keys := []string{configModels.KeyTraegerPayrollConsultantNumber, configModels.KeyTraegerPayrollClientNumber}
	for _, category := range workforce.TraegerPayrollCategories {
		for _, kind := range workforce.TraegerContractKinds {
			keys = append(keys, configModels.TraegerPayrollWageTypeKey(category, kind))
		}
	}
	for _, category := range workforce.TraegerPayrollDayCategories {
		keys = append(keys, configModels.TraegerPayrollUnitKey(category))
	}
	texts, err := s.settings.TraegerTexts(ctx, organizationID, keys)
	if err != nil {
		return workforce.TraegerPayrollSettings{}, err
	}
	result := workforce.TraegerPayrollSettings{
		ConsultantNumber: texts[configModels.KeyTraegerPayrollConsultantNumber],
		ClientNumber:     texts[configModels.KeyTraegerPayrollClientNumber],
		WageTypes:        map[string]map[string]string{}, Units: map[string]string{},
	}
	for _, category := range workforce.TraegerPayrollCategories {
		result.WageTypes[category] = map[string]string{}
		for _, kind := range workforce.TraegerContractKinds {
			result.WageTypes[category][kind] = texts[configModels.TraegerPayrollWageTypeKey(category, kind)]
		}
	}
	for _, category := range workforce.TraegerPayrollDayCategories {
		result.Units[category] = texts[configModels.TraegerPayrollUnitKey(category)]
	}
	return result, nil
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
// through Identity & Access, in the school's tenant transaction (ADR 0251).
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
// the Identity & Access facade (ADR 0251), like the pool beside the records.
func springerAccessOf(identity identityaccess.Owner) (identityaccess.SpringerAccess, error) {
	springers, ok := identity.(identityaccess.SpringerAccess)
	if !ok {
		return nil, errors.New("traeger staff records: Identity & Access serves no Springer access")
	}
	return springers, nil
}

// traegerHirePersons creates the person of a hired person in the school of
// the tenant transaction (#7206) as a guarded command of the People
// Directory (ADR 0067). The person gets no account and no tag.
type traegerHirePersons struct {
	persons peopledirectory.Command
}

func (h traegerHirePersons) CreateSchoolPerson(ctx context.Context, person workforce.TraegerSchoolPersonInput) (int64, error) {
	created, err := h.persons.CreatePerson(ctx, peopledirectory.CreatePerson{FirstName: person.FirstName, LastName: person.LastName, Birthday: person.Birthday})
	return created.ID, err
}

// traegerHireEmployments creates the employment of a hired person as a
// guarded command of School Membership; the school gives the role.
type traegerHireEmployments struct {
	staff schoolmembership.Command
}

func (h traegerHireEmployments) CreateSchoolEmployment(ctx context.Context, employment workforce.TraegerSchoolEmploymentInput) (int64, error) {
	created, err := h.staff.CreateStaff(ctx, schoolmembership.CreateStaff{StaffFields: schoolmembership.StaffFields{
		PersonID: employment.PersonID, EmploymentType: employment.EmploymentType,
	}})
	return created.ID, err
}

// schoolHiresOf reads the create commands beside the reads the Personalstamm
// already takes from the People Directory and School Membership.
func schoolHiresOf(persons TraegerPersons, membership TraegerStaff) (workforce.TraegerHirePersons, workforce.TraegerHireEmployments, error) {
	people, peopleOK := persons.(peopledirectory.Command)
	staff, staffOK := membership.(schoolmembership.Command)
	if !peopleOK || !staffOK {
		return nil, nil, errors.New("traeger staff records: the People Directory and School Membership create no hired person")
	}
	return traegerHirePersons{persons: people}, traegerHireEmployments{staff: staff}, nil
}
