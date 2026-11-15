package application

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/ports"
)

// Report templates of a Träger (#4716, ADR 0246). Like the master data, the
// service opens no transaction: the Träger-Portal route runs it in the
// Träger transaction of the session's Träger. Every write locks the Träger's
// profile row first, decides every refusal before its first write and logs
// the change in the master data log of the same transaction.

var (
	errUnknownSection   = errors.New("names an unknown section")
	errInvalidMonth     = errors.New("must be a month from 1 to 12")
	errInvalidDay       = errors.New("must be a day of the month")
	errDistrictSchool   = errors.New("names a school that is no school of the Träger")
	errDistrictTwice    = errors.New("names a school twice")
	errDistrictRequired = errors.New("needs a Sozialraum of at most 80 characters")
)

// TraegerReportTemplates implements organizationtenancy.TraegerReportTemplates.
type TraegerReportTemplates struct {
	store ports.TraegerReportTemplateStore
}

var _ organizationtenancy.TraegerReportTemplates = (*TraegerReportTemplates)(nil)

// NewTraegerReportTemplates builds the service.
func NewTraegerReportTemplates(store ports.TraegerReportTemplateStore) *TraegerReportTemplates {
	if store == nil {
		panic("organization tenancy: the report template store is required")
	}
	return &TraegerReportTemplates{store: store}
}

