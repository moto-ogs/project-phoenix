package ports

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Store is the persistence port over config.work_time_models,
// config.work_time_model_entries and config.staff_work_schedules. Reads and
// writes honour the tenant in context when one is bound.
type Store interface {
	PayrollRulesStore
	ClosedMonthSnapshotsForStaff(context.Context, []int64) ([]*domain.StaffMonthBalanceSnapshot, domain.OperationStats, error)
	LatestClosedMonth(context.Context, int64, int, int) (*domain.StaffMonthBalanceSnapshot, domain.OperationStats, error)
	ClosedMonthSnapshots(context.Context, int, int) ([]*domain.StaffMonthBalanceSnapshot, domain.OperationStats, error)
	RecordClosedMonth(context.Context, domain.StaffMonthBalanceSnapshot) (domain.StaffMonthBalanceSnapshot, domain.OperationStats, error)
	ReopenMonthSnapshot(context.Context, int64, int64, time.Time, string) (int64, domain.OperationStats, error)
	PreviewStaffOffboarding(context.Context, int64, string) (domain.OffboardingSnapshot, domain.OperationStats, error)
	ListWorkTimeModels(context.Context) ([]domain.WorkTimeModel, domain.OperationStats, error)
	FindWorkTimeModel(context.Context, int64) (domain.WorkTimeModel, bool, domain.OperationStats, error)
	// LockWorkTimeModel takes the row lock an edit of the template writes
	// under; found=false for an unknown template.
	LockWorkTimeModel(ctx context.Context, id int64) (bool, domain.OperationStats, error)
	ListWorkTimeModelsByIDs(context.Context, []int64) ([]domain.WorkTimeModel, domain.OperationStats, error)
	CreateWorkTimeModel(context.Context, domain.WorkTimeModelFields) (domain.WorkTimeModel, domain.OperationStats, error)
	// UpdateWorkTimeModel replaces the template metadata and every entry.
	// A missing template reports found=false.
	UpdateWorkTimeModel(context.Context, int64, domain.WorkTimeModelFields) (domain.WorkTimeModel, bool, domain.OperationStats, error)
	DeleteWorkTimeModel(context.Context, int64) (bool, domain.OperationStats, error)
	// SetWorkTimeModelArchived archives a template or offers it again.
	SetWorkTimeModelArchived(ctx context.Context, id int64, archived bool) (domain.WorkTimeModel, bool, domain.OperationStats, error)
	// StaffOnWorkTimeModel lists every membership bound to the template, live
	// or retired; ReleaseWorkTimeModel detaches the given ones from it.
	StaffOnWorkTimeModel(ctx context.Context, workTimeModelID int64) ([]int64, error)
	ReleaseWorkTimeModel(ctx context.Context, workTimeModelID int64, membershipIDs []int64) error

	// CloseStaffSchedules sets an exclusive valid_until on every running
	// version of the given staff members.
	CloseStaffSchedules(ctx context.Context, staffIDs []int64, until string) (domain.OperationStats, error)
	// InsertStaffSchedules writes the given rows as new current versions in
	// one statement.
	InsertStaffSchedules(ctx context.Context, rows []domain.StaffWorkSchedule) (domain.OperationStats, error)

	CurrentStaffSchedule(ctx context.Context, staffID int64, today string) ([]domain.StaffWorkSchedule, domain.OperationStats, error)
	StaffScheduleOn(ctx context.Context, staffID int64, date string) ([]domain.StaffWorkSchedule, domain.OperationStats, error)
	StaffSchedulesInRange(ctx context.Context, staffIDs []int64, from, to string) ([]domain.StaffWorkSchedule, domain.OperationStats, error)
	StaffPlanningProfiles(ctx context.Context, staffIDs []int64, from, to string) ([]domain.StaffPlanningProfile, domain.OperationStats, error)
	HasStaffScheduleHistory(context.Context, int64) (bool, domain.OperationStats, error)
	StaffIDsWithScheduleHistory(context.Context, []int64) (map[int64]bool, domain.OperationStats, error)

	AbsenceStore
	SubstitutionStore
	ShiftStore
	WorkSessionStore
	StaffRecordStore
	TargetOverrideStore
	WorkTimeModelAssignmentStore
}

// WorkTimeModelAssignmentStore serves the assignment of one template to
// several staff members (#6921) over users.staff_employment_profiles,
// config.staff_work_schedules, active.staff_month_balance_snapshots and the
// Träger's contract targets. Every read and write is set-based.
type WorkTimeModelAssignmentStore interface {
	// ShareLockWorkTimeModel holds the template row FOR SHARE until commit,
	// so an edit of the template waits for the assignment and then refreshes
	// the members it bound; found=false for an unknown template.
	ShareLockWorkTimeModel(ctx context.Context, id int64) (bool, domain.OperationStats, error)
	// StaffWorkTimeFacts reads, in one statement, every staff member of the
	// school with a template binding, a schedule, a Soll of the Träger or a
	// closed month.
	StaffWorkTimeFacts(ctx context.Context, today string) ([]domain.StaffWorkTimeFact, domain.OperationStats, error)
	// StaffWorkTimeModelBindings returns the template each given member is
	// bound to; members without one are absent.
	StaffWorkTimeModelBindings(ctx context.Context, staffIDs []int64) (map[int64]int64, domain.OperationStats, error)
	// StaffSollKeptByTraeger returns which of the given members a contract
	// of the Träger governs on day.
	StaffSollKeptByTraeger(ctx context.Context, staffIDs []int64, day string) ([]int64, domain.OperationStats, error)
	// BindStaffWorkTimeModel binds the template and its anchor to every
	// given member in one statement, creating missing profiles.
	BindStaffWorkTimeModel(ctx context.Context, staffIDs []int64, workTimeModelID int64, anchorDate string) (domain.OperationStats, error)
}

