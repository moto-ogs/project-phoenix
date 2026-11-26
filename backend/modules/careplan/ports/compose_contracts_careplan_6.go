package ports

import (
	"context"
	"encoding/json"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type RequestConflictRecords interface {
	FindCareScheduleRequest(context.Context, int64, bool) (carerequests.Request, error)
}

type RequestCorrectionRecords interface {
	FindCareScheduleRequest(context.Context, int64, bool) (carerequests.Request, error)
	RedecideCareScheduleRequest(context.Context, careplan.CareScheduleRequestDecision) error
	FindPickupException(context.Context, int64, bool) (careplan.PickupException, error)
	DeletePickupException(context.Context, int64) error
	ListDepartureExceptions(context.Context, careplan.StudentScheduleFilter) ([]careplan.DepartureException, error)
	DeleteDepartureException(context.Context, int64) error
	ListPickupNotes(context.Context, careplan.StudentScheduleFilter) ([]careplan.PickupNote, error)
	DeletePickupNote(context.Context, int64) error
	// ListDayPickups and DeleteApprovedPickupPerson take back the day's
	// pickup person an approval wrote (#8162).
	ListDayPickups(ctx context.Context, from, to calendar.Date, studentIDs []int64) ([]careplan.DayPickup, error)
	DeleteApprovedPickupPerson(ctx context.Context, studentID int64, date calendar.Date, id int64) (bool, error)
	SaveApprovedPickupPerson(context.Context, careplan.PickupPerson) (careplan.PickupPerson, error)
}

type RequestDecisionRecords interface {
	FindCareScheduleRequest(context.Context, int64, bool) (carerequests.Request, error)
	DecideCareScheduleRequest(context.Context, careplan.CareScheduleRequestDecision) error
	UpdateCareScheduleRequestSnapshot(context.Context, int64, json.RawMessage) error
}

type RequestEditRecords interface {
	FindCareScheduleRequest(context.Context, int64, bool) (carerequests.Request, error)
	UpdatePendingCareScheduleRequest(context.Context, int64, json.RawMessage) error
}

type RequestReadRecords interface {
	ListCareScheduleRequests(context.Context, careplan.CareScheduleRequestFilter) ([]carerequests.Request, error)
}

type RequestSubmissionRecords interface {
	CreateCareScheduleRequest(context.Context, carerequests.Request) (carerequests.Request, error)
}
