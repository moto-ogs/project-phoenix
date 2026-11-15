package postgres

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// The Arbeitsvertrag of the Personalstamm (#4706): the contracts with their
// Soll and holiday weeks in the Träger transaction, and their mirror into the
// time tracking of one school in that school's tenant transaction.

const (
	staffContractTargetVersionIndex = "uq_workforce_staff_contract_targets_version"
	staffContractHolidayWeekIndex   = "uq_workforce_staff_contract_holiday_weeks_week"
)

type staffContractRow struct {
	ID             int64          `bun:"id"`
	OrganizationID int64          `bun:"organization_id"`
	StaffRecordID  int64          `bun:"staff_record_id"`
	Kind           string         `bun:"kind"`
	StartsOn       calendar.Date  `bun:"starts_on"`
	EndsOn         *calendar.Date `bun:"ends_on"`
	Pool           bool           `bun:"pool"`
	CreatedAt      time.Time      `bun:"created_at"`
}

type staffContractWeekdayRow struct {
	ContractID     int64         `bun:"contract_id"`
	SchoolID       int64         `bun:"school_id"`
	StaffID        int64         `bun:"membership_id"`
	Day            calendar.Date `bun:"day"`
	WeekdayMinutes []int         `bun:"weekday_minutes,array"`
}

