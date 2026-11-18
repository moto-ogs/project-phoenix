package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/domain"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// BillingStore keeps the billing key day and the captured counts of the
// operator billing report (#2791) in platform.billing_settings and
// platform.billing_key_date_counts. Every statement is a compile-time
// constant so the architecture evaluator can read which tables it touches.
// now is the report's clock; it stamps updated_at of the key day.
type BillingStore struct {
	database Database
	now      func() time.Time
}

// NewBillingStore builds the store over the ambient transaction runtime.
func NewBillingStore(database Database, now func() time.Time) *BillingStore {
	if database == nil || now == nil {
		panic("organization tenancy postgres: database runtime and clock are required")
	}
	return &BillingStore{database: database, now: now}
}

const setRepeatableReadSnapshotSQL = `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`

const setReadCommittedSQL = `SET TRANSACTION ISOLATION LEVEL READ COMMITTED`

const selectBillingSettingsSQL = `SELECT key_day, updated_at, updated_by_operator_id
FROM platform.billing_settings WHERE id = 1`

const updateBillingKeyDaySQL = `UPDATE platform.billing_settings
SET key_day = ?, updated_at = ?, updated_by_operator_id = ?
WHERE id = 1
RETURNING key_day, updated_at, updated_by_operator_id`

// selectSchoolsMissingBillingPeriodSQL lists the schools created by the end
// of the month and still without a row for it, with their own and their
// Träger's key day override (#7301). Its parameter is the month's first day,
// twice. The caller drops a school created after its own key date; creation
// is compared on the Berlin calendar.
const selectSchoolsMissingBillingPeriodSQL = `SELECT school.id, school.name, organization.name AS organization_name,
  (school.created_at AT TIME ZONE 'Europe/Berlin')::date::text AS created_on,
  school_override.id IS NOT NULL AS school_override, school_override.key_day AS school_key_day,
  school_override.updated_at AS school_key_day_updated_at,
  organization_override.id IS NOT NULL AS organization_override, organization_override.key_day AS organization_key_day,
  organization_override.updated_at AS organization_key_day_updated_at
FROM platform.schools AS school
JOIN platform.organizations AS organization ON organization.id = school.organization_id
LEFT JOIN platform.billing_key_day_overrides AS school_override ON school_override.school_id = school.id
LEFT JOIN platform.billing_key_day_overrides AS organization_override
  ON organization_override.organization_id = school.organization_id
WHERE school.deleted_at IS NULL
  AND (school.created_at AT TIME ZONE 'Europe/Berlin')::date
    < (date_trunc('month', ?::date) + interval '1 month')::date
  AND NOT EXISTS (
    SELECT 1 FROM platform.live_billing_key_date_counts AS captured
    WHERE captured.school_id = school.id
      AND captured.period = ?::date
  )
ORDER BY school.id`

// insertBillingKeyDateCountsSQL writes every school of one capture in one
// statement: one array per column, zipped by unnest.
const insertBillingKeyDateCountsSQL = `SELECT platform.capture_billing_key_date_counts(
 ?::bigint[], ?::text[], ?::text[], ?::text[], ?::text[], ?::integer[], ?::integer[])`

// billingKeyDateCountColumns are the columns of a captured row the operator
// report reads through billingKeyDateCountRow. Only the operator sees them
// (#7301).
const billingKeyDateCountColumns = `school_id, school_name, organization_name,
  period::text AS period, key_date::text AS key_date,
  active_students, active_terminals, recorded_at`

const selectBillingKeyDateCountsSQL = `SELECT ` + billingKeyDateCountColumns + `
FROM platform.live_billing_key_date_counts
ORDER BY period DESC, organization_name, school_name, school_id`

type billingSettingsRow struct {
	KeyDay              int       `bun:"key_day"`
	UpdatedAt           time.Time `bun:"updated_at"`
	UpdatedByOperatorID *int64    `bun:"updated_by_operator_id"`
}

// UseRepeatableReadSnapshot pins all reads of one billing capture to the same
// database snapshot. It must be the first operation in the transaction.
func (s *BillingStore) UseRepeatableReadSnapshot(ctx context.Context) error {
	db, err := s.database(ctx)
	if err != nil {
		return err
	}
	if _, err := db.NewRaw(setRepeatableReadSnapshotSQL).Exec(ctx); err != nil {
		return fmt.Errorf("organization tenancy postgres: set billing capture snapshot: %w", err)
	}
	return nil
}

// UseReadCommitted states the capture's isolation explicitly, so a row
// another capture committed meanwhile is skipped by ON CONFLICT DO NOTHING
// instead of failing with 40001, whatever the server default is.
func (s *BillingStore) UseReadCommitted(ctx context.Context) error {
	db, err := s.database(ctx)
	if err != nil {
		return err
	}
	if _, err := db.NewRaw(setReadCommittedSQL).Exec(ctx); err != nil {
		return fmt.Errorf("organization tenancy postgres: set billing capture isolation: %w", err)
	}
	return nil
}

