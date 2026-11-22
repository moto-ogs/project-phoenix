package api

import (
	"context"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	careContractCompose "github.com/moto-ogs/project-phoenix/modules/carecontract/compose"
	careContractHTTP "github.com/moto-ogs/project-phoenix/modules/carecontract/http"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	peopleDirectoryCompose "github.com/moto-ogs/project-phoenix/modules/peopledirectory/compose"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// mountCareContractChildLinkRoutes serves the link of imported contracts to
// the child records of their schools (#7760, ADR 0232 addendum of
// 22.11.2026) at /traeger/contract-child-links behind the right "Verträge
// verwalten". today is the root's day clock.
func mountCareContractChildLinkRoutes(root chi.Router, organizations HolidayOrganizations, accessLog owners.DataAccessAppender,
	today func() calendar.Date) {
	resource := careContractHTTP.NewChildLinkResource(NewCareContractChildLinks(organizations, accessLog, today),
		common.RequiresPermission(identityaccess.TraegerRightContractsManage))
	root.Mount("/traeger/contract-child-links", resource.Router(ProtectedTraegerRoutes))
}

// NewCareContractChildLinks binds the link to the schools of the Träger, the
// child records of each school at People Directory in its tenant
// transaction and the school's access log.
func NewCareContractChildLinks(organizations HolidayOrganizations, accessLog owners.DataAccessAppender,
	today func() calendar.Date) carecontract.ContractChildLinks {
	return careContractCompose.NewContractChildLinks(careContractCompose.ChildLinkPorts{
		Schools:     careContractSchools{organizations: organizations},
		Children:    careContractSchoolChildren{records: peopleDirectoryCompose.NewStudentRecordIdentities(owners.StudentDirectoryReader())},
		Access:      careContractAccessLog{log: accessLog},
		Runtime:     owners.CareContractRuntime{},
		Fingerprint: securityruntime.Fingerprint,
	}, today)
}

// careContractSchoolChildren reads the child records of a school by their
// identifiers from People Directory in its tenant transaction.
type careContractSchoolChildren struct {
	records peopledirectory.StudentRecordIdentities
}

func (c careContractSchoolChildren) SchoolChildren(ctx context.Context, ids []int64) ([]carecontract.SchoolChild, error) {
	found, err := c.records.StudentRecordIdentities(ctx, ids)
	if err != nil {
		return nil, err
	}
	children := make([]carecontract.SchoolChild, len(found))
	for i, record := range found {
		children[i] = carecontract.SchoolChild{StudentID: record.StudentID, FirstName: record.FirstName, LastName: record.LastName,
			BirthDate: record.Birthday}
	}
	return children, nil
}