// ListStaffContracts returns the contracts of a record with their Soll and
// holiday weeks, in three statements.
func (s *TraegerStaffStore) ListStaffContracts(ctx context.Context, organizationID, recordID int64) ([]domain.TraegerStaffContract, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []staffContractRow
	if err := db.NewRaw(`SELECT id, organization_id, staff_record_id, kind, starts_on, ends_on, pool, created_at FROM workforce.staff_contracts
		WHERE organization_id = ? AND staff_record_id = ? ORDER BY starts_on DESC, id DESC`, organizationID, recordID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: list staff contracts: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	contracts := make([]domain.TraegerStaffContract, len(rows))
	index := make(map[int64]int, len(rows))
	ids := make([]int64, len(rows))
	for i, row := range rows {
		contracts[i] = domain.TraegerStaffContract{
			ID: row.ID, OrganizationID: row.OrganizationID, RecordID: row.StaffRecordID, Kind: row.Kind,
			StartsOn: row.StartsOn, Pool: row.Pool, CreatedAt: row.CreatedAt,
		}
		if row.EndsOn != nil {
			contracts[i].EndsOn = *row.EndsOn
		}
		index[row.ID], ids[i] = i, row.ID
	}
	var targets []staffContractWeekdayRow
	if err := db.NewRaw(`SELECT contract_id, school_id, membership_id, valid_from AS day, weekday_minutes FROM workforce.staff_contract_targets
		WHERE organization_id = ? AND contract_id = ANY(?) ORDER BY school_id, valid_from`, organizationID, pgdialect.Array(ids)).Scan(ctx, &targets); err != nil {
		return nil, fmt.Errorf("workforce postgres: list staff contract targets: %w", err)
	}
	for _, row := range targets {
		i := index[row.ContractID]
		contracts[i].Targets = append(contracts[i].Targets, domain.ContractTarget{
			ContractSite: domain.ContractSite{SchoolID: row.SchoolID, StaffID: row.StaffID}, ValidFrom: row.Day, WeekdayMinutes: row.WeekdayMinutes,
		})
	}
	var weeks []staffContractWeekdayRow
	if err := db.NewRaw(`SELECT contract_id, school_id, membership_id, week_start AS day, weekday_minutes FROM workforce.staff_contract_holiday_weeks
		WHERE organization_id = ? AND contract_id = ANY(?) ORDER BY week_start, school_id`, organizationID, pgdialect.Array(ids)).Scan(ctx, &weeks); err != nil {
		return nil, fmt.Errorf("workforce postgres: list staff contract holiday weeks: %w", err)
	}
	for _, row := range weeks {
		i := index[row.ContractID]
		contracts[i].HolidayWeeks = append(contracts[i].HolidayWeeks, domain.ContractHolidayWeek{
			ContractSite: domain.ContractSite{SchoolID: row.SchoolID, StaffID: row.StaffID}, ContractID: row.ContractID,
			WeekStart: row.Day, WeekdayMinutes: row.WeekdayMinutes,
		})
	}
	return contracts, nil
}

// InsertStaffContract writes a new contract with its first Soll per
// Einsatzort.
func (s *TraegerStaffStore) InsertStaffContract(ctx context.Context, contract domain.TraegerStaffContract, accountID int64) (int64, error) {
	db, err := traegerStaffDB(ctx, contract.OrganizationID)
	if err != nil {
		return 0, err
	}
	var id int64
	if err := db.NewRaw(`INSERT INTO workforce.staff_contracts (organization_id, staff_record_id, kind, starts_on, ends_on, pool, created_by_account_id)
		VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, contract.OrganizationID, contract.RecordID, contract.Kind, contract.StartsOn,
		optionalDate(contract.EndsOn), contract.Pool, accountID).Scan(ctx, &id); err != nil {
		return 0, fmt.Errorf("workforce postgres: insert staff contract: %w", err)
	}
	return id, insertContractTargets(ctx, db, contract.OrganizationID, id, accountID, contract.Targets)
}

// UpdateStaffContractTerms changes kind and last day and drops the Soll and
// holiday weeks that start after the new last day.
func (s *TraegerStaffStore) UpdateStaffContractTerms(ctx context.Context, contract domain.TraegerStaffContract) error {
	db, err := traegerStaffDB(ctx, contract.OrganizationID)
	if err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `UPDATE workforce.staff_contracts SET kind = ?, ends_on = ?, pool = ? WHERE organization_id = ? AND id = ?`,
		contract.Kind, optionalDate(contract.EndsOn), contract.Pool, contract.OrganizationID, contract.ID); err != nil {
		return fmt.Errorf("workforce postgres: update staff contract: %w", err)
	}
	if contract.EndsOn.IsZero() {
		return nil
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM workforce.staff_contract_targets WHERE organization_id = ? AND contract_id = ? AND valid_from > ?`,
		contract.OrganizationID, contract.ID, contract.EndsOn); err != nil {
		return fmt.Errorf("workforce postgres: drop staff contract targets after the end: %w", err)
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM workforce.staff_contract_holiday_weeks WHERE organization_id = ? AND contract_id = ? AND week_start + 4 > ?`,
		contract.OrganizationID, contract.ID, contract.EndsOn); err != nil {
		return fmt.Errorf("workforce postgres: drop staff contract holiday weeks after the end: %w", err)
	}
	return nil
}

// ReplaceContractTargetsFrom writes a new Soll from validFrom on for the
// named Einsatzorte; a later planned Soll of those Einsatzorte gives way.
func (s *TraegerStaffStore) ReplaceContractTargetsFrom(ctx context.Context, organizationID, contractID, accountID int64, validFrom calendar.Date, targets []domain.ContractTarget) error {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return err
	}
	schools := make([]int64, 0, len(targets))
	for _, target := range targets {
		schools = append(schools, target.SchoolID)
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM workforce.staff_contract_targets
		WHERE organization_id = ? AND contract_id = ? AND school_id = ANY(?) AND valid_from >= ?`,
		organizationID, contractID, pgdialect.Array(schools), validFrom); err != nil {
		return fmt.Errorf("workforce postgres: replace staff contract targets: %w", err)
	}
	return insertContractTargets(ctx, db, organizationID, contractID, accountID, targets)
}

// insertContractTargets writes the Soll versions in one statement.
func insertContractTargets(ctx context.Context, db bun.IDB, organizationID, contractID, accountID int64, targets []domain.ContractTarget) error {
	if len(targets) == 0 {
		return nil
	}
	schools, staff, days, minutes := make([]int64, len(targets)), make([]int64, len(targets)), make([]string, len(targets)), make([]string, len(targets))
	for i, target := range targets {
		schools[i], staff[i], days[i], minutes[i] = target.SchoolID, target.StaffID, target.ValidFrom.String(), intArrayLiteral(target.WeekdayMinutes)
	}
	_, err := db.ExecContext(ctx, `INSERT INTO workforce.staff_contract_targets
		(organization_id, contract_id, school_id, membership_id, valid_from, weekday_minutes, created_by_account_id)
		SELECT ?, ?, target.school_id, target.membership_id, target.valid_from, target.minutes::integer[], ?
		FROM unnest(?::bigint[], ?::bigint[], ?::date[], ?::text[]) AS target (school_id, membership_id, valid_from, minutes)`,
		organizationID, contractID, accountID, pgdialect.Array(schools), pgdialect.Array(staff), pgdialect.Array(days), pgdialect.Array(minutes))
	if isUniqueViolationOn(err, staffContractTargetVersionIndex) {
		return &domain.ContractError{Kind: domain.ErrContractInvalid, Field: "targets", Reason: "two Soll values for one Einsatzort on one day"}
	}
	if err != nil {
		return fmt.Errorf("workforce postgres: insert staff contract targets: %w", err)
	}
	return nil
}

// InsertContractHolidayWeeks adds holiday weeks; a week the contract already
// names for the Einsatzort fails as invalid.
func (s *TraegerStaffStore) InsertContractHolidayWeeks(ctx context.Context, organizationID, contractID, accountID int64, weeks []domain.ContractHolidayWeek) error {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return err
	}
	if len(weeks) == 0 {
		return nil
	}
	schools, staff, starts := make([]int64, len(weeks)), make([]int64, len(weeks)), make([]string, len(weeks))
	minutes := make([]string, len(weeks))
	for i, week := range weeks {
		schools[i], staff[i], starts[i] = week.SchoolID, week.StaffID, week.WeekStart.String()
		minutes[i] = intArrayLiteral(week.WeekdayMinutes)
	}
	_, err = db.ExecContext(ctx, `INSERT INTO workforce.staff_contract_holiday_weeks
		(organization_id, contract_id, school_id, membership_id, week_start, weekday_minutes, created_by_account_id)
		SELECT ?, ?, week.school_id, week.membership_id, week.week_start, week.minutes::integer[], ?
		FROM unnest(?::bigint[], ?::bigint[], ?::date[], ?::text[]) AS week (school_id, membership_id, week_start, minutes)`,
		organizationID, contractID, accountID, pgdialect.Array(schools), pgdialect.Array(staff), pgdialect.Array(starts), pgdialect.Array(minutes))
	if isUniqueViolationOn(err, staffContractHolidayWeekIndex) {
		return &domain.ContractError{Kind: domain.ErrContractInvalid, Field: "week_start", Reason: "the contract already names this holiday week"}
	}
	if err != nil {
		return fmt.Errorf("workforce postgres: insert staff contract holiday weeks: %w", err)
	}
	return nil
}