func (r billingSettingsRow) toDomain() domain.BillingSettings {
	return domain.BillingSettings{KeyDay: r.KeyDay, UpdatedAt: r.UpdatedAt, UpdatedByOperatorID: r.UpdatedByOperatorID}
}

// BillingSettings reads the key day. The migration seeds its one row.
func (s *BillingStore) BillingSettings(ctx context.Context) (domain.BillingSettings, error) {
	db, err := s.database(ctx)
	if err != nil {
		return domain.BillingSettings{}, err
	}
	var row billingSettingsRow
	if err := db.NewRaw(selectBillingSettingsSQL).Scan(ctx, &row); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.BillingSettings{}, errors.New("organization tenancy postgres: billing settings row is missing")
		}
		return domain.BillingSettings{}, fmt.Errorf("organization tenancy postgres: read billing settings: %w", err)
	}
	return row.toDomain(), nil
}

// UpdateBillingKeyDay changes the key day and records who changed it.
func (s *BillingStore) UpdateBillingKeyDay(ctx context.Context, keyDay int, operatorID int64) (domain.BillingSettings, error) {
	db, err := s.database(ctx)
	if err != nil {
		return domain.BillingSettings{}, err
	}
	var row billingSettingsRow
	if err := db.NewRaw(updateBillingKeyDaySQL, keyDay, s.now(), operatorID).Scan(ctx, &row); err != nil {
		return domain.BillingSettings{}, fmt.Errorf("organization tenancy postgres: update billing key day: %w", err)
	}
	return row.toDomain(), nil
}

// SchoolsMissingBillingPeriod lists the schools still without a row for the
// month that starts on period, with the levels of their key day.
func (s *BillingStore) SchoolsMissingBillingPeriod(ctx context.Context, period string) ([]domain.BillingSchool, error) {
	db, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	var rows []billingSchoolRow
	if err := db.NewRaw(selectSchoolsMissingBillingPeriodSQL, period, period).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("organization tenancy postgres: list schools missing billing period: %w", err)
	}
	schools := make([]domain.BillingSchool, 0, len(rows))
	for _, row := range rows {
		schools = append(schools, row.toDomain())
	}
	return schools, nil
}

// billingSchoolRow is one school of selectSchoolsMissingBillingPeriodSQL.
type billingSchoolRow struct {
	ID                          int64      `bun:"id"`
	Name                        string     `bun:"name"`
	OrganizationName            string     `bun:"organization_name"`
	CreatedOn                   string     `bun:"created_on"`
	SchoolOverride              bool       `bun:"school_override"`
	SchoolKeyDay                *int       `bun:"school_key_day"`
	SchoolKeyDayUpdatedAt       *time.Time `bun:"school_key_day_updated_at"`
	OrganizationOverride        bool       `bun:"organization_override"`
	OrganizationKeyDay          *int       `bun:"organization_key_day"`
	OrganizationKeyDayUpdatedAt *time.Time `bun:"organization_key_day_updated_at"`
}

func (r billingSchoolRow) toDomain() domain.BillingSchool {
	return domain.BillingSchool{
		ID: r.ID, Name: r.Name, OrganizationName: r.OrganizationName, CreatedOn: r.CreatedOn,
		School:       keyDayLevel(r.SchoolOverride, r.SchoolKeyDay, r.SchoolKeyDayUpdatedAt),
		Organization: keyDayLevel(r.OrganizationOverride, r.OrganizationKeyDay, r.OrganizationKeyDayUpdatedAt),
	}
}

func keyDayLevel(present bool, day *int, updatedAt *time.Time) domain.BillingKeyDayLevel {
	level := domain.BillingKeyDayLevel{Present: present, Day: day}
	if updatedAt != nil {
		level.UpdatedAt = *updatedAt
	}
	return level
}

// InsertBillingKeyDateCounts writes one row per school and month. A row that
// exists already stays as it is: captured figures are never overwritten.
func (s *BillingStore) InsertBillingKeyDateCounts(ctx context.Context, counts []domain.BillingKeyDateCount) (int, error) {
	if len(counts) == 0 {
		return 0, nil
	}
	db, err := s.database(ctx)
	if err != nil {
		return 0, err
	}
	schoolIDs := make([]int64, 0, len(counts))
	periods := make([]string, 0, len(counts))
	keyDates := make([]string, 0, len(counts))
	schoolNames := make([]string, 0, len(counts))
	organizationNames := make([]string, 0, len(counts))
	students := make([]int, 0, len(counts))
	terminals := make([]int, 0, len(counts))
	for _, count := range counts {
		schoolIDs = append(schoolIDs, count.SchoolID)
		periods = append(periods, count.Period)
		keyDates = append(keyDates, count.KeyDate)
		schoolNames = append(schoolNames, count.SchoolName)
		organizationNames = append(organizationNames, count.OrganizationName)
		students = append(students, count.ActiveStudents)
		terminals = append(terminals, count.ActiveTerminals)
	}
	var affected int
	err = db.NewRaw(insertBillingKeyDateCountsSQL,
		pgdialect.Array(schoolIDs), pgdialect.Array(periods), pgdialect.Array(keyDates),
		pgdialect.Array(schoolNames), pgdialect.Array(organizationNames),
		pgdialect.Array(students), pgdialect.Array(terminals),
	).Scan(ctx, &affected)
	if err != nil {
		return 0, fmt.Errorf("organization tenancy postgres: insert billing key-date counts: %w", err)
	}
	return affected, nil
}

