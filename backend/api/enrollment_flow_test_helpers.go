//go:build testhooks

package api

import (
	"log/slog"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"

	owners "github.com/moto-ogs/project-phoenix/roots/owners"

	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	careplanCompose "github.com/moto-ogs/project-phoenix/modules/careplan/compose"
	peopleCompose "github.com/moto-ogs/project-phoenix/modules/peopledirectory/compose"
	peoplePorts "github.com/moto-ogs/project-phoenix/modules/peopledirectory/ports"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
)

// Test bindings of the enrollment flow suites (#3565): the ports their
// doubles implement and the root compositions they drive over the test
// database, for suites that may not import the compositions themselves.

// Audit rows and ports of the decision flow the flow suites record into and
// read back.
type (
	EnrollmentFlowDataAccessLog           = auditModels.DataAccessLog
	EnrollmentFlowDataAccessLogs          = auditModels.DataAccessLogRepository
	EnrollmentFlowDeletionAudit           = auditModels.EnrollmentDeletion
	EnrollmentFlowDeletionAudits          = auditModels.EnrollmentDeletionRepository
	EnrollmentFlowOfferingAdjustmentAudit = auditModels.EnrollmentOfferingAdjustment
	EnrollmentFlowRestorationAudit        = auditModels.EnrollmentRestoration
)

// Resource types of the enrollment exports in the data-access log.
const (
	EnrollmentFlowPhaseExportResource   = auditModels.ResourceTypeEnrollmentPhaseExport
	EnrollmentFlowStudentExportResource = auditModels.ResourceTypeEnrollmentStudentExport
)

// NewEnrollmentFlowStudentAudit records student changes with the request's
// audit actor, the way the root binds the decision flow's student audit.
func NewEnrollmentFlowStudentAudit(db transactionruntime.Database, actor peoplePorts.RequestAuditActor) peoplePorts.StudentAuditService {
	return peopleCompose.NewStudentAuditService(actor, NewStudentAudit(db))
}

// NewEnrollmentFlowPickupExcusal composes Care Plan's pickup auto-excusal the
// way the root binds it; extensions also records the pickup extensions the
// Timetable owner keeps.
func NewEnrollmentFlowPickupExcusal(db transactionruntime.Database, records careplan.Capability, baselines careplan.PickupBaselineReader, tt timetable.Capability, extensions bool) (careplan.PickupAutoExcusal, error) {
	// The enrollment flow suites resync from the real day, as the root does.
	return NewEnrollmentFlowPickupExcusalOn(db, records, baselines, tt, extensions, calendar.TodayDate)
}

// NewEnrollmentFlowPickupExcusalOn is NewEnrollmentFlowPickupExcusal on the
// day of the given clock, for a suite that asserts which coming pickup
// exceptions a resync reaches.
func NewEnrollmentFlowPickupExcusalOn(db transactionruntime.Database, records careplan.Capability, baselines careplan.PickupBaselineReader, tt timetable.Capability, extensions bool, today func() calendar.Date) (careplan.PickupAutoExcusal, error) {
	adapter := owners.NewPickupExcusalTimetable(tt, owners.NewPartialAbsencePreview(db))
	deps := careplanCompose.PickupExcusalDependencies{
		DB: db.Pool(), Records: records, Baselines: baselines, Blocks: owners.NewLoggedStudentPresence(db, slog.Default()), Preview: adapter,
		Today: today,
	}
	if extensions {
		deps.Extensions = adapter
	}
	return careplanCompose.NewPickupAutoExcusal(deps)
}