// intArrayLiteral writes minutes as a PostgreSQL array literal, so a list
// of minute arrays travels as one text[] parameter and unnest keeps the rows
// apart (a two-dimensional array would need equal lengths per row).
func intArrayLiteral(values []int) string {
	parts := make([]string, len(values))
	for i, value := range values {
		parts[i] = strconv.Itoa(value)
	}
	return "{" + strings.Join(parts, ",") + "}"
}

// DeleteContractHolidayWeek removes one holiday week of one Einsatzort.
func (s *TraegerStaffStore) DeleteContractHolidayWeek(ctx context.Context, organizationID, contractID, schoolID int64, weekStart calendar.Date) (bool, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return false, err
	}
	result, err := db.ExecContext(ctx, `DELETE FROM workforce.staff_contract_holiday_weeks
		WHERE organization_id = ? AND contract_id = ? AND school_id = ? AND week_start = ?`, organizationID, contractID, schoolID, weekStart)
	if err != nil {
		return false, fmt.Errorf("workforce postgres: delete staff contract holiday week: %w", err)
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

// DeleteStaffContract removes a contract with its Soll and holiday weeks.
func (s *TraegerStaffStore) DeleteStaffContract(ctx context.Context, organizationID, contractID int64) error {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM workforce.staff_contracts WHERE organization_id = ? AND id = ?`, organizationID, contractID); err != nil {
		return fmt.Errorf("workforce postgres: delete staff contract: %w", err)
	}
	return nil
}

func optionalDate(d calendar.Date) *calendar.Date {
	if d.IsZero() {
		return nil
	}
	return &d
}

// --- the school's side -------------------------------------------------------

// SchoolClosedMonths returns the closed, not reopened months of the school's
// employments.
func (s *TraegerStaffStore) SchoolClosedMonths(ctx context.Context, staffIDs []int64) (map[int64][]*domain.StaffMonthBalanceSnapshot, error) {
	db, schoolID, err := schoolStaffDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		StaffID int64 `bun:"staff_id"`
		Year    int   `bun:"year"`
		Month   int   `bun:"month"`
	}
	if err := db.NewRaw(`SELECT staff_id, year, month FROM `+tableMonthSnapshots+`
		WHERE tenant_id = ? AND staff_id = ANY(?) AND reopened_at IS NULL`, schoolID, pgdialect.Array(staffIDs)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: read closed months: %w", err)
	}
	closed := make(map[int64][]*domain.StaffMonthBalanceSnapshot)
	for _, row := range rows {
		closed[row.StaffID] = append(closed[row.StaffID], &domain.StaffMonthBalanceSnapshot{StaffID: row.StaffID, Year: row.Year, Month: row.Month})
	}
	return closed, nil
}

// SchoolOwnTargetOverrides returns the Sonderarbeitszeiten the school keeps
// itself for one employment that end on or after from.
func (s *TraegerStaffStore) SchoolOwnTargetOverrides(ctx context.Context, staffID int64, from calendar.Date) ([]domain.StaffTargetOverride, error) {
	db, schoolID, err := schoolStaffDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []staffTargetOverrideRow
	if err := db.NewSelect().Model(&rows).ModelTableExpr(tableStaffTargetOverrides+` AS "staff_target_override"`).
		Where(`"staff_target_override".tenant_id = ? AND "staff_target_override".staff_id = ?`, schoolID, staffID).
		Where(`"staff_target_override".traeger_contract_id IS NULL AND "staff_target_override".end_date >= ?`, from).Scan(ctx); err != nil {
		return nil, fmt.Errorf("workforce postgres: read school target overrides: %w", err)
	}
	result := make([]domain.StaffTargetOverride, 0, len(rows))
	for _, row := range rows {
		result = append(result, staffTargetOverrideToDomain(row))
	}
	return result, nil
}

// SollKeptStaffIDs returns which of the school's employments a contract of
// its Träger governs on day: a Soll of a contract that has not ended. RLS
// shows a school only the Soll of its own employments.
func (s *TraegerStaffStore) SollKeptStaffIDs(ctx context.Context, staffIDs []int64, day calendar.Date) ([]int64, error) {
	db, schoolID, err := schoolStaffDB(ctx)
	if err != nil {
		return nil, err
	}
	var kept []int64
	if err := db.NewRaw(`SELECT DISTINCT target.membership_id FROM workforce.staff_contract_targets AS target
		JOIN workforce.staff_contracts AS contract ON contract.id = target.contract_id
		WHERE target.school_id = ? AND target.membership_id = ANY(?) AND (contract.ends_on IS NULL OR contract.ends_on >= ?)`,
		schoolID, pgdialect.Array(staffIDs), day).Scan(ctx, &kept); err != nil {
		return nil, fmt.Errorf("workforce postgres: read staff with a Soll of the Träger: %w", err)
	}
	return kept, nil
}

// TraegerKeptStaffByMonth returns, for every month of first..last keyed by
// its first day, which of the school's employments the Träger closes
// (#4711): a contract with a Soll at this school that runs on a day of the
// month. One statement for the whole range; RLS shows a school only the Soll
// of its own employments, so the query holds no Träger id.
func (s *TraegerStaffStore) TraegerKeptStaffByMonth(ctx context.Context, staffIDs []int64, first, last calendar.Date) (map[calendar.Date][]int64, error) {
	kept := map[calendar.Date][]int64{}
	if len(staffIDs) == 0 {
		return kept, nil
	}
	db, schoolID, err := schoolStaffDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Month   calendar.Date `bun:"month,type:date"`
		StaffID int64         `bun:"staff_id"`
	}
	if err := db.NewRaw(`SELECT DISTINCT month.first::date AS month, target.membership_id AS staff_id
		FROM generate_series(date_trunc('month', ?::date), ?::date, interval '1 month') AS month(first)
		JOIN workforce.staff_contract_targets AS target ON target.school_id = ? AND target.membership_id = ANY(?)
		JOIN workforce.staff_contracts AS contract ON contract.id = target.contract_id
		WHERE target.valid_from <= (month.first + interval '1 month - 1 day')::date
		  AND contract.starts_on <= (month.first + interval '1 month - 1 day')::date
		  AND (contract.ends_on IS NULL OR contract.ends_on >= month.first::date)
		ORDER BY month, staff_id`,
		first, last, schoolID, pgdialect.Array(staffIDs)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: read staff the Träger closes: %w", err)
	}
	for _, row := range rows {
		kept[row.Month] = append(kept[row.Month], row.StaffID)
	}
	return kept, nil
}

// KeepTemplateHistory writes the work-time template an employment stands on
// as a schedule version up to the day until, when the employment has no
// schedule version yet. The Soll resolution uses a template only while no
// version exists (#1842); without this, the first mirrored version would
// set the template's earlier open months to zero.
func (s *TraegerStaffStore) KeepTemplateHistory(ctx context.Context, staffID int64, until calendar.Date) error {
	db, schoolID, err := schoolStaffDB(ctx)
	if err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO `+tableStaffWorkSchedules+`
		(tenant_id, staff_id, week_index, rotation_length, day_of_week, target_minutes, start_time, rotation_anchor_date, valid_from, valid_until, created_at, updated_at)
		SELECT profile.tenant_id, profile.membership_id, entry.week_index, model.rotation_length, entry.day_of_week, entry.target_minutes, entry.start_time,
			COALESCE(profile.rotation_anchor_date, model.rotation_anchor_date), DATE '2000-01-01', ?, now(), now()
		FROM users.staff_employment_profiles AS profile
		JOIN config.work_time_models AS model ON model.id = profile.work_time_model_id AND model.tenant_id = profile.tenant_id
		JOIN config.work_time_model_entries AS entry ON entry.model_id = model.id
		WHERE profile.tenant_id = ? AND profile.membership_id = ?
		  AND NOT EXISTS (SELECT FROM `+tableStaffWorkSchedules+` AS schedule WHERE schedule.tenant_id = profile.tenant_id AND schedule.staff_id = profile.membership_id)`,
		until, schoolID, staffID); err != nil {
		return fmt.Errorf("workforce postgres: keep template history before the mirror: %w", err)
	}
	return nil
}