// billingKeyDateCountRow is one captured row as billingKeyDateCountColumns
// select it.
type billingKeyDateCountRow struct {
	SchoolID         int64     `bun:"school_id"`
	SchoolName       string    `bun:"school_name"`
	OrganizationName string    `bun:"organization_name"`
	Period           string    `bun:"period"`
	KeyDate          string    `bun:"key_date"`
	ActiveStudents   int       `bun:"active_students"`
	ActiveTerminals  int       `bun:"active_terminals"`
	RecordedAt       time.Time `bun:"recorded_at"`
}

func billingKeyDateCounts(rows []billingKeyDateCountRow) []domain.BillingKeyDateCount {
	counts := make([]domain.BillingKeyDateCount, 0, len(rows))
	for _, row := range rows {
		counts = append(counts, domain.BillingKeyDateCount(row))
	}
	return counts
}

// ListBillingKeyDateCounts reads every captured row, newest month first.
func (s *BillingStore) ListBillingKeyDateCounts(ctx context.Context) ([]domain.BillingKeyDateCount, error) {
	db, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	var rows []billingKeyDateCountRow
	if err := db.NewRaw(selectBillingKeyDateCountsSQL).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("organization tenancy postgres: list billing key-date counts: %w", err)
	}
	return billingKeyDateCounts(rows), nil
}

// selectBillingKeyDayOverridesSQL lists the overrides that set a day, with
// the names the operator recognises: a Träger by its name, a school by its
// name and its Träger's. A deleted Träger or school is no longer listed.
const selectBillingKeyDayOverridesSQL = `SELECT override.organization_id, override.school_id,
  COALESCE(school.organization_id, organization.id) AS traeger_id,
  COALESCE(school.name, organization.name) AS name,
  COALESCE(school_organization.name, '') AS organization_name,
  override.key_day, override.updated_at, override.updated_by_operator_id
FROM platform.billing_key_day_overrides AS override
LEFT JOIN platform.organizations AS organization ON organization.id = override.organization_id
LEFT JOIN platform.schools AS school ON school.id = override.school_id
LEFT JOIN platform.organizations AS school_organization ON school_organization.id = school.organization_id
WHERE override.key_day IS NOT NULL
  AND COALESCE(school.deleted_at, organization.deleted_at) IS NULL
  AND (organization.id IS NOT NULL OR school.id IS NOT NULL)
ORDER BY COALESCE(school_organization.name, organization.name), override.school_id NULLS FIRST, name, override.id`

// upsertOrganizationBillingKeyDaySQL sets the day of a live Träger. A day
// equal to the stored one changes nothing, so its updated_at stays and no
// month is skipped; a reset row (NULL) always takes the new day. Parameters: Träger, day, time, operator, Träger.
const upsertOrganizationBillingKeyDaySQL = `INSERT INTO platform.billing_key_day_overrides AS override
  (organization_id, key_day, updated_at, updated_by_operator_id)
SELECT ?, ?, ?, ?
WHERE EXISTS (SELECT 1 FROM platform.organizations WHERE id = ? AND deleted_at IS NULL)
ON CONFLICT ON CONSTRAINT uq_billing_key_day_overrides_organization DO UPDATE
  SET key_day = EXCLUDED.key_day, updated_at = EXCLUDED.updated_at,
      updated_by_operator_id = EXCLUDED.updated_by_operator_id
  WHERE COALESCE(override.key_day, 0) <> EXCLUDED.key_day
RETURNING id`

// upsertSchoolBillingKeyDaySQL is upsertOrganizationBillingKeyDaySQL for a
// live school.
const upsertSchoolBillingKeyDaySQL = `INSERT INTO platform.billing_key_day_overrides AS override
  (school_id, key_day, updated_at, updated_by_operator_id)
SELECT ?, ?, ?, ?
WHERE EXISTS (SELECT 1 FROM platform.schools WHERE id = ? AND deleted_at IS NULL)
ON CONFLICT ON CONSTRAINT uq_billing_key_day_overrides_school DO UPDATE
  SET key_day = EXCLUDED.key_day, updated_at = EXCLUDED.updated_at,
      updated_by_operator_id = EXCLUDED.updated_by_operator_id
  WHERE COALESCE(override.key_day, 0) <> EXCLUDED.key_day
RETURNING id`