// WorkSessionStore is the persistence port over active.work_sessions,
// active.work_session_breaks, active.staff_balance_adjustments,
// active.staff_vacation_openings and active.staff_vacation_quota. A missing
// row reports found=false; a rejected duplicate reports domain.ConflictError.
type WorkSessionStore interface {
	FindWorkSession(context.Context, int64) (workforce.WorkSession, bool, domain.OperationStats, error)
	// LockOpenWorkSession returns and row-locks a still running block.
	LockOpenWorkSession(context.Context, int64) (workforce.WorkSession, bool, domain.OperationStats, error)
	// OpenWorkSessionOn returns the running block of a staff member filed on
	// the day, optionally row-locked.
	OpenWorkSessionOn(ctx context.Context, staffID int64, date string, lock bool) (workforce.WorkSession, bool, domain.OperationStats, error)
	// LatestOpenWorkSession returns the most recent block that is still
	// running inside the live window as of now, whatever day it was filed on;
	// today is the calendar day of now.
	LatestOpenWorkSession(ctx context.Context, staffID int64, today string, now time.Time) (workforce.WorkSession, bool, domain.OperationStats, error)
	ListWorkSessions(context.Context, workforce.WorkSessionFilter) ([]workforce.WorkSession, domain.OperationStats, error)
	// ListOverlappingWorkSessions returns the blocks of the staff members
	// whose [check-in, check-out) interval intersects [from, to); a nil to is
	// open-ended. Ordered by staff, then check-in.
	ListOverlappingWorkSessions(ctx context.Context, staffIDs []int64, from time.Time, to *time.Time) ([]workforce.WorkSession, domain.OperationStats, error)
	CountWorkSessions(context.Context, workforce.WorkSessionFilter) (int, domain.OperationStats, error)
	OldestWorkSessionDate(ctx context.Context, before string) (string, domain.OperationStats, error)
	DeleteWorkSessionsOlderThan(ctx context.Context, cutoff string) (int64, domain.OperationStats, error)
	// WorkPresenceMap maps staff to their work status as of now: the status of
	// a live open block, otherwise checked_out for a block filed today.
	WorkPresenceMap(ctx context.Context, today string, now time.Time) (map[int64]string, domain.OperationStats, error)
	CreateWorkSession(context.Context, workforce.WorkSession) (workforce.WorkSession, domain.OperationStats, error)
	UpdateWorkSession(context.Context, workforce.WorkSession) (workforce.WorkSession, bool, domain.OperationStats, error)
	DeleteWorkSession(context.Context, int64) (domain.OperationStats, error)
	SetWorkSessionBreakMinutes(ctx context.Context, id int64, minutes int) (int64, domain.OperationStats, error)
	// CloseWorkSession stamps the check-out on a still open block; closed
	// reports whether a row was actually closed.
	CloseWorkSession(ctx context.Context, id int64, checkOut time.Time, autoCheckedOut bool, credit workforce.WorkSessionCreditRule) (bool, domain.OperationStats, error)

	FindWorkSessionBreak(context.Context, int64) (workforce.WorkSessionBreak, bool, domain.OperationStats, error)
	ListWorkSessionBreaks(context.Context, workforce.WorkSessionBreakFilter) ([]workforce.WorkSessionBreak, domain.OperationStats, error)
	// ExpiredWorkSessionBreaks returns the running breaks whose planned end
	// has passed.
	ExpiredWorkSessionBreaks(ctx context.Context, before time.Time) ([]workforce.WorkSessionBreak, domain.OperationStats, error)
	CreateWorkSessionBreak(context.Context, workforce.WorkSessionBreak) (workforce.WorkSessionBreak, domain.OperationStats, error)
	UpdateWorkSessionBreak(context.Context, workforce.WorkSessionBreak) (workforce.WorkSessionBreak, bool, domain.OperationStats, error)
	DeleteWorkSessionBreak(context.Context, int64) (domain.OperationStats, error)
	// EndWorkSessionBreak stamps the end on a still running break only.
	EndWorkSessionBreak(ctx context.Context, id int64, endedAt time.Time, durationMinutes int) (int64, domain.OperationStats, error)
	// SetWorkSessionBreakDuration rewrites the length and end of a break.
	SetWorkSessionBreakDuration(ctx context.Context, id int64, durationMinutes int, endedAt time.Time) (int64, domain.OperationStats, error)

	FindStaffBalanceAdjustment(context.Context, int64) (workforce.StaffBalanceAdjustment, bool, domain.OperationStats, error)
	ListStaffBalanceAdjustments(context.Context, workforce.StaffBalanceAdjustmentFilter) ([]workforce.StaffBalanceAdjustment, domain.OperationStats, error)
	CreateStaffBalanceAdjustment(context.Context, workforce.StaffBalanceAdjustment) (workforce.StaffBalanceAdjustment, domain.OperationStats, error)
	UpdateStaffBalanceAdjustment(context.Context, workforce.StaffBalanceAdjustment) (workforce.StaffBalanceAdjustment, bool, domain.OperationStats, error)
	DeleteStaffBalanceAdjustment(context.Context, int64) (domain.OperationStats, error)

	FindStaffVacationOpening(context.Context, int64) (domain.StaffVacationOpening, bool, domain.OperationStats, error)
	ListStaffVacationOpenings(context.Context, workforce.StaffVacationFilter) ([]domain.StaffVacationOpening, domain.OperationStats, error)
	CreateStaffVacationOpening(context.Context, domain.StaffVacationOpening) (domain.StaffVacationOpening, domain.OperationStats, error)
	UpdateStaffVacationOpening(context.Context, domain.StaffVacationOpening) (domain.StaffVacationOpening, bool, domain.OperationStats, error)
	DeleteStaffVacationOpening(context.Context, int64) (domain.OperationStats, error)

	FindStaffVacationQuota(context.Context, int64) (workforce.StaffVacationQuota, bool, domain.OperationStats, error)
	ListStaffVacationQuotas(context.Context, workforce.StaffVacationFilter) ([]workforce.StaffVacationQuota, domain.OperationStats, error)
	CreateStaffVacationQuota(context.Context, workforce.StaffVacationQuota) (workforce.StaffVacationQuota, domain.OperationStats, error)
	UpdateStaffVacationQuota(context.Context, workforce.StaffVacationQuota) (workforce.StaffVacationQuota, bool, domain.OperationStats, error)
	DeleteStaffVacationQuota(context.Context, int64) (domain.OperationStats, error)
	// UpsertStaffVacationQuota writes the entitlement of one staff member and
	// year, replacing the day counts of an existing row.
	UpsertStaffVacationQuota(context.Context, workforce.StaffVacationQuota) (domain.OperationStats, error)
}

