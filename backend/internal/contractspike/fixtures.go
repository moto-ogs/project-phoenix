package contractspike

import (
	"encoding/json"
	"math"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	careplanhttp "github.com/moto-ogs/project-phoenix/modules/careplan/http"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory/departure"
	presenceprojectionhttp "github.com/moto-ogs/project-phoenix/modules/presenceprojection/http"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func ptr[T any](v T) *T { return &v }

// Fixtures renders the real types through the real envelopes with
// encoding/json. The values are response bodies as text, so the TypeScript
// tests parse exactly what a client would receive.
func Fixtures() ([]byte, error) {
	at := time.Date(2026, 9, 9, 10, 0, 0, 0, time.UTC)
	full := presenceprojectionhttp.StudentResponse{
		ID: 7, PersonID: 8, FirstName: "Ada", LastName: "Beispiel", Birthday: "2018-03-04",
		SchoolClass: "2a", Location: "Raum 1", LocationSince: &at, RoomColor: ptr("#83CD2D"),
		GroupID: 3, GroupName: "Füchse", PickupDays: departure.PickupDays{"mon": true},
		PickupTime: ptr("15:30"), TeacherHints: []presenceprojectionhttp.TeacherHint{{Body: "Turnbeutel"}},
		DepartureDays:       departure.DepartureDays{"mon": departure.DeparturePickup},
		CompanionStudentIDs: []int64{9, 10}, Sick: true, SickSince: &at,
		ClassHandover:     &presenceprojectionhttp.ClassHandover{SchoolClass: "2a", HandedOverAt: at},
		PhotoConsentGiven: ptr(false), PhotoConsentGivenBy: ptr(int64(11)), CareEndsOn: "2027-07-31",
		HasFullAccess: true, CreatedAt: at, UpdatedAt: at,
	}
	minimal := presenceprojectionhttp.StudentResponse{ID: 12, PersonID: 13, FirstName: "Ben", LastName: "Muster", CreatedAt: at, UpdatedAt: at}
	detail := presenceprojectionhttp.StudentDetailResponse{
		PrivacyConsent:  &presenceprojectionhttp.StudentPrivacyConsentResponse{Accepted: true, DataRetentionDays: 30},
		StudentResponse: full, HasFullAccess: false, HasWriteAccess: true,
		GroupSupervisors: []presenceprojectionhttp.SupervisorContact{{ID: 5, FirstName: "Cem", LastName: "Lehrer", Role: "staff"}},
		ActualArrivalBy:  &presenceprojectionhttp.AttendanceActorResponse{Kind: "staff", Name: "Cem Lehrer"},
	}
	schedule := careplanhttp.PickupScheduleResponse{ID: 1, StudentID: 7, Weekday: 1, WeekdayName: "Montag", PickupTime: "15:30", Source: "staff", CreatedBy: 5, CreatedAt: "2026-09-01T08:00:00Z", UpdatedAt: "2026-09-01T08:00:00Z"}
	pickup := careplanhttp.PickupDataResponse{
		Schedules:           []careplanhttp.PickupScheduleResponse{schedule},
		EffectiveSchedules:  []careplanhttp.DatedPickupScheduleResponse{{Date: "2026-09-09", Schedule: &schedule}},
		Exceptions:          []careplanhttp.PickupExceptionResponse{},
		Notes:               []careplanhttp.PickupNoteResponse{},
		DepartureExceptions: []careplanhttp.DepartureExceptionResponse{},
	}
	page := func(data any) any {
		return common.NewPaginatedResponse(data, 1, 50, 2, "Students retrieved successfully")
	}
	one := func(data any) any { return common.NewResponse(data, "ok") }
	bodies := map[string]any{
		"list_full":  page([]presenceprojectionhttp.StudentResponse{full, minimal}),
		"list_slim":  page([]presenceprojectionhttp.SlimStudentResponse{{ID: 7, FirstName: "Ada", LastName: "Beispiel", SchoolClass: "2a", Location: "Raum 1", LocationSince: ptr(at.In(time.FixedZone("CEST", 2*60*60))), DepartureModes: []departure.DepartureMode{departure.DeparturePickup}, CompanionStudentIDs: []int64{9}}}),
		"list_names": page([]presenceprojectionhttp.NameStudentResponse{{ID: 7, FirstName: "Ada", LastName: "Beispiel"}}),
		"list_empty": page([]presenceprojectionhttp.StudentResponse{}),
		// A handler that passes a nil slice: the envelope drops data.
		"list_nil":                   page([]presenceprojectionhttp.StudentResponse(nil)),
		"list_names_max_id":          page([]presenceprojectionhttp.NameStudentResponse{{ID: math.MaxInt64, FirstName: "Max", LastName: "Int"}}),
		"detail":                     one(detail),
		"detail_minimal":             one(presenceprojectionhttp.StudentDetailResponse{StudentResponse: minimal}),
		"pickup":                     one(pickup),
		"pickup_zero":                one(careplanhttp.PickupDataResponse{}),
		"probe_attendance":           studentpresence.DailyAttendanceStatus{StudentID: 7, Status: "checked_in", Date: calendar.NewDate(2026, 9, 9), CheckInTime: &at},
		"probe_attendance_zero_date": studentpresence.DailyAttendanceStatus{StudentID: 7, Status: "not_checked_in"},
		"probe_string_id":            StringIDProbe{ID: math.MaxInt64, PersonID: ptr(int64(math.MaxInt64)), FirstName: "Max", Friends: []int64{1}},
		"probe_string_id_minimal":    StringIDProbe{ID: 1},
	}
	texts := map[string]string{}
	for name, body := range bodies {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		texts[name] = string(data)
	}
	data, err := json.MarshalIndent(texts, "", "  ")
	return append(data, '\n'), err
}
