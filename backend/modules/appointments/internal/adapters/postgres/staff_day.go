package postgres

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/appointments"
	"github.com/moto-ogs/project-phoenix/modules/appointments/internal/domain"
)

// staffDayRow is one appointment with its rule and at most one override: the
// left joins repeat the appointment for every override that may reach the day.
type staffDayRow struct {
	appointmentRow

	RuleID              *int64       `bun:"rule_id"`
	RuleCreatedAt       *time.Time   `bun:"rule_created_at"`
	RuleUpdatedAt       *time.Time   `bun:"rule_updated_at"`
	RuleFrequency       *string      `bun:"rule_frequency"`
	RuleIntervalCount   *int         `bun:"rule_interval_count"`
	RuleWeekdays        []string     `bun:"rule_weekdays,array"`
	RuleMonthDays       []int        `bun:"rule_month_days,array"`
	RuleEndsOn          *domain.Date `bun:"rule_ends_on,type:date"`
	RuleOccurrenceCount *int         `bun:"rule_occurrence_count"`

	OverrideID             *int64       `bun:"override_id"`
	OverrideCreatedAt      *time.Time   `bun:"override_created_at"`
	OverrideUpdatedAt      *time.Time   `bun:"override_updated_at"`
	OverrideOccurrenceDate *domain.Date `bun:"override_occurrence_date,type:date"`
	OverrideCancelled      *bool        `bun:"override_cancelled"`
	OverrideTitle          *string      `bun:"override_title"`
	OverrideDescription    *string      `bun:"override_description"`
	OverrideLocation       *string      `bun:"override_location"`
	OverrideStartDate      *domain.Date `bun:"override_start_date,type:date"`
	OverrideEndDate        *domain.Date `bun:"override_end_date,type:date"`
	OverrideStartTime      *time.Time   `bun:"override_start_time"`
	OverrideEndTime        *time.Time   `bun:"override_end_time"`
	OverrideAllDay         *bool        `bun:"override_all_day"`
}

const staffDayRuleColumns = `"rule".id AS rule_id, "rule".created_at AS rule_created_at, "rule".updated_at AS rule_updated_at,
	"rule".frequency AS rule_frequency, "rule".interval_count AS rule_interval_count,
	"rule".weekdays AS rule_weekdays, "rule".month_days AS rule_month_days,
	"rule".ends_on AS rule_ends_on, "rule".occurrence_count AS rule_occurrence_count`

const staffDayOverrideColumns = `"occurrence".id AS override_id, "occurrence".created_at AS override_created_at,
	"occurrence".updated_at AS override_updated_at, "occurrence".occurrence_date AS override_occurrence_date,
	"occurrence".cancelled AS override_cancelled, "occurrence".title AS override_title,
	"occurrence".description AS override_description, "occurrence".location AS override_location,
	"occurrence".start_date AS override_start_date, "occurrence".end_date AS override_end_date,
	"occurrence".start_time AS override_start_time, "occurrence".end_time AS override_end_time,
	"occurrence".all_day AS override_all_day`

// ListStaffDayAppointments reads the appointments the staff member sees in
// the own calendar on the day, the rule of each and the overrides of the dates
// that may reach the day, ordered like ListAppointmentsVisibleToStaff and
// each appointment's overrides by date. It returns one value per joined row:
// an appointment repeats for each of its overrides and the application folds
// them.
func (s *Store) ListStaffDayAppointments(ctx context.Context, staffID int64, day appointments.Date) ([]appointments.StaffDayAppointment, domain.OperationStats, error) {
	db, tenantID, err := s.databaseForTenant(ctx, "list a staff day")
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	rows := []staffDayRow{}
	query := db.NewSelect().Model(&rows).ModelTableExpr(appointmentTable).
		ColumnExpr(`"appointment".*`).
		ColumnExpr(staffDayRuleColumns).
		ColumnExpr(staffDayOverrideColumns).
		Join(`LEFT JOIN calendar.recurrence_rules AS "rule" ON "rule".appointment_id = "appointment".id AND "rule".tenant_id = "appointment".tenant_id`).
		Join(`LEFT JOIN calendar.appointment_occurrence_overrides AS "occurrence"
			ON "occurrence".appointment_id = "appointment".id AND "occurrence".tenant_id = "appointment".tenant_id
			AND "occurrence".occurrence_date <= ?
			AND "occurrence".occurrence_date >= ?::date - LEAST("appointment".end_date - "appointment".start_date, ?)`,
			domain.Date(day), domain.Date(day), appointments.StaffDaySpanDays).
		Where(staffVisibilitySQL, staffID, recipientTypeStaff, staffID).
		Where(`"appointment".deleted_at IS NULL`).
		OrderExpr(`"appointment".start_date, "appointment".start_time, "appointment".id, "occurrence".occurrence_date, "occurrence".id`)
	query = withTenant(applyAppointmentWindow(query, day, day), "appointment", tenantID)
	stats, err := scanAll(ctx, query, "list staff day appointments")
	stats.Rows = int64(len(rows))
	if err != nil {
		return nil, stats, err
	}
	return staffDayToPublic(rows), stats, nil
}

// staffDayToPublic maps every joined row onto a value with at most one
// override, in the order of the statement.
func staffDayToPublic(rows []staffDayRow) []appointments.StaffDayAppointment {
	result := make([]appointments.StaffDayAppointment, 0, len(rows))
	for _, row := range rows {
		value := appointments.StaffDayAppointment{Appointment: appointmentToPublic(row.appointmentRow), Rule: row.rule()}
		if override := row.override(); override != nil {
			value.Overrides = []*appointments.AppointmentOccurrenceOverride{override}
		}
		result = append(result, value)
	}
	return result
}

func (row staffDayRow) rule() *appointments.RecurrenceRule {
	if row.RuleID == nil {
		return nil
	}
	rule := recurrenceRuleRow{
		ID: *row.RuleID, TenantID: row.TenantID, AppointmentID: row.ID,
		Weekdays: row.RuleWeekdays, MonthDays: row.RuleMonthDays,
		EndsOn: row.RuleEndsOn, OccurrenceCount: row.RuleOccurrenceCount,
	}
	rule.CreatedAt, rule.UpdatedAt = valueOf(row.RuleCreatedAt), valueOf(row.RuleUpdatedAt)
	rule.Frequency, rule.IntervalCount = valueOf(row.RuleFrequency), valueOf(row.RuleIntervalCount)
	return recurrenceRuleToPublic(rule)
}

func (row staffDayRow) override() *appointments.AppointmentOccurrenceOverride {
	if row.OverrideID == nil {
		return nil
	}
	override := occurrenceOverrideRow{
		ID: *row.OverrideID, TenantID: row.TenantID, AppointmentID: row.ID,
		Title: row.OverrideTitle, Description: row.OverrideDescription, Location: row.OverrideLocation,
		StartDate: row.OverrideStartDate, EndDate: row.OverrideEndDate,
		StartTime: row.OverrideStartTime, EndTime: row.OverrideEndTime, AllDay: row.OverrideAllDay,
	}
	override.CreatedAt, override.UpdatedAt = valueOf(row.OverrideCreatedAt), valueOf(row.OverrideUpdatedAt)
	override.OccurrenceDate, override.Cancelled = valueOf(row.OverrideOccurrenceDate), valueOf(row.OverrideCancelled)
	return occurrenceOverrideToPublic(override)
}

// valueOf reads a column of a left-joined row that is set whenever its
// row's id is.
func valueOf[T any](value *T) T {
	var zero T
	if value == nil {
		return zero
	}
	return *value
}