// StaffRecordStore is the persistence port over users.staff_master_data,
// users.staff_qualifications, users.staff_financial_data,
// users.staff_documents and users.staff_document_file_cleanup.
type StaffRecordStore interface {
	FindStaffMasterData(ctx context.Context, staffID int64) (domain.StaffMasterData, bool, domain.OperationStats, error)
	CreateStaffMasterData(context.Context, domain.StaffMasterData) (domain.StaffMasterData, domain.OperationStats, error)
	UpdateStaffMasterData(context.Context, domain.StaffMasterData) (domain.StaffMasterData, bool, domain.OperationStats, error)

	// ListStaffQualifications returns the live rows; retired rows stay in
	// the table as history (ADR 0021).
	ListStaffQualifications(ctx context.Context, staffID int64) ([]domain.StaffQualification, domain.OperationStats, error)
	// RetireStaffQualifications soft-deletes the given live rows of one
	// staff member.
	RetireStaffQualifications(ctx context.Context, staffID int64, ids []int64) (domain.OperationStats, error)
	// UpdateStaffQualification rewrites the dates of one live row.
	UpdateStaffQualification(context.Context, domain.StaffQualification) (domain.StaffQualification, bool, domain.OperationStats, error)
	InsertStaffQualifications(context.Context, []domain.StaffQualification) ([]domain.StaffQualification, domain.OperationStats, error)
	// ListLiveQualifications returns every live qualification of the school.
	ListLiveQualifications(context.Context) ([]domain.StaffQualification, domain.OperationStats, error)
	// ClaimQualificationReminder records a reminder stage once per expiry
	// date and reports whether this call claimed it (#4808).
	ClaimQualificationReminder(ctx context.Context, id int64, stage, expiresOn string) (bool, domain.OperationStats, error)

	// The Nachweisarten of the school (#4808). A duplicate live name reports
	// domain.ConflictError with domain.ErrQualificationTypeNameTaken.
	ListQualificationTypes(context.Context) ([]domain.QualificationType, domain.OperationStats, error)
	EnsureStandardQualificationTypes(context.Context, []domain.QualificationType) (domain.OperationStats, error)
	InsertQualificationType(context.Context, domain.QualificationType) (domain.QualificationType, domain.OperationStats, error)
	UpdateQualificationType(context.Context, domain.QualificationType) (domain.QualificationType, bool, domain.OperationStats, error)
	// LockQualificationType takes the row lock an update of the kind writes
	// under; found=false for an unknown kind.
	LockQualificationType(ctx context.Context, id int64) (bool, domain.OperationStats, error)

	FindStaffFinancialData(ctx context.Context, staffID int64) (domain.StaffFinancialData, bool, domain.OperationStats, error)
	CreateStaffFinancialData(context.Context, domain.StaffFinancialData) (domain.StaffFinancialData, domain.OperationStats, error)
	UpdateStaffFinancialData(context.Context, domain.StaffFinancialData) (domain.StaffFinancialData, bool, domain.OperationStats, error)

	CreateStaffDocument(context.Context, domain.StaffDocument) (domain.StaffDocument, domain.OperationStats, error)
	// FindStaffDocument loads one document by the staff/document pair.
	FindStaffDocument(ctx context.Context, staffID, documentID int64, includeDeleted bool) (domain.StaffDocument, bool, domain.OperationStats, error)
	ListStaffDocuments(context.Context, domain.StaffDocumentFilter) ([]domain.StaffDocument, domain.OperationStats, error)
	// SoftDeleteStaffDocument stamps deleted_at and deleted_by on a live row.
	SoftDeleteStaffDocument(ctx context.Context, id, deletedBy int64, at time.Time) (int64, domain.OperationStats, error)
	MarkStaffDocumentFileDeleted(ctx context.Context, id int64, at time.Time) (domain.OperationStats, error)

	// QueueStaffDocumentFileCleanup records the intent once per stored name.
	QueueStaffDocumentFileCleanup(context.Context, domain.StaffDocumentFileCleanup) (domain.OperationStats, error)
	// ListQueuedStaffDocumentFileCleanups returns and row-locks the eligible
	// intents; a positive staffID narrows them to one staff member.
	ListQueuedStaffDocumentFileCleanups(ctx context.Context, staffID int64, now time.Time) ([]domain.StaffDocumentFileCleanup, domain.OperationStats, error)
	CompleteStaffDocumentFileCleanup(ctx context.Context, id int64) (domain.OperationStats, error)
	CompleteStaffDocumentFileCleanupByFilename(ctx context.Context, filename string) (domain.OperationStats, error)
	ActivateStaffDocumentFileCleanup(ctx context.Context, filename string, at time.Time) (domain.OperationStats, error)
}