// resetOrganizationBillingKeyDaySQL hands a live Träger back to the day of
// every school. Only a set day is reset: a Träger without one keeps no row,
// so nothing records a change that did not happen. It answers whether the
// Träger is live.
const resetOrganizationBillingKeyDaySQL = `WITH reset AS (
  UPDATE platform.billing_key_day_overrides
  SET key_day = NULL, updated_at = ?, updated_by_operator_id = ?
  WHERE organization_id = ? AND key_day IS NOT NULL
)
SELECT EXISTS (SELECT 1 FROM platform.organizations WHERE id = ? AND deleted_at IS NULL)`

// resetSchoolBillingKeyDaySQL hands a live school back to its Träger's day.
const resetSchoolBillingKeyDaySQL = `WITH reset AS (
  UPDATE platform.billing_key_day_overrides
  SET key_day = NULL, updated_at = ?, updated_by_operator_id = ?
  WHERE school_id = ? AND key_day IS NOT NULL
)
SELECT EXISTS (SELECT 1 FROM platform.schools WHERE id = ? AND deleted_at IS NULL)`

const selectLiveOrganizationSQL = `SELECT EXISTS (SELECT 1 FROM platform.organizations WHERE id = ? AND deleted_at IS NULL)`

const selectLiveSchoolSQL = `SELECT EXISTS (SELECT 1 FROM platform.schools WHERE id = ? AND deleted_at IS NULL)`

type billingKeyDayOverrideRow struct {
	OrganizationID      *int64    `bun:"organization_id"`
	SchoolID            *int64    `bun:"school_id"`
	TraegerID           int64     `bun:"traeger_id"`
	Name                string    `bun:"name"`
	OrganizationName    string    `bun:"organization_name"`
	KeyDay              *int      `bun:"key_day"`
	UpdatedAt           time.Time `bun:"updated_at"`
	UpdatedByOperatorID *int64    `bun:"updated_by_operator_id"`
}

// ListBillingKeyDayOverrides reads every Träger and school with its own day.
func (s *BillingStore) ListBillingKeyDayOverrides(ctx context.Context) ([]domain.BillingKeyDayOverride, error) {
	db, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	var rows []billingKeyDayOverrideRow
	if err := db.NewRaw(selectBillingKeyDayOverridesSQL).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("organization tenancy postgres: list billing key day overrides: %w", err)
	}
	overrides := make([]domain.BillingKeyDayOverride, 0, len(rows))
	for _, row := range rows {
		overrides = append(overrides, domain.BillingKeyDayOverride(row))
	}
	return overrides, nil
}

// SetBillingKeyDayOverride sets (day not nil) or resets (day nil) the own
// key day of a live Träger or school; target names which. It reports whether
// the Träger or school is live. Every statement is its own constant, so the
// architecture evaluator reads the tables it touches.
func (s *BillingStore) SetBillingKeyDayOverride(ctx context.Context, target domain.BillingKeyDayTarget, day *int, operatorID int64) (bool, error) {
	db, err := s.database(ctx)
	if err != nil {
		return false, err
	}
	now := s.now()
	var live bool
	var ids []int64
	switch {
	case day == nil && target.School:
		err = db.NewRaw(resetSchoolBillingKeyDaySQL, now, operatorID, target.ID, target.ID).Scan(ctx, &live)
		return live, wrapKeyDayError("reset", err)
	case day == nil:
		err = db.NewRaw(resetOrganizationBillingKeyDaySQL, now, operatorID, target.ID, target.ID).Scan(ctx, &live)
		return live, wrapKeyDayError("reset", err)
	case target.School:
		err = db.NewRaw(upsertSchoolBillingKeyDaySQL, target.ID, *day, now, operatorID, target.ID).Scan(ctx, &ids)
	default:
		err = db.NewRaw(upsertOrganizationBillingKeyDaySQL, target.ID, *day, now, operatorID, target.ID).Scan(ctx, &ids)
	}
	if err != nil || len(ids) > 0 {
		return err == nil, wrapKeyDayError("set", err)
	}
	// No row came back: the Träger or school is not live, or the day was
	// already set. Only the first is a refusal.
	if target.School {
		err = db.NewRaw(selectLiveSchoolSQL, target.ID).Scan(ctx, &live)
	} else {
		err = db.NewRaw(selectLiveOrganizationSQL, target.ID).Scan(ctx, &live)
	}
	return live, wrapKeyDayError("check target of", err)
}

func wrapKeyDayError(action string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("organization tenancy postgres: %s billing key day: %w", action, err)
}
