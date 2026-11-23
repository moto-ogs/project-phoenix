package application

import (
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	scheduleModels "github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain/schedulerecords"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// ScheduledInstanceOf maps a retained instance row, whose status carries the
// Student Presence session state, onto the owner's scheduled-instance view.
func ScheduledInstanceOf(row *scheduleModels.ActivityInstance) timetable.ScheduledInstance {
	return timetable.ScheduledInstance{
		ID:                    ident.ID(row.ID),
		CreatedAt:             row.CreatedAt,
		UpdatedAt:             row.UpdatedAt,
		TenantID:              ident.ID(row.TenantID),
		Date:                  calendar.Date(row.Date),
		ActivityGroupID:       (*ident.ID)(row.ActivityGroupID),
		CalendarPeriodID:      (*ident.ID)(row.CalendarPeriodID),
		Title:                 row.Title,
		Description:           row.Description,
		StartTime:             row.StartTime,
		EndTime:               row.EndTime,
		RoomID:                ident.ID(row.RoomID),
		RequiredStaff:         row.RequiredStaff,
		Status:                row.Status,
		ActiveGroupID:         (*ident.ID)(row.ActiveGroupID),
		ListKind:              row.ListKind,
		IsSpontaneous:         row.IsSpontaneous,
		UnderstaffedAck:       row.UnderstaffedAck,
		UnderstaffedNote:      row.UnderstaffedNote,
		CancelReason:          row.CancelReason,
		Notes:                 row.Notes,
		CreatedBy:             (*ident.ID)(row.CreatedBy),
		StartedBy:             (*ident.ID)(row.StartedBy),
		StartedAt:             row.StartedAt,
		CompletedAt:           row.CompletedAt,
		CompletedBy:           (*ident.ID)(row.CompletedBy),
		ReopenUntil:           row.ReopenUntil,
		HasCompletionSnapshot: len(row.CompletionSnapshot) > 0,
		IsDuty:                row.TemplateType == timetable.GroupTypeDuty,
	}
}