// ShiftStore is the persistence port over schedule.staff_shifts,
// schedule.staff_shift_series, schedule.staff_shift_series_exceptions and
// schedule.shift_types. A missing row reports found=false; a duplicate
// reports domain.ConflictError.
type ShiftStore interface {
	FindStaffShift(context.Context, int64) (domain.StaffShift, bool, domain.OperationStats, error)
	ListStaffShifts(context.Context, domain.StaffShiftFilter) ([]domain.StaffShift, domain.OperationStats, error)
	// UsedStaffShiftWeeks returns the Monday of every ISO week holding at
	// least one non-cancelled shift in the inclusive range.
	UsedStaffShiftWeeks(ctx context.Context, from, to string) ([]string, domain.OperationStats, error)
	CreateStaffShift(context.Context, domain.StaffShift) (domain.StaffShift, domain.OperationStats, error)
	// CreateStaffShifts inserts every row in one statement and returns them
	// with their identities.
	CreateStaffShifts(context.Context, []domain.StaffShift) ([]domain.StaffShift, domain.OperationStats, error)
	UpdateStaffShift(context.Context, domain.StaffShift) (domain.StaffShift, bool, domain.OperationStats, error)
	// SetStaffShiftSickAbsence writes only the sick-absence association.
	SetStaffShiftSickAbsence(ctx context.Context, shiftID int64, absenceID *int64) (int64, domain.OperationStats, error)
	DeleteStaffShift(context.Context, int64) (domain.OperationStats, error)
	DeleteUpcomingStaffShifts(ctx context.Context, staffID int64, from string) (int64, domain.OperationStats, error)
	// DeleteRegenerableSeriesShifts removes a series' non-detached rows on or
	// after from.
	DeleteRegenerableSeriesShifts(ctx context.Context, seriesID int64, from string) (int64, domain.OperationStats, error)
	// RepointDetachedSeriesShifts moves a series' detached rows whose source
	// slot is on or after from to the successor series.
	RepointDetachedSeriesShifts(ctx context.Context, fromSeriesID, toSeriesID int64, from string) (int64, domain.OperationStats, error)

	FindStaffShiftSeries(context.Context, int64) (domain.StaffShiftSeries, bool, domain.OperationStats, error)
	// FindOverlappingSeriesInLineage returns the chronologically first other
	// segment of a split lineage still active on or after from.
	FindOverlappingSeriesInLineage(ctx context.Context, rootID, excludeID int64, from string) (domain.StaffShiftSeries, bool, domain.OperationStats, error)
	CreateStaffShiftSeries(context.Context, domain.StaffShiftSeries) (domain.StaffShiftSeries, domain.OperationStats, error)
	UpdateStaffShiftSeries(context.Context, domain.StaffShiftSeries) (domain.StaffShiftSeries, bool, domain.OperationStats, error)
	DeleteStaffShiftSeries(context.Context, int64) (domain.OperationStats, error)
	// CapStaffShiftSeries bounds one segment at the exclusive date, keeping
	// an already tighter bound and never moving below valid_from.
	CapStaffShiftSeries(ctx context.Context, id int64, until string) (domain.OperationStats, error)
	// CapStaffShiftSeriesForStaff bounds every segment of one staff member.
	CapStaffShiftSeriesForStaff(ctx context.Context, staffID int64, until string) (int64, domain.OperationStats, error)

	// RecordSeriesException stores the removed occurrence; recording the same
	// slot again is a successful no-op.
	RecordSeriesException(context.Context, domain.StaffShiftSeriesException) (domain.OperationStats, error)
	SeriesExceptionDates(ctx context.Context, seriesID int64) ([]string, domain.OperationStats, error)
	RepointSeriesExceptions(ctx context.Context, fromSeriesID, toSeriesID int64, from string) (int64, domain.OperationStats, error)

	ListShiftTypes(context.Context) ([]domain.ShiftType, domain.OperationStats, error)
	FindShiftType(context.Context, int64) (domain.ShiftType, bool, domain.OperationStats, error)
	CreateShiftType(context.Context, domain.ShiftType) (domain.ShiftType, domain.OperationStats, error)
	// CreateShiftTypeIfAbsent inserts unless a type with the same name exists
	// in the tenant; created reports whether a row was written.
	CreateShiftTypeIfAbsent(context.Context, domain.ShiftType) (domain.ShiftType, bool, domain.OperationStats, error)
	UpdateShiftType(context.Context, domain.ShiftType) (domain.ShiftType, bool, domain.OperationStats, error)
	DeleteShiftType(context.Context, int64) (domain.OperationStats, error)
	ShiftTypeRetirementStore
}

