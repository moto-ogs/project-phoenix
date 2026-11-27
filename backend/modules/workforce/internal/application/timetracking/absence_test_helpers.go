//go:build testhooks

package timetracking

// NewStaffAbsenceService constructs the transactional absence service for
// tests that supply their own repositories rather than using the composition.
func NewStaffAbsenceService(
	absenceRepo AbsenceRequestRecords,
	workSessionRepo WorkSessionRecords,
	quotaRepo VacationQuotaRecords,
	auditRepo AbsenceAuditRecords,
	settings monthSettingsResolver,
	monthService WorkTimeMonthService,
	opts ...StaffAbsenceOption,
) StaffAbsenceService {
	return newStaffAbsenceService(absenceRepo, workSessionRepo, quotaRepo, auditRepo, settings, monthService, opts...).transactional()
}