// ReleaseMirror gives an employment back to its school from the day from
// on, after the Träger deleted the only contract that named it: the versions
// the mirror wrote from then on go, the version that ran until then runs on,
// and the Ferien-Soll of the Träger from then on goes.
func (s *TraegerStaffStore) ReleaseMirror(ctx context.Context, staffID int64, from calendar.Date) error {
	db, schoolID, err := schoolStaffDB(ctx)
	if err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM `+tableStaffWorkSchedules+` WHERE tenant_id = ? AND staff_id = ? AND valid_from >= ?`,
		schoolID, staffID, from); err != nil {
		return fmt.Errorf("workforce postgres: drop released mirror versions: %w", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE `+tableStaffWorkSchedules+` SET valid_until = NULL, updated_at = now()
		WHERE tenant_id = ? AND staff_id = ? AND valid_until = ?`, schoolID, staffID, from); err != nil {
		return fmt.Errorf("workforce postgres: reopen the school version: %w", err)
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM `+tableStaffTargetOverrides+`
		WHERE tenant_id = ? AND staff_id = ? AND traeger_contract_id IS NOT NULL AND start_date >= ?`, schoolID, staffID, from); err != nil {
		return fmt.Errorf("workforce postgres: drop released holiday weeks: %w", err)
	}
	return nil
}

// MirrorStaffSchedule replaces the school's schedule versions of one
// employment from the day from on with rows: later versions go, the version
// running over from ends there, and the employment leaves its work-time
// template, so a template change no longer rewrites the Soll.
func (s *TraegerStaffStore) MirrorStaffSchedule(ctx context.Context, staffID int64, from calendar.Date, rows []domain.StaffWorkSchedule) error {
	db, schoolID, err := schoolStaffDB(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	if _, err := db.ExecContext(ctx, `DELETE FROM `+tableStaffWorkSchedules+` WHERE tenant_id = ? AND staff_id = ? AND valid_from >= ?`,
		schoolID, staffID, from); err != nil {
		return fmt.Errorf("workforce postgres: drop mirrored schedule versions: %w", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE `+tableStaffWorkSchedules+` SET valid_until = ?, updated_at = ?
		WHERE tenant_id = ? AND staff_id = ? AND valid_from < ? AND (valid_until IS NULL OR valid_until > ?)`,
		from, now, schoolID, staffID, from, from); err != nil {
		return fmt.Errorf("workforce postgres: end schedule version at the mirror: %w", err)
	}
	if len(rows) > 0 {
		inserts := make([]staffWorkScheduleRow, 0, len(rows))
		for _, row := range rows {
			inserts = append(inserts, staffWorkScheduleRow{
				TenantID: schoolID, StaffID: staffID, WeekIndex: row.WeekIndex, RotationLength: row.RotationLength,
				DayOfWeek: row.DayOfWeek, TargetMinutes: row.TargetMinutes,
				ValidFrom: calendarDate(row.ValidFrom), ValidUntil: optionalCalendarDate(row.ValidUntil), CreatedAt: now, UpdatedAt: now,
			})
		}
		if _, err := db.NewInsert().Model(&inserts).ModelTableExpr(tableStaffWorkSchedules).Exec(ctx); err != nil {
			return fmt.Errorf("workforce postgres: insert mirrored schedule: %w", err)
		}
	}
	if _, err := db.ExecContext(ctx, `UPDATE users.staff_employment_profiles SET work_time_model_id = NULL
		WHERE tenant_id = ? AND membership_id = ? AND work_time_model_id IS NOT NULL`, schoolID, staffID); err != nil {
		return fmt.Errorf("workforce postgres: release work-time template for the mirror: %w", err)
	}
	return nil
}

