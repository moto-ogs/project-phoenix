package organizationtenancy

import (
	"context"
	"errors"
	"time"
)

// Report templates of a Träger (#4716, spec #4611 user stories 115 and 116,
// ADR 0246): the Träger-Büro hands its Kommune and its Jugendamt reports by
// key date, each in the shape that office asks for. A template names the
// sections the report shows, the key date of the year it is usually drawn up
// for and the Sozialraum of each school of the Träger, because a Kommune
// divides its schools by Sozialraum differently per report. A template holds
// no personal data. Like the master data it belongs to the Träger and is
// written in its Träger transaction (ADR 0105); the Träger projection reads
// it in its administrative transaction to draw up a report.

// The sections of a key-date report, in the order a template stores and a
// report shows them.
const (
	ReportSectionChildren = "children"
	ReportSectionStaff    = "staff"
	ReportSectionAbsences = "absences"
	ReportSectionDemand   = "demand"
)

// ReportSections lists every section in its canonical order.
func ReportSections() []string {
	return []string{ReportSectionChildren, ReportSectionStaff, ReportSectionAbsences, ReportSectionDemand}
}

// Bounds of a report template.
const (
	TraegerReportTemplateNameMax = 120
	TraegerReportDistrictMax     = 80
)

var (
	// ErrTraegerReportTemplateNotFound reports a template that is not one of
	// the Träger: an unknown ID and one of another Träger read the same.
	ErrTraegerReportTemplateNotFound = errors.New("organization tenancy: report template not found")
	// ErrTraegerReportTemplateNameTaken reports a name another template of
	// the Träger carries, compared without case.
	ErrTraegerReportTemplateNameTaken = errors.New("organization tenancy: another report template carries this name")
)

// TraegerReportDistrict assigns one school of the Träger to a Sozialraum.
type TraegerReportDistrict struct {
	SchoolID int64  `json:"school_id"`
	District string `json:"district"`
}

// TraegerReportTemplateInput is a template as the Träger-Büro writes it.
// Sections may come in any order; the owner stores them in the order of
// ReportSections.
type TraegerReportTemplateInput struct {
	Name         string                  `json:"name"`
	Sections     []string                `json:"sections"`
	KeyDateMonth int                     `json:"key_date_month"`
	KeyDateDay   int                     `json:"key_date_day"`
	Districts    []TraegerReportDistrict `json:"districts"`
}

// TraegerReportTemplate is a stored template. Districts are ordered by
// school ID.
type TraegerReportTemplate struct {
	ID           int64                   `json:"id"`
	Name         string                  `json:"name"`
	Sections     []string                `json:"sections"`
	KeyDateMonth int                     `json:"key_date_month"`
	KeyDateDay   int                     `json:"key_date_day"`
	Districts    []TraegerReportDistrict `json:"districts"`
	UpdatedAt    time.Time               `json:"updated_at"`
}

// TraegerReportTemplates lets the Träger-Büro keep the report templates of
// its Träger. Every operation joins the caller's Träger transaction of
// organizationID; accountID is the acting account the master data log
// records. A refused input is validation.Errors by field (name, sections,
// key_date_month, key_date_day, districts); a school in districts that is no
// school of the Träger is refused on districts.
type TraegerReportTemplates interface {
	// ReportTemplates reads every template of the Träger, ordered by name.
	ReportTemplates(ctx context.Context, organizationID int64) ([]TraegerReportTemplate, error)
	// AddReportTemplate stores a new template.
	AddReportTemplate(ctx context.Context, organizationID, accountID int64, input TraegerReportTemplateInput) (TraegerReportTemplate, error)
	// ReplaceReportTemplate overwrites a template; another Träger's or an unknown one is
	// ErrTraegerReportTemplateNotFound.
	ReplaceReportTemplate(ctx context.Context, organizationID, accountID, templateID int64, input TraegerReportTemplateInput) (TraegerReportTemplate, error)
	// RemoveReportTemplate removes a template; another Träger's or an unknown one is
	// ErrTraegerReportTemplateNotFound.
	RemoveReportTemplate(ctx context.Context, organizationID, accountID, templateID int64) error
}

// TraegerReportTemplateReads serves the Träger projection: it joins the
// caller's administrative transaction, refuses any other and filters on the
// Träger, so a template of another Träger is
// ErrTraegerReportTemplateNotFound.
type TraegerReportTemplateReads interface {
	TraegerReportTemplate(ctx context.Context, organizationID, templateID int64) (TraegerReportTemplate, error)
}