// ShiftTypeRetirementStore archives shift types that planned rows still
// carry and counts those rows (#6845).
type ShiftTypeRetirementStore interface {
	// LockShiftType holds the type row until the transaction ends; a
	// concurrent shift or series write naming the type waits on its FK
	// check. A missing type reports found=false.
	LockShiftType(context.Context, int64) (bool, domain.OperationStats, error)
	// LockShiftTypeForEdit holds the type row FOR NO KEY UPDATE until the
	// transaction ends: concurrent edits wait, a shift or series naming the
	// type does not. A missing type reports found=false.
	LockShiftTypeForEdit(context.Context, int64) (bool, domain.OperationStats, error)
	// ArchiveShiftType stamps archived_at once; a missing type reports
	// found=false.
	ArchiveShiftType(context.Context, int64) (domain.ShiftType, bool, domain.OperationStats, error)
	// CountShiftTypeReferences counts the shifts and series carrying one
	// type in one statement.
	CountShiftTypeReferences(ctx context.Context, shiftTypeID int64) (domain.ShiftTypeReferences, domain.OperationStats, error)
	// CountShiftPlanReferences counts the shifts and series per type and the
	// series per calendar period in one statement.
	CountShiftPlanReferences(context.Context) (domain.ShiftPlanReferences, domain.OperationStats, error)
}

// AbsenceStore is the persistence port over active.staff_absences,
// active.staff_absence_types and active.staff_absence_audit. A missing row
// reports found=false; a duplicate reports domain.ConflictError.
type AbsenceStore interface {
	StaffAbsenceTypeEntitlements(ctx context.Context, staffID, absenceTypeID int64) (map[int]float64, domain.OperationStats, error)
	// StaffEntitlementsByAbsenceType returns every yearly claim of one person,
	// keyed by type and year.
	StaffEntitlementsByAbsenceType(ctx context.Context, staffID int64) (map[int64]map[int]float64, domain.OperationStats, error)
	// AbsencePoolRecord returns the Personalakte that keeps the school's
	// employment, 0 without one (#4710).
	AbsencePoolRecord(ctx context.Context, staffID int64) (int64, domain.OperationStats, error)
	// AbsencePoolClaims holds the Kontingente of the Träger's types of a
	// record until the transaction ends and reads their claims.
	AbsencePoolClaims(ctx context.Context, recordID int64, traegerTypeIDs []int64) (map[int64]domain.AbsencePoolType, domain.OperationStats, error)
	// AbsencePoolUses reads the bookings of those types at every Einsatzort
	// of the record that overlap [from, to].
	AbsencePoolUses(ctx context.Context, recordID int64, traegerTypeIDs []int64, from, to string) ([]domain.AbsencePoolUse, domain.OperationStats, error)
	UpsertStaffAbsenceTypeAllowance(context.Context, domain.SetAbsenceTypeAllowance) (domain.OperationStats, error)
	RecordStaffAbsenceTypeAllowanceChange(context.Context, domain.SetAbsenceTypeAllowance, *float64) (domain.OperationStats, error)
	FindStaffAbsence(context.Context, int64) (domain.StaffAbsence, bool, domain.OperationStats, error)
	ListStaffAbsences(context.Context, domain.StaffAbsenceFilter) ([]domain.StaffAbsence, domain.OperationStats, error)
	CountStaffAbsences(context.Context, domain.StaffAbsenceFilter) (int, domain.OperationStats, error)
	ListStaffAbsenceRequests(context.Context, domain.StaffAbsenceRequestFilter) ([]domain.StaffAbsence, domain.OperationStats, error)
	// EffectiveStaffAbsencesOn returns the effective absences covering the
	// day, ordered by staff, type priority and ID.
	EffectiveStaffAbsencesOn(ctx context.Context, date string) ([]domain.StaffAbsence, domain.OperationStats, error)
	OldestStaffAbsenceDate(ctx context.Context, column, before string) (string, domain.OperationStats, error)
	CreateStaffAbsence(context.Context, domain.StaffAbsence) (domain.StaffAbsence, domain.OperationStats, error)
	UpdateStaffAbsence(context.Context, domain.StaffAbsence) (domain.StaffAbsence, bool, domain.OperationStats, error)
	DeleteStaffAbsence(context.Context, int64) (domain.OperationStats, error)
	DeleteNonHistoricalStaffAbsences(ctx context.Context, staffID int64, from string) (int64, domain.OperationStats, error)
	DeleteStaffAbsencesOlderThan(ctx context.Context, column, cutoff string) (int64, domain.OperationStats, error)

	ListStaffAbsenceTypes(context.Context) ([]domain.StaffAbsenceType, domain.OperationStats, error)
	FindStaffAbsenceType(ctx context.Context, id int64, lock bool) (domain.StaffAbsenceType, bool, domain.OperationStats, error)
	StaffAbsenceTypeInUse(context.Context, int64) (bool, domain.OperationStats, error)
	CreateStaffAbsenceType(context.Context, domain.StaffAbsenceTypeFields) (domain.StaffAbsenceType, domain.OperationStats, error)
	UpdateStaffAbsenceType(context.Context, domain.StaffAbsenceType) (domain.StaffAbsenceType, bool, domain.OperationStats, error)

	RecordStaffAbsenceAudit(context.Context, domain.StaffAbsenceAudit) (domain.StaffAbsenceAudit, domain.OperationStats, error)
}

// SubstitutionStore is the persistence port over education.group_substitution.
type SubstitutionStore interface {
	FindGroupSubstitution(ctx context.Context, id int64, lock bool) (domain.GroupSubstitution, bool, domain.OperationStats, error)
	ListGroupSubstitutions(context.Context, domain.GroupSubstitutionFilter) ([]domain.GroupSubstitution, domain.OperationStats, error)
	// ListStaffAbsencesAndGroupSubstitutions reads both lists in one
	// statement (#7903).
	ListStaffAbsencesAndGroupSubstitutions(context.Context, domain.StaffAbsenceFilter, domain.GroupSubstitutionFilter) ([]domain.StaffAbsence, []domain.GroupSubstitution, domain.OperationStats, error)
	CreateGroupSubstitution(context.Context, domain.GroupSubstitution) (domain.GroupSubstitution, domain.OperationStats, error)
	UpdateGroupSubstitution(context.Context, domain.GroupSubstitution) (domain.GroupSubstitution, bool, domain.OperationStats, error)
	DeleteGroupSubstitution(context.Context, int64) (domain.OperationStats, error)
	DeleteGroupSubstitutionsForStaff(ctx context.Context, staffID int64, from string) (int64, domain.OperationStats, error)
	LockGroupSubstitutions(context.Context) (domain.OperationStats, error)
}

