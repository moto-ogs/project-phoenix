package api

import (
	"context"
	"errors"

	carePlanCompose "github.com/moto-ogs/project-phoenix/modules/careplan/compose"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
)

// traegerReportPorts binds the owners' reads behind the Träger's key-date
// report (#4716, ADR 0246): the report template at Organisation & Tenancy,
// the sick and excused status days at Care Plan and the waiting and
// waitlisted children at Enrollment. The figures of the occupancy, the
// utilization and the school view stay bound through their own ports.
func traegerReportPorts(templates organizationtenancy.TraegerReportTemplateReads) traegerview.ReportPorts {
	return traegerview.ReportPorts{
		Templates: traegerReportTemplates{reads: templates},
		Absences:  carePlanCompose.NewSickStudents(),
		Demand:    enrollmentCompose.NewOpenEnrollments(),
	}
}

// traegerReportTemplates translates a report template of Organisation &
// Tenancy into the projection's vocabulary: the Sozialraum by school and
// the not-found refusal of the projection.
type traegerReportTemplates struct {
	reads organizationtenancy.TraegerReportTemplateReads
}

func (t traegerReportTemplates) ReportTemplate(ctx context.Context, organizationID, templateID int64) (traegerview.ReportTemplate, error) {
	template, err := t.reads.TraegerReportTemplate(ctx, organizationID, templateID)
	if errors.Is(err, organizationtenancy.ErrTraegerReportTemplateNotFound) {
		return traegerview.ReportTemplate{}, traegerview.ErrReportTemplateNotFound
	}
	if err != nil {
		return traegerview.ReportTemplate{}, err
	}
	districts := make(map[int64]string, len(template.Districts))
	for _, district := range template.Districts {
		districts[district.SchoolID.Int64()] = district.District
	}
	return traegerview.ReportTemplate{ID: template.ID.Int64(), Name: template.Name, Sections: template.Sections, Districts: districts}, nil
}
