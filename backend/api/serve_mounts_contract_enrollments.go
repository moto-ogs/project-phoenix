package api

import (
	"context"
	"errors"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	careContractCompose "github.com/moto-ogs/project-phoenix/modules/carecontract/compose"
	carePlanCompose "github.com/moto-ogs/project-phoenix/modules/careplan/compose"
	enrollmentOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	peopleDirectoryCompose "github.com/moto-ogs/project-phoenix/modules/peopledirectory/compose"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	contractEnrollmentCompose "github.com/moto-ogs/project-phoenix/workflows/contractenrollment/compose"
	contractEnrollmentHTTP "github.com/moto-ogs/project-phoenix/workflows/contractenrollment/http"
	"github.com/moto-ogs/project-phoenix/workflows/contractenrollment/ports"
)

// contractEnrollmentAccessView names the read of the enrollment of the
// children of imported contracts in the access log of a school.
const contractEnrollmentAccessView = "contract_enrollment"

// mountContractEnrollmentRoutes serves the enrollment of the children of
// imported care contracts (#7760, ADR 0309 section 4) at
// /traeger/contract-enrollments behind the right "Verträge verwalten". The
// workflow plans and binds through Care Contract and enrolls through the
// school's Enrollment decisions; today and now are the root's clocks.
func mountContractEnrollmentRoutes(root chi.Router, organizations ContractEnrollmentOrganizations, schoolEnrollments enrollmentOwner.ContractEnrollments,
	accessLog owners.DataAccessAppender, today func() calendar.Date, now func() time.Time) error {
	enrollments, err := contractEnrollmentCompose.New(ports.Dependencies{
		Contracts: careContractCompose.NewContractEnrollments(careContractCompose.EnrollmentPorts{
			Applications: careContractApplications{applications: enrollmentCompose.NewContractApplications(securityruntime.Fingerprint)},
			Bookings:     careContractBookings{offerings: carePlanCompose.NewContractOfferings(), bookings: carePlanCompose.NewOfferingBookings(now)},
		}, today),
		SchoolEnrollments: schoolEnrollments,
		Schools:           contractEnrollmentSchools{organizations: organizations},
		Children:          contractEnrollmentChildren{records: peopleDirectoryCompose.NewStudentRecordIdentities(owners.StudentDirectoryReader())},
		Access:            contractEnrollmentAccessLog{log: careContractAccessLog{log: accessLog}},
		Fingerprint:       securityruntime.Fingerprint,
	})
	if err != nil {
		return err
	}
	resource := contractEnrollmentHTTP.NewResource(enrollments, common.RequiresPermission(identityaccess.TraegerRightContractsManage))
	root.Mount("/traeger/contract-enrollments", resource.Router(ProtectedTraegerRoutes))
	return nil
}

// ContractEnrollmentOrganizations are the reads of Organisation & Tenancy
// the enrollment of contract children needs: the schools of a Träger, and
// one school under a share lock.
type ContractEnrollmentOrganizations interface {
	ListSchoolsByOrganization(context.Context, int64) ([]organizationtenancy.School, error)
	FindSchoolForShare(context.Context, int64) (organizationtenancy.School, error)
}

// contractEnrollmentSchools names the undeleted schools of the Träger and
// holds one of them.
type contractEnrollmentSchools struct {
	organizations ContractEnrollmentOrganizations
}

// HoldTraegerSchool reads the school under the share lock of its own tenant
// transaction, the lock the catalog rollout holds too (#6305): a change of
// the school's Träger waits for it. A school that is gone, deleted or
// another Träger's is not held.
func (s contractEnrollmentSchools) HoldTraegerSchool(ctx context.Context, organizationID, schoolID int64) (bool, error) {
	school, err := s.organizations.FindSchoolForShare(ctx, schoolID)
	if errors.Is(err, organizationtenancy.ErrSchoolNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return school.OrganizationID.Int64() == organizationID && !school.IsDeleted(), nil
}

func (s contractEnrollmentSchools) TraegerSchoolIDs(ctx context.Context, organizationID int64) ([]int64, error) {
	schools, err := s.organizations.ListSchoolsByOrganization(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(schools))
	for _, school := range schools {
		if !school.IsDeleted() {
			ids = append(ids, school.ID.Int64())
		}
	}
	return ids, nil
}

// contractEnrollmentChildren reads the child records of a school by their
// identifiers from People Directory in its tenant transaction.
type contractEnrollmentChildren struct {
	records peopledirectory.StudentRecordIdentities
}

func (c contractEnrollmentChildren) SchoolChildren(ctx context.Context, studentIDs []int64) ([]ports.Child, error) {
	found, err := c.records.StudentRecordIdentities(ctx, studentIDs)
	if err != nil {
		return nil, err
	}
	children := make([]ports.Child, len(found))
	for i, record := range found {
		children[i] = ports.Child{StudentID: record.StudentID, FirstName: record.FirstName, LastName: record.LastName, BirthDate: record.Birthday}
	}
	return children, nil
}

// contractEnrollmentAccessLog writes the read of the workflow into the
// access log of the school as a read of its care contracts with the child
// records it showed (ADR 0084 section 7).
type contractEnrollmentAccessLog struct {
	log careContractAccessLog
}

func (l contractEnrollmentAccessLog) RecordAccess(ctx context.Context, read ports.SchoolRead) error {
	return l.log.RecordAccess(ctx, carecontract.SchoolAccess{
		OrganizationID: read.OrganizationID, AccountID: read.AccountID, Data: carecontract.SchoolAccessContracts,
		View: contractEnrollmentAccessView, Rows: len(read.ContractIDs), ContractIDs: read.ContractIDs, StudentIDs: read.StudentIDs,
	})
}