// StaffAssignments is the consumer-owned port over the School Membership rows
// that bind staff to a template. Workforce never joins users.staff itself.
type StaffAssignments interface {
	// AssignedStaffIDs returns the live staff members assigned to a template.
	AssignedStaffIDs(ctx context.Context, workTimeModelID int64) ([]int64, error)
	// AssignedStaffByModel returns the live assignees of every template of
	// the caller's school in one read; unused templates are absent.
	AssignedStaffByModel(ctx context.Context) (map[int64][]int64, error)
	// RebaseAnchor stamps the template's rotation anchor onto the given
	// assignees, which the caller has already resolved.
	RebaseAnchor(ctx context.Context, staffIDs []int64, anchorDate string) error
	// LiveStaffIDs returns the given memberships School Membership still
	// holds as live, ascending.
	LiveStaffIDs(ctx context.Context, staffIDs []int64) ([]int64, error)
}

// Transaction runs a unit of work on the caller's ambient transaction or, when
// there is none, opens one.
type Transaction interface {
	RunRead(context.Context, func(context.Context) error) error
	RunWrite(context.Context, func(context.Context) error) error
	// LockStaffQualifications serializes list replacements per staff member.
	LockStaffQualifications(ctx context.Context, staffID int64) error
	// LockStaffBalance serializes writes that change a staff member's Soll.
	LockStaffBalance(ctx context.Context, staffID int64) error
	// LockStaffAbsence serializes overlap-sensitive absence writes of one
	// staff member. Callers take LockStaffBalance first, because an effective
	// absence also changes the Stundenkonto.
	LockStaffAbsence(ctx context.Context, staffID int64) error
	LockStaffShifts(ctx context.Context, staffID int64) error
}

// Clock supplies the calendar day new schedule versions start on and the
// instant live work-session windows are measured against.
type Clock interface {
	Today() string
	Now() time.Time
}

type Observation struct {
	Operation string
	Duration  time.Duration
	Stats     domain.OperationStats
	Err       error
}

type Observer func(Observation)

// StaffSubjects is the consumer-owned port over the staff and person rows
// behind a personnel record. School Membership and People Directory own them;
// Workforce never reads or writes them itself. Failures pass through
// unchanged, so a missing row keeps the repository not-found shape the HTTP
// layer classifies as 404.
type StaffSubjects interface {
	// StaffWithPerson reads a live or retained staff member with its person.
	// Erased employments are excluded; writes use the live-only lock.
	StaffWithPerson(ctx context.Context, staffID int64) (domain.StaffSubject, error)
	// StaffExists proves the live staff member is visible in the tenant.
	StaffExists(ctx context.Context, staffID int64) error
	// LockStaff locks the staff row for the caller's transaction and, with
	// withPerson, the person row too.
	LockStaff(ctx context.Context, staffID int64, withPerson bool) (domain.StaffSubject, error)
	// UpdatePerson writes the names and the birthday of a locked person.
	UpdatePerson(ctx context.Context, personID int64, firstName, lastName string, birthday *string) error
	// SetEmploymentType writes the employment type of a locked staff row.
	SetEmploymentType(ctx context.Context, staffID int64, value *string) error
	// SetPersonnelNumber writes the personnel number of a locked staff row and
	// reports domain.ErrStaffPersonnelNumberTaken on a per-tenant duplicate.
	SetPersonnelNumber(ctx context.Context, staffID int64, value *string) error
	// OffboardedStaffIDs returns every staff member School Membership retired.
	OffboardedStaffIDs(ctx context.Context) ([]int64, error)
}

// StaffAdminAudit is the consumer-owned port over the audit trail of the
// personnel record. Each call joins the caller's tenant transaction.
type StaffAdminAudit interface {
	RecordMasterDataChange(context.Context, domain.MasterDataChange) error
	RecordPersonnelNumberChange(context.Context, domain.PersonnelNumberChange) error
	RecordDataAccess(context.Context, domain.DataAccess) error
}