// MirrorStaffHolidayWeeks replaces the Träger's Sonderarbeitszeiten of one
// employment from the day from on. A new week a Sonderarbeitszeit of the
// school already covers fails with domain.ErrHolidayWeekSchoolOverride.
func (s *TraegerStaffStore) MirrorStaffHolidayWeeks(ctx context.Context, staffID int64, from calendar.Date, overrides []domain.StaffTargetOverride) error {
	db, schoolID, err := schoolStaffDB(ctx)
	if err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM `+tableStaffTargetOverrides+`
		WHERE tenant_id = ? AND staff_id = ? AND traeger_contract_id IS NOT NULL AND start_date >= ?`, schoolID, staffID, from); err != nil {
		return fmt.Errorf("workforce postgres: drop mirrored holiday weeks: %w", err)
	}
	if len(overrides) == 0 {
		return nil
	}
	var remaining []staffTargetOverrideRow
	if err := db.NewSelect().Model(&remaining).ModelTableExpr(tableStaffTargetOverrides+` AS "staff_target_override"`).
		Where(`"staff_target_override".tenant_id = ? AND "staff_target_override".staff_id = ?`, schoolID, staffID).
		Where(`"staff_target_override".end_date >= ?`, from).Scan(ctx); err != nil {
		return fmt.Errorf("workforce postgres: read school target overrides: %w", err)
	}
	inserts := make([]staffTargetOverrideRow, 0, len(overrides))
	for _, override := range overrides {
		for _, other := range remaining {
			if string(other.StartDate) <= override.EndDate && override.StartDate <= string(other.EndDate) {
				week, _ := calendar.ParseDate(override.StartDate)
				return &domain.ContractError{Kind: domain.ErrHolidayWeekSchoolOverride, Field: "week_start", SchoolID: schoolID, FirstOpenDay: week,
					Reason: fmt.Sprintf("school %d already has a Sonderarbeitszeit from %s to %s", schoolID, other.StartDate, other.EndDate)}
			}
		}
		row := staffTargetOverrideFromDomain(override)
		row.TenantID = schoolID
		inserts = append(inserts, *row)
	}
	if _, err := db.NewInsert().Model(&inserts).ModelTableExpr(tableStaffTargetOverrides).Exec(ctx); err != nil {
		return fmt.Errorf("workforce postgres: insert mirrored holiday weeks: %w", err)
	}
	return nil
}
