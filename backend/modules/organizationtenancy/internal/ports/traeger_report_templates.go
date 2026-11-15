package ports

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/domain"
)

// TraegerReportTemplateStore persists the report templates of a Träger
// (#4716). Every method runs in the caller's Träger transaction of
// organizationID and names the Träger in its own filter again.
type TraegerReportTemplateStore interface {
	// LockProfile holds the Träger's profile row until the end of the
	// transaction, so two writes of one Träger compare names one after the
	// other.
	LockProfile(ctx context.Context, organizationID int64, create bool) (organizationtenancy.TraegerProfile, error)
	// ListReportTemplates reads every template of the Träger, ordered by
	// name.
	ListReportTemplates(ctx context.Context, organizationID int64) ([]organizationtenancy.TraegerReportTemplate, error)
	// TraegerSchoolIDs lists the undeleted schools of the Träger, the
	// schools a template may assign to a Sozialraum.
	TraegerSchoolIDs(ctx context.Context, organizationID int64) ([]int64, error)
	InsertReportTemplate(ctx context.Context, organizationID, accountID int64, input organizationtenancy.TraegerReportTemplateInput) (organizationtenancy.TraegerReportTemplate, error)
	// UpdateReportTemplate reports false when the Träger has no such
	// template.
	UpdateReportTemplate(ctx context.Context, organizationID, accountID, templateID int64, input organizationtenancy.TraegerReportTemplateInput) (organizationtenancy.TraegerReportTemplate, bool, error)
	// DeleteReportTemplate reports false when the Träger has no such
	// template.
	DeleteReportTemplate(ctx context.Context, organizationID, templateID int64) (bool, error)
	AppendAudit(ctx context.Context, entry domain.TraegerMasterDataAuditEntry) error
}