// ReportTemplates reads every template of the Träger, ordered by name. A
// school that left the Träger (deleted, or moved to another Träger) drops out
// of the districts, so a template shows and saves only schools of its Träger.
func (t *TraegerReportTemplates) ReportTemplates(ctx context.Context, organizationID int64) ([]organizationtenancy.TraegerReportTemplate, error) {
	if organizationID <= 0 {
		return nil, errTraegerRequired
	}
	templates, err := t.store.ListReportTemplates(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	schools, err := t.store.TraegerSchoolIDs(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	for i := range templates {
		templates[i].Districts = slices.DeleteFunc(templates[i].Districts, func(district organizationtenancy.TraegerReportDistrict) bool {
			return !slices.Contains(schools, district.SchoolID)
		})
	}
	return templates, nil
}

// AddReportTemplate stores a new template.
func (t *TraegerReportTemplates) AddReportTemplate(ctx context.Context, organizationID, accountID int64, input organizationtenancy.TraegerReportTemplateInput) (organizationtenancy.TraegerReportTemplate, error) {
	existing, input, err := t.prepare(ctx, organizationID, input, true)
	if err != nil {
		return organizationtenancy.TraegerReportTemplate{}, err
	}
	if reportNameTaken(existing, input.Name, 0) {
		return organizationtenancy.TraegerReportTemplate{}, organizationtenancy.ErrTraegerReportTemplateNameTaken
	}
	created, err := t.store.InsertReportTemplate(ctx, organizationID, accountID, input)
	if err != nil {
		return organizationtenancy.TraegerReportTemplate{}, err
	}
	if err := t.audit(ctx, organizationID, accountID, created.ID, domain.TraegerAuditActionCreate, nil, &created); err != nil {
		return organizationtenancy.TraegerReportTemplate{}, err
	}
	return created, nil
}

// ReplaceReportTemplate overwrites a template of the Träger.
func (t *TraegerReportTemplates) ReplaceReportTemplate(ctx context.Context, organizationID, accountID, templateID int64, input organizationtenancy.TraegerReportTemplateInput) (organizationtenancy.TraegerReportTemplate, error) {
	existing, input, err := t.prepare(ctx, organizationID, input, false)
	if err != nil {
		return organizationtenancy.TraegerReportTemplate{}, err
	}
	old := findReportTemplate(existing, templateID)
	if old == nil {
		return organizationtenancy.TraegerReportTemplate{}, organizationtenancy.ErrTraegerReportTemplateNotFound
	}
	if reportNameTaken(existing, input.Name, templateID) {
		return organizationtenancy.TraegerReportTemplate{}, organizationtenancy.ErrTraegerReportTemplateNameTaken
	}
	updated, found, err := t.store.UpdateReportTemplate(ctx, organizationID, accountID, templateID, input)
	if err != nil {
		return organizationtenancy.TraegerReportTemplate{}, err
	}
	if !found {
		return organizationtenancy.TraegerReportTemplate{}, organizationtenancy.ErrTraegerReportTemplateNotFound
	}
	if err := t.audit(ctx, organizationID, accountID, templateID, domain.TraegerAuditActionUpdate, old, &updated); err != nil {
		return organizationtenancy.TraegerReportTemplate{}, err
	}
	return updated, nil
}

// RemoveReportTemplate removes a template of the Träger.
func (t *TraegerReportTemplates) RemoveReportTemplate(ctx context.Context, organizationID, accountID, templateID int64) error {
	if organizationID <= 0 {
		return errTraegerRequired
	}
	if _, err := t.store.LockProfile(ctx, organizationID, false); err != nil {
		return err
	}
	existing, err := t.store.ListReportTemplates(ctx, organizationID)
	if err != nil {
		return err
	}
	old := findReportTemplate(existing, templateID)
	if old == nil {
		return organizationtenancy.ErrTraegerReportTemplateNotFound
	}
	deleted, err := t.store.DeleteReportTemplate(ctx, organizationID, templateID)
	if err != nil {
		return err
	}
	if !deleted {
		return organizationtenancy.ErrTraegerReportTemplateNotFound
	}
	return t.audit(ctx, organizationID, accountID, templateID, domain.TraegerAuditActionDelete, old, nil)
}

// prepare checks the input, locks the Träger and returns its templates. A
// school the districts name must be a school of the Träger.
func (t *TraegerReportTemplates) prepare(ctx context.Context, organizationID int64, input organizationtenancy.TraegerReportTemplateInput, create bool) ([]organizationtenancy.TraegerReportTemplate, organizationtenancy.TraegerReportTemplateInput, error) {
	if organizationID <= 0 {
		return nil, input, errTraegerRequired
	}
	input, fields := normalizeReportTemplate(input)
	if len(fields) > 0 {
		return nil, input, fields
	}
	if _, err := t.store.LockProfile(ctx, organizationID, create); err != nil {
		return nil, input, err
	}
	schools, err := t.store.TraegerSchoolIDs(ctx, organizationID)
	if err != nil {
		return nil, input, err
	}
	for _, district := range input.Districts {
		if !slices.Contains(schools, district.SchoolID) {
			return nil, input, validation.Errors{"districts": errDistrictSchool}
		}
	}
	existing, err := t.store.ListReportTemplates(ctx, organizationID)
	if err != nil {
		return nil, input, err
	}
	return existing, input, nil
}

func (t *TraegerReportTemplates) audit(ctx context.Context, organizationID, accountID, templateID int64, action string, oldValue, newValue *organizationtenancy.TraegerReportTemplate) error {
	entry := domain.TraegerMasterDataAuditEntry{
		OrganizationID: organizationID, Subject: domain.TraegerAuditSubjectReportTemplate, SubjectID: templateID,
		Action: action, OldValue: reportTemplateAuditValue(oldValue), NewValue: reportTemplateAuditValue(newValue), ActorAccountID: accountID,
	}
	return t.store.AppendAudit(ctx, entry)
}

// reportTemplateAuditValue is the logged state of a template without its
// timestamp, which the log keeps itself.
func reportTemplateAuditValue(template *organizationtenancy.TraegerReportTemplate) json.RawMessage {
	if template == nil {
		return nil
	}
	value, _ := json.Marshal(organizationtenancy.TraegerReportTemplateInput{
		Name: template.Name, Sections: template.Sections, KeyDateMonth: template.KeyDateMonth,
		KeyDateDay: template.KeyDateDay, Districts: template.Districts,
	})
	return value
}

// normalizeReportTemplate trims the texts, orders the sections and the
// districts and reports every field that is refused.
func normalizeReportTemplate(input organizationtenancy.TraegerReportTemplateInput) (organizationtenancy.TraegerReportTemplateInput, validation.Errors) {
	fields := validation.Errors{}
	input.Name = strings.TrimSpace(input.Name)
	requiredText(fields, "name", input.Name, organizationtenancy.TraegerReportTemplateNameMax)
	sections, err := canonicalSections(input.Sections)
	if err != nil {
		fields["sections"] = err
	}
	input.Sections = sections
	switch {
	case input.KeyDateMonth < 1 || input.KeyDateMonth > 12:
		fields["key_date_month"] = errInvalidMonth
	case input.KeyDateDay < 1 || input.KeyDateDay > daysInMonth(input.KeyDateMonth):
		fields["key_date_day"] = errInvalidDay
	}
	districts, err := canonicalDistricts(input.Districts)
	if err != nil {
		fields["districts"] = err
	}
	input.Districts = districts
	return input, fields
}

// canonicalSections keeps each known section once, in the order of
// organizationtenancy.ReportSections.
func canonicalSections(sections []string) ([]string, error) {
	known := organizationtenancy.ReportSections()
	for _, section := range sections {
		if !slices.Contains(known, section) {
			return nil, errUnknownSection
		}
	}
	result := make([]string, 0, len(known))
	for _, section := range known {
		if slices.Contains(sections, section) {
			result = append(result, section)
		}
	}
	if len(result) == 0 {
		return nil, errRequiredField
	}
	return result, nil
}

// canonicalDistricts trims each Sozialraum, refuses a school named twice and
// orders the districts by school.
func canonicalDistricts(districts []organizationtenancy.TraegerReportDistrict) ([]organizationtenancy.TraegerReportDistrict, error) {
	result := make([]organizationtenancy.TraegerReportDistrict, 0, len(districts))
	for _, district := range districts {
		district.District = strings.TrimSpace(district.District)
		if district.SchoolID <= 0 {
			return nil, errDistrictSchool
		}
		if district.District == "" || utf8.RuneCountInString(district.District) > organizationtenancy.TraegerReportDistrictMax {
			return nil, errDistrictRequired
		}
		if slices.ContainsFunc(result, func(other organizationtenancy.TraegerReportDistrict) bool { return other.SchoolID == district.SchoolID }) {
			return nil, errDistrictTwice
		}
		result = append(result, district)
	}
	slices.SortFunc(result, func(a, b organizationtenancy.TraegerReportDistrict) int {
		switch {
		case a.SchoolID < b.SchoolID:
			return -1
		case a.SchoolID > b.SchoolID:
			return 1
		}
		return 0
	})
	return result, nil
}

// daysInMonth counts the days of a month in a leap year, so 29 February is a
// key date a template may name.
func daysInMonth(month int) int {
	return time.Date(2000, time.Month(month)+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// reportNameTaken reports whether another template of the Träger carries the
// name, compared without case like the unique index.
func reportNameTaken(templates []organizationtenancy.TraegerReportTemplate, name string, exceptID int64) bool {
	return slices.ContainsFunc(templates, func(template organizationtenancy.TraegerReportTemplate) bool {
		return template.ID != exceptID && strings.EqualFold(template.Name, name)
	})
}

func findReportTemplate(templates []organizationtenancy.TraegerReportTemplate, id int64) *organizationtenancy.TraegerReportTemplate {
	for i := range templates {
		if templates[i].ID == id {
			return &templates[i]
		}
	}
	return nil
}
