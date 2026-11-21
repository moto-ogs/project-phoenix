package timetracking

import (
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// --- mapping ---

func StaffAbsenceToCapability(entity *StaffAbsence) workforce.StaffAbsence {
	return workforce.StaffAbsence{
		ID: ident.ID(entity.ID), TenantID: ident.ID(entity.TenantID), StaffID: ident.ID(entity.StaffID), AbsenceType: entity.AbsenceType,
		AbsenceTypeID: (*ident.ID)(entity.AbsenceTypeID), DateStart: entity.DateStart.String(), DateEnd: entity.DateEnd.String(),
		HalfDay: entity.HalfDay, StartHalfDay: entity.StartHalfDay, EndHalfDay: entity.EndHalfDay, Note: entity.Note,
		Status: entity.Status, ApprovedBy: (*ident.ID)(entity.ApprovedBy), ApprovedAt: entity.ApprovedAt, CreatedBy: ident.ID(entity.CreatedBy),
		WorkingDays: entity.WorkingDays, DecisionNote: entity.DecisionNote, RequestedAt: entity.RequestedAt,
		SubstituteStaffID: (*ident.ID)(entity.SubstituteStaffID), CreatedAt: entity.CreatedAt, UpdatedAt: entity.UpdatedAt,
	}
}

func absenceToRecord(value workforce.StaffAbsence) *StaffAbsence {
	entity := &StaffAbsence{}
	applyAbsenceToRecord(entity, value)
	return entity
}

func applyAbsenceToRecord(entity *StaffAbsence, value workforce.StaffAbsence) {
	entity.ID = value.ID.Int64()
	entity.CreatedAt = value.CreatedAt
	entity.UpdatedAt = value.UpdatedAt
	entity.TenantID = value.TenantID.Int64()
	entity.StaffID = value.StaffID.Int64()
	entity.AbsenceType = value.AbsenceType
	entity.AbsenceTypeID = (*int64)(value.AbsenceTypeID)
	entity.DateStart = calendar.Date(value.DateStart)
	entity.DateEnd = calendar.Date(value.DateEnd)
	entity.HalfDay = value.HalfDay
	entity.StartHalfDay = value.StartHalfDay
	entity.EndHalfDay = value.EndHalfDay
	entity.Note = value.Note
	entity.Status = value.Status
	entity.ApprovedBy = (*int64)(value.ApprovedBy)
	entity.ApprovedAt = value.ApprovedAt
	entity.CreatedBy = value.CreatedBy.Int64()
	entity.WorkingDays = value.WorkingDays
	entity.DecisionNote = value.DecisionNote
	entity.RequestedAt = value.RequestedAt
	entity.SubstituteStaffID = (*int64)(value.SubstituteStaffID)
}

// absenceWriteError keeps the legacy write error shape. Validation failures
// surface bare, as the row's own Validate() did, so callers that compare the
// reason text keep seeing it; everything else is a DatabaseError whose chain
// still reaches the driver error of a rejected duplicate.
func absenceWriteError(op string, err error) error {
	if errors.Is(err, workforce.ErrInvalidStaffAbsence) || errors.Is(err, workforce.ErrAbsenceTypeInvalid) {
		return errors.New(err.Error())
	}
	return recordErrors.WrapRecordError(op, err)
}

func absencesToRecord(values []workforce.StaffAbsence) []*StaffAbsence {
	result := make([]*StaffAbsence, 0, len(values))
	for _, value := range values {
		result = append(result, absenceToRecord(value))
	}
	return result
}
func staffAbsencesByID(values []workforce.StaffAbsence) map[int64][]*StaffAbsence {
	result := make(map[int64][]*StaffAbsence)
	for _, value := range values {
		result[value.StaffID.Int64()] = append(result[value.StaffID.Int64()], absenceToRecord(value))
	}
	return result
}
func firstAbsence(values []workforce.StaffAbsence) *StaffAbsence {
	if len(values) == 0 {
		return nil
	}
	return absenceToRecord(values[0])
}

func optionalAbsenceDate(value *calendar.Date) string {
	if value == nil {
		return ""
	}
	return value.String()
}
func absenceDate(value string) (*calendar.Date, error) {
	if value == "" {
		return nil, nil
	}
	date, err := calendar.ParseDate(value)
	if err != nil {
		return nil, err
	}
	return &date, nil
}
func absenceAuditValue(audit *StaffAbsenceAudit) workforce.StaffAbsenceAudit {
	return workforce.StaffAbsenceAudit{TenantID: audit.TenantID, AbsenceID: audit.AbsenceID, FromStatus: audit.FromStatus, ToStatus: audit.ToStatus, ActorID: audit.ActorID, Note: audit.Note, ChangedAt: audit.ChangedAt, TypeChange: (*workforce.AbsenceTypeChange)(audit.TypeChange)}
}
func applyAbsenceAudit(audit *StaffAbsenceAudit, value workforce.StaffAbsenceAudit) {
	audit.ID = value.ID
	audit.TenantID = value.TenantID
	audit.ChangedAt = value.ChangedAt
}

// AbsenceRecord maps a native command or query value for request enrichment.
func AbsenceRecord(value workforce.StaffAbsence) *StaffAbsence { return absenceToRecord(value) }

// AbsenceRequestReadError preserves the request-list operation envelope.
func AbsenceRequestReadError(err error) error { return rowReadError("list absence requests", err, nil) }

func absenceUpdateError(err error) error {
	if errors.Is(err, workforce.ErrStaffAbsenceNotFound) {
		return rowsAffectedError("update StaffAbsence")
	}
	return absenceWriteError("update", err)
}
