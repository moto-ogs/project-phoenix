package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// Report templates of a Träger (#4716, ADR 0246) in
// platform.traeger_report_templates, under the same Träger policy as the
// master data. The Träger-Büro writes them in its Träger transaction; the
// Träger projection reads one in its administrative transaction.

type traegerReportTemplateRow struct {
	ID           int64     `bun:"id"`
	Name         string    `bun:"name"`
	Sections     []string  `bun:"sections,array"`
	KeyDateMonth int       `bun:"key_date_month"`
	KeyDateDay   int       `bun:"key_date_day"`
	Districts    []byte    `bun:"districts"`
	UpdatedAt    time.Time `bun:"updated_at"`
}

func (r traegerReportTemplateRow) toDomain() (organizationtenancy.TraegerReportTemplate, error) {
	districts := []organizationtenancy.TraegerReportDistrict{}
	if len(r.Districts) > 0 {
		if err := json.Unmarshal(r.Districts, &districts); err != nil {
			return organizationtenancy.TraegerReportTemplate{}, fmt.Errorf("organization tenancy postgres: report template %d districts: %w", r.ID, err)
		}
	}
	sections := r.Sections
	if sections == nil {
		sections = []string{}
	}
	return organizationtenancy.TraegerReportTemplate{
		ID: r.ID, Name: r.Name, Sections: sections, KeyDateMonth: r.KeyDateMonth, KeyDateDay: r.KeyDateDay,
		Districts: districts, UpdatedAt: r.UpdatedAt,
	}, nil
}

const (
	traegerReportTemplateColumns    = `id, name, sections, key_date_month, key_date_day, districts, updated_at`
	listTraegerReportTemplatesQuery = `SELECT ` + traegerReportTemplateColumns + `
		FROM platform.traeger_report_templates
		WHERE organization_id = ?
		ORDER BY lower(name), id`
	traegerReportTemplateQuery = `SELECT ` + traegerReportTemplateColumns + `
		FROM platform.traeger_report_templates
		WHERE organization_id = ? AND id = ?`
	insertTraegerReportTemplateQuery = `INSERT INTO platform.traeger_report_templates
		(organization_id, name, sections, key_date_month, key_date_day, districts, created_by, updated_by)
		VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?)
		RETURNING ` + traegerReportTemplateColumns
	updateTraegerReportTemplateQuery = `UPDATE platform.traeger_report_templates
		SET name = ?, sections = ?, key_date_month = ?, key_date_day = ?, districts = ?::jsonb, updated_by = ?
		WHERE organization_id = ? AND id = ?
		RETURNING ` + traegerReportTemplateColumns
	deleteTraegerReportTemplateQuery = `DELETE FROM platform.traeger_report_templates
		WHERE organization_id = ? AND id = ?`
	traegerSchoolIDsQuery = `SELECT id FROM platform.schools
		WHERE organization_id = ? AND deleted_at IS NULL
		ORDER BY id`
)

// ListReportTemplates reads every template of the Träger, ordered by name.
func (s *TraegerMasterDataStore) ListReportTemplates(ctx context.Context, organizationID int64) ([]organizationtenancy.TraegerReportTemplate, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []traegerReportTemplateRow
	if err := db.NewRaw(listTraegerReportTemplatesQuery, organizationID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("organization tenancy postgres: list report templates: %w", err)
	}
	return reportTemplatesOf(rows)
}

// TraegerSchoolIDs lists the undeleted schools of the Träger.
func (s *TraegerMasterDataStore) TraegerSchoolIDs(ctx context.Context, organizationID int64) ([]int64, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	ids := []int64{}
	if err := db.NewRaw(traegerSchoolIDsQuery, organizationID).Scan(ctx, &ids); err != nil {
		return nil, fmt.Errorf("organization tenancy postgres: list Träger schools: %w", err)
	}
	return ids, nil
}