// TraegerStaffStore is the persistence of the Personalstamm (#4705). The
// Träger methods join the Träger transaction of the record's Träger, the
// school methods the tenant transaction of one school, the release methods
// the administrative transaction of the moto team.
type TraegerStaffStore interface {
	TraegerStaffRelease(ctx context.Context, organizationID int64) (*domain.TraegerStaffRelease, error)
	ListStaffRecords(ctx context.Context, organizationID int64) ([]domain.TraegerStaffRecord, error)
	FindStaffRecord(ctx context.Context, organizationID, recordID int64, forUpdate bool) (domain.TraegerStaffRecord, error)
	LinkedEmployments(ctx context.Context, organizationID int64, schoolIDs, staffIDs []int64) ([]domain.TraegerStaffLink, error)
	SaveStaffRecord(ctx context.Context, record domain.TraegerStaffRecord) (int64, error)
	SealStaffRecord(ctx context.Context, record domain.TraegerStaffRecord) error
	InsertStaffLinks(ctx context.Context, organizationID, recordID, accountID int64, links []domain.TraegerStaffLink) error
	AppendStaffChanges(ctx context.Context, organizationID int64, changes []domain.TraegerStaffChange) error
	ListStaffChanges(ctx context.Context, organizationID, recordID int64, limit int) ([]domain.TraegerStaffChange, error)
	// FinancialChangeTimes returns, per bank and tax field, the newest trail
	// entry that changed or imported it, on the database clock.
	FinancialChangeTimes(ctx context.Context, organizationID, recordID int64) (map[string]time.Time, error)
	DeleteStaffRecord(ctx context.Context, organizationID, recordID int64) error

	// The Abwesenheitsarten and Kontingente of the Träger (#4710).
	ListTraegerAbsenceTypes(ctx context.Context, organizationID int64) ([]domain.TraegerAbsenceType, error)
	FindTraegerAbsenceType(ctx context.Context, organizationID, id int64, forUpdate bool) (domain.TraegerAbsenceType, error)
	SaveTraegerAbsenceType(ctx context.Context, value domain.TraegerAbsenceType) (domain.TraegerAbsenceType, error)
	TraegerAbsencePool(ctx context.Context, organizationID, recordID int64, typeIDs []int64, from, to string, lock bool) (map[int64]domain.AbsencePoolType, []domain.AbsencePoolUse, error)
	SaveTraegerAbsenceAllowance(ctx context.Context, organizationID, accountID int64, input workforce.SetTraegerAbsenceAllowance, previous *float64, now time.Time) error
	SchoolAbsenceTypes(ctx context.Context) ([]domain.StaffAbsenceType, error)
	SchoolAbsenceTypeInUse(ctx context.Context, schoolTypeID int64) (bool, error)
	CarryTraegerAbsenceType(ctx context.Context, schoolTypeID int64, value domain.TraegerAbsenceType) error
	TraegerStaffContractStore

	TraegerStaffKeep
	SchoolFinancialRows(ctx context.Context, staffIDs []int64) ([]domain.StaffFinancialData, error)
	DeleteSchoolFinancialRow(ctx context.Context, staffID int64) error
	// HoldSchoolFinancialRow stamps the school's bank row of a linked
	// employment that the link did not read, so later hand-overs keep it.
	HoldSchoolFinancialRow(ctx context.Context, staffID int64) error
	// InsertSchoolFinancialRow writes the school's bank row a dissolution
	// decided: a new row, or the decided values over the existing one.
	InsertSchoolFinancialRow(ctx context.Context, data domain.StaffFinancialData) error
	// InsertSchoolHireData writes the master data row of an employment a
	// hire just created at the school (#7206): entry day, last day, address
	// and phone. The employment has no row yet.
	InsertSchoolHireData(ctx context.Context, data domain.StaffMasterData) error
	// SchoolStaffIDsByEmail returns the employments of the school whose
	// master data reach the person at the address, without case (#7378).
	SchoolStaffIDsByEmail(ctx context.Context, email string) ([]int64, error)

	ReleaseOfTraeger(ctx context.Context, organizationID int64) (*domain.TraegerStaffRelease, error)
	CountStaffRecords(ctx context.Context, organizationID int64) (int, error)
	InsertRelease(ctx context.Context, release domain.TraegerStaffRelease) (domain.TraegerStaffRelease, error)
	DeleteRelease(ctx context.Context, organizationID int64) (bool, error)

	TraegerProofStore
	TraegerStaffImportStore
	TraegerStaffPoolStore
}

// TraegerStaffPoolStore is the persistence of the Vertretungspool (#4709):
// the school methods join the tenant transaction of one school and read
// through the functions that answer only that school, the Träger methods
// the Träger transaction.
type TraegerStaffPoolStore interface {
	SchoolPoolAvailable(ctx context.Context) (bool, error)
	SchoolPoolSpringers(ctx context.Context, from, to calendar.Date) ([]domain.PoolSpringer, error)
	SchoolPoolBlocks(ctx context.Context, recordIDs []int64, from, to calendar.Date) ([]domain.PoolBlock, error)
	SchoolPoolProofs(ctx context.Context, recordIDs []int64) ([]domain.PoolProof, error)
	BlockPoolSpringer(ctx context.Context, block domain.PoolBlock, accountID int64) (int64, error)
	LiftSchoolPoolBlock(ctx context.Context, blockID, accountID int64) error
	// PoolSpringerIdentity locks the record of a Springer until the tenant
	// transaction ends and then reads who it is at the school (#7173).
	PoolSpringerIdentity(ctx context.Context, recordID int64) (domain.PoolSpringerIdentity, bool, error)
	// LinkPoolEmployment links a live employment of the school as an
	// Einsatzort the pool created and writes it into the record's trail.
	LinkPoolEmployment(ctx context.Context, recordID, staffID, accountID int64) error
	// RecordPoolResumed writes into the record's trail that a block resumed
	// the pool's former employment at the school (#7197).
	RecordPoolResumed(ctx context.Context, recordID, accountID int64) error

	TraegerPoolSpringers(ctx context.Context, organizationID int64, from, to calendar.Date) ([]domain.PoolSpringer, error)
	TraegerPoolBlocks(ctx context.Context, organizationID int64, recordIDs []int64, from, to calendar.Date) ([]domain.PoolBlock, error)
	TraegerPoolBlockSites(ctx context.Context, organizationID int64, recordIDs []int64) ([]domain.PoolBlockSite, error)
	TraegerPoolProofs(ctx context.Context, organizationID int64, recordIDs []int64) ([]domain.PoolProof, error)
	LiftTraegerPoolBlock(ctx context.Context, organizationID, blockID, accountID int64) (domain.PoolBlockSite, error)
}