// InsertReportTemplate adds a template.
func (s *TraegerMasterDataStore) InsertReportTemplate(ctx context.Context, organizationID, accountID int64, input organizationtenancy.TraegerReportTemplateInput) (organizationtenancy.TraegerReportTemplate, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return organizationtenancy.TraegerReportTemplate{}, err
	}
	districts, err := json.Marshal(input.Districts)
	if err != nil {
		return organizationtenancy.TraegerReportTemplate{}, err
	}
	actor := traegerActor(accountID)
	var rows []traegerReportTemplateRow
	if err := db.NewRaw(insertTraegerReportTemplateQuery, organizationID, input.Name, pgdialect.Array(input.Sections),
		input.KeyDateMonth, input.KeyDateDay, string(districts), actor, actor).Scan(ctx, &rows); err != nil {
		return organizationtenancy.TraegerReportTemplate{}, fmt.Errorf("organization tenancy postgres: insert report template: %w", err)
	}
	if len(rows) != 1 {
		return organizationtenancy.TraegerReportTemplate{}, fmt.Errorf("organization tenancy postgres: insert report template returned %d rows", len(rows))
	}
	return rows[0].toDomain()
}

// UpdateReportTemplate overwrites a template; false when the Träger has none
// with this ID.
func (s *TraegerMasterDataStore) UpdateReportTemplate(ctx context.Context, organizationID, accountID, templateID int64, input organizationtenancy.TraegerReportTemplateInput) (organizationtenancy.TraegerReportTemplate, bool, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return organizationtenancy.TraegerReportTemplate{}, false, err
	}
	districts, err := json.Marshal(input.Districts)
	if err != nil {
		return organizationtenancy.TraegerReportTemplate{}, false, err
	}
	var rows []traegerReportTemplateRow
	if err := db.NewRaw(updateTraegerReportTemplateQuery, input.Name, pgdialect.Array(input.Sections), input.KeyDateMonth, input.KeyDateDay,
		string(districts), traegerActor(accountID), organizationID, templateID).Scan(ctx, &rows); err != nil {
		return organizationtenancy.TraegerReportTemplate{}, false, fmt.Errorf("organization tenancy postgres: update report template: %w", err)
	}
	if len(rows) == 0 {
		return organizationtenancy.TraegerReportTemplate{}, false, nil
	}
	template, err := rows[0].toDomain()
	return template, err == nil, err
}

// DeleteReportTemplate removes a template; false when the Träger has none
// with this ID.
func (s *TraegerMasterDataStore) DeleteReportTemplate(ctx context.Context, organizationID, templateID int64) (bool, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return false, err
	}
	result, err := db.ExecContext(ctx, deleteTraegerReportTemplateQuery, organizationID, templateID)
	if err != nil {
		return false, fmt.Errorf("organization tenancy postgres: delete report template: %w", err)
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

// TraegerReportTemplateReads reads one template for the Träger projection in
// its administrative transaction. The administrative role bypasses the
// Träger policy, so the statement names the Träger itself.
type TraegerReportTemplateReads struct{}

var _ organizationtenancy.TraegerReportTemplateReads = TraegerReportTemplateReads{}

// NewTraegerReportTemplateReads builds the read.
func NewTraegerReportTemplateReads() TraegerReportTemplateReads { return TraegerReportTemplateReads{} }

// TraegerReportTemplate reads the template of the Träger with this ID.
func (TraegerReportTemplateReads) TraegerReportTemplate(ctx context.Context, organizationID, templateID int64) (organizationtenancy.TraegerReportTemplate, error) {
	if !tenant.IsAdminTx(ctx) {
		return organizationtenancy.TraegerReportTemplate{}, errors.New("organization tenancy postgres: the report template read needs the administrative transaction")
	}
	if organizationID <= 0 || templateID <= 0 {
		return organizationtenancy.TraegerReportTemplate{}, organizationtenancy.ErrTraegerReportTemplateNotFound
	}
	db, err := NewDatabase()(ctx)
	if err != nil {
		return organizationtenancy.TraegerReportTemplate{}, err
	}
	var rows []traegerReportTemplateRow
	if err := db.NewRaw(traegerReportTemplateQuery, organizationID, templateID).Scan(ctx, &rows); err != nil {
		return organizationtenancy.TraegerReportTemplate{}, fmt.Errorf("organization tenancy postgres: read report template: %w", err)
	}
	if len(rows) == 0 {
		return organizationtenancy.TraegerReportTemplate{}, organizationtenancy.ErrTraegerReportTemplateNotFound
	}
	return rows[0].toDomain()
}

func reportTemplatesOf(rows []traegerReportTemplateRow) ([]organizationtenancy.TraegerReportTemplate, error) {
	result := make([]organizationtenancy.TraegerReportTemplate, 0, len(rows))
	for _, row := range rows {
		template, err := row.toDomain()
		if err != nil {
			return nil, err
		}
		result = append(result, template)
	}
	return result, nil
}