// TraegerStaffImportStore writes the records of a Personal-Import (#4724)
// in bulk in the Träger transaction and reads its trail entries.
type TraegerStaffImportStore interface {
	// LockStaffRecords locks every record of the Träger until the Träger
	// transaction ends, in one statement: an edit of a record waits for the
	// import, and the import checks its rows against what it then writes.
	LockStaffRecords(ctx context.Context, organizationID int64) error
	// ReserveStaffRecordIDs draws count record IDs in one statement, so the
	// bank values can be sealed to their record before the insert.
	ReserveStaffRecordIDs(ctx context.Context, organizationID int64, count int) ([]int64, error)
	// InsertStaffRecords inserts records with their reserved IDs in one
	// statement. A number another record holds fails with
	// domain.ErrStaffPersonnelNumberTaken.
	InsertStaffRecords(ctx context.Context, organizationID int64, records []domain.TraegerStaffRecord) error
	// FillStaffRecordFinancial sets the sealed bank and tax values of each
	// record where it has none yet, in one statement; a value the record
	// got meanwhile stays.
	FillStaffRecordFinancial(ctx context.Context, organizationID int64, records []domain.TraegerStaffRecord) error
	// StaffImportEvents reads the imports of the Träger from the trail,
	// newest first, at most limit.
	StaffImportEvents(ctx context.Context, organizationID int64, limit int) ([]domain.StaffImportEvent, error)
}

// TraegerProofStore is the persistence of the Nachweise (#4707): kinds,
// proofs, mappings and reminder claims in the Träger transaction, the
// school's kinds and the status it sees in its tenant transaction.
type TraegerProofStore interface {
	EnsureStandardProofTypes(ctx context.Context, organizationID int64, kinds []domain.TraegerProofType) error
	ListProofTypes(ctx context.Context, organizationID int64) ([]domain.TraegerProofType, error)
	// LockProofType locks one kind until the transaction ends and returns
	// it as committed.
	LockProofType(ctx context.Context, organizationID, id int64) (domain.TraegerProofType, error)
	SaveProofType(ctx context.Context, kind domain.TraegerProofType) (domain.TraegerProofType, error)
	ListProofs(ctx context.Context, organizationID int64, recordIDs []int64) ([]domain.TraegerProof, error)
	SaveProof(ctx context.Context, proof domain.TraegerProof) error
	DeleteProof(ctx context.Context, organizationID, recordID, typeID int64) error
	ClaimProofReminder(ctx context.Context, organizationID, proofID int64, stage, expiresOn string) (bool, error)
	ListProofTypeMappings(ctx context.Context, organizationID int64) ([]domain.TraegerProofTypeMapping, error)
	SaveProofTypeMapping(ctx context.Context, organizationID, accountID int64, mapping domain.TraegerProofTypeMapping, now time.Time) error
	SchoolProofKinds(ctx context.Context) ([]domain.QualificationType, error)
	SchoolTraegerProofStatus(ctx context.Context) ([]domain.SchoolTraegerProofStatus, error)
}

// TraegerStaffContractStore persists the Arbeitsverträge of a record (#4706)
// in the Träger transaction and mirrors their Soll into one school's time
// tracking in that school's tenant transaction.
type TraegerStaffContractStore interface {
	ListStaffContracts(ctx context.Context, organizationID, recordID int64) ([]domain.TraegerStaffContract, error)
	// ListMonthContracts returns every contract of the Träger that runs on
	// a day of first..last, with the Einsatzorte whose Soll starts by last
	// (#4712): the employments the Träger closes and pays that month.
	ListMonthContracts(ctx context.Context, organizationID int64, first, last calendar.Date) ([]domain.TraegerStaffContract, error)
	InsertStaffContract(ctx context.Context, contract domain.TraegerStaffContract, accountID int64) (int64, error)
	UpdateStaffContractTerms(ctx context.Context, contract domain.TraegerStaffContract) error
	ReplaceContractTargetsFrom(ctx context.Context, organizationID, contractID, accountID int64, validFrom calendar.Date, targets []domain.ContractTarget) error
	InsertContractHolidayWeeks(ctx context.Context, organizationID, contractID, accountID int64, weeks []domain.ContractHolidayWeek) error
	DeleteContractHolidayWeek(ctx context.Context, organizationID, contractID, schoolID int64, weekStart calendar.Date) (bool, error)
	DeleteStaffContract(ctx context.Context, organizationID, contractID int64) error

	SchoolClosedMonths(ctx context.Context, staffIDs []int64) (map[int64][]*domain.StaffMonthBalanceSnapshot, error)
	SchoolOwnTargetOverrides(ctx context.Context, staffID int64, from calendar.Date) ([]domain.StaffTargetOverride, error)
	SollKeptStaffIDs(ctx context.Context, staffIDs []int64, day calendar.Date) ([]int64, error)
	KeepTemplateHistory(ctx context.Context, staffID int64, until calendar.Date, now time.Time) error
	ReleaseMirror(ctx context.Context, staffID int64, from calendar.Date, now time.Time) error
	// MirrorStaffSchedule stamps its writes with now.
	MirrorStaffSchedule(ctx context.Context, staffID int64, from calendar.Date, rows []domain.StaffWorkSchedule, now time.Time) error
	MirrorStaffHolidayWeeks(ctx context.Context, staffID int64, from calendar.Date, overrides []domain.StaffTargetOverride) error
}

// TraegerStaffKeep tells the school which of its employments a record of
// its Träger holds, in the school's tenant transaction.
type TraegerStaffKeep interface {
	KeptStaffIDs(ctx context.Context, staffIDs []int64) ([]int64, error)
}
