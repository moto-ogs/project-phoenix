package presenceprojectionhttp

import (
	time "time"

	departure "github.com/moto-ogs/project-phoenix/modules/peopledirectory/departure"
	calendar "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Values accepted by the `view` query parameter of GET /api/students.
const (
	// StudentListViewFull is the historical full StudentResponse projection and
	// stays the default — every existing consumer keeps its payload unchanged.
	StudentListViewFull = "full"
	// StudentListViewSlim is the Kindersuche projection (#2097).
	StudentListViewSlim = "slim"
	// StudentListViewNames is the name lookup (#4996): the Betreuungsplan
	// shows who a child is in its conflicts and block details and reads
	// nothing else of the list.
	StudentListViewNames = "names"
)

// NameStudentResponse is the names-only list projection (#4996). Like the slim
// one it is a wire projection: filters, sorting, pagination and access run on
// the full responses first.
type NameStudentResponse struct {
	ID        ident.ID `json:"id"`
	FirstName string   `json:"first_name"`
	LastName  string   `json:"last_name"`
}

func nameStudentResponses(responses []StudentResponse) []NameStudentResponse {
	names := make([]NameStudentResponse, len(responses))
	for i := range responses {
		names[i] = NameStudentResponse{ID: responses[i].ID, FirstName: responses[i].FirstName, LastName: responses[i].LastName}
	}
	return names
}

// SlimStudentResponse is the list projection for the Kindersuche
// (frontend students/search): every field its cards, client-side
// filters/sorting/grouping and the presence badge actually read, and nothing
// else.
//
// Why (#2097): the full StudentResponse ships ~55 fields, including the
// address block, health info, supervisor notes, the four weekday departure
// maps, guardian contacts, enrollment consent timestamps and row timestamps.
// The Kindersuche renders none of them — the child detail page fetches the
// full record separately — yet the page requests up to 1000 rows in one trip,
// which measured 51.9 KB on average and 198.4 KB at peak in production
// (benchmark 2026-07-30, #2063).
//
// This is a WIRE projection only: the handler still builds, filters, sorts and
// paginates full StudentResponse values, so day-planning, administrative
// filters and access redaction behave identically in both views. Only the
// final marshalling differs.
//
// Adding a field here is cheap; removing one is a breaking change for the
// Kindersuche. Before adding, check that the page actually reads it —
// TestListStudents_SlimProjection pins the forbidden set.
type SlimStudentResponse struct {
	ID          ident.ID `json:"id"`
	FirstName   string   `json:"first_name"`
	LastName    string   `json:"last_name"`
	SchoolClass string   `json:"school_class"`

	// Live location + the badge context it is rendered with. The *_since
	// timestamps are part of StudentLocationContext (frontend
	// lib/location-helper.ts): the cards do not pass showLocationSince today,
	// but the badge reads them, so dropping them would silently break the
	// "seit HH:MM" label the moment a card enables it. They cost <1% of the
	// payload (only set for children who are actually present/absent).
	Location       string     `json:"current_location"`
	LocationSince  *time.Time `json:"location_since,omitempty"`
	RoomColor      *string    `json:"current_room_color,omitempty"`
	GroupID        ident.ID   `json:"group_id,omitempty"`
	GroupName      string     `json:"group_name,omitempty"`
	Sick           bool       `json:"sick"`
	SickSince      *time.Time `json:"sick_since,omitempty"`
	Excused        bool       `json:"excused"`
	ExcusedSince   *time.Time `json:"excused_since,omitempty"`
	ClassTrip      bool       `json:"class_trip"`
	ClassTripSince *time.Time `json:"class_trip_since,omitempty"`

	// Day planning. The reason distinguishes actual unplanned attendance from
	// ordinary planned presence; status and label alone cannot express that.
	DayPlanningStatus  string  `json:"day_planning_status,omitempty"`
	DayPlanningReason  string  `json:"day_planning_reason,omitempty"`
	DayPlanningLabel   string  `json:"day_planning_label,omitempty"`
	PendingExcusedNote *string `json:"pending_excused_note,omitempty"`
	// TeacherHints are today's hints of the Lehrkraft (#4795).
	TeacherHints []TeacherHint `json:"teacher_hints,omitempty"`
	// ClassHandover: today's handover of the child to the OGS (#4794).
	ClassHandover *ClassHandover `json:"class_handover,omitempty"`
	// PlannedActivities are the child's offerings on the listed day (#8194),
	// between arrival and pickup on the card; full-access rows only.
	PlannedActivities []StudentListPlannedActivity `json:"planned_activities,omitempty"`

	// Planned + actual times (the arrival/pickup rows and their sort/group
	// modes). Only populated for full-access rows and when the caller passes
	// include_pickup_times / include_arrival_times.
	DepartureModes []departure.DepartureMode `json:"departure_modes,omitempty"`
	DepartureLabel string                    `json:"departure_label,omitempty"`
	// DepartureIsException marks a day Abholart (#3945) in DepartureModes.
	DepartureIsException bool    `json:"departure_is_exception,omitempty"`
	PickupTime           *string `json:"pickup_time,omitempty" contract:"clock"`
	PickupIsException    bool    `json:"pickup_is_exception,omitempty"`
	PickupNotes          string  `json:"pickup_notes,omitempty"`
	ArrivalTime          *string `json:"arrival_time,omitempty" contract:"clock"`
	ArrivalIsException   bool    `json:"arrival_is_exception,omitempty"`
	ArrivalNotes         string  `json:"arrival_notes,omitempty"`
	ActualArrivalTime    *string `json:"actual_arrival_time,omitempty" contract:"clock"`
	ActualPickupTime     *string `json:"actual_pickup_time,omitempty" contract:"clock"`

	// "Nach Laufgemeinschaft" grouping; only with include_companions=true.
	CompanionStudentIDs []ident.ID `json:"companion_student_ids,omitempty"`

	// Photo + consent. photo_consent_given is carried because the page probes
	// its PRESENCE (not its value) to decide whether the "Fotoerlaubnis" filter
	// is offered at all — omitting it would silently remove that filter.
	PhotoVersion      string `json:"photo_version,omitempty"`
	PhotoURL          string `json:"photo_url,omitempty"` // legacy BFF alias
	PhotoConsentGiven *bool  `json:"photo_consent_given,omitempty"`

	HasFullAccess bool `json:"has_full_access"`
}

// slimStudentResponses projects the fully built, filtered and paginated list
// onto the Kindersuche wire shape.
func slimStudentResponses(responses []StudentResponse, planningDate calendar.Date) []SlimStudentResponse {
	slim := make([]SlimStudentResponse, len(responses))
	for i := range responses {
		r := &responses[i]
		departure := dailyDepartureForDate(*r, planningDate)
		slim[i] = SlimStudentResponse{
			ID:                   r.ID,
			FirstName:            r.FirstName,
			LastName:             r.LastName,
			SchoolClass:          r.SchoolClass,
			Location:             r.Location,
			LocationSince:        r.LocationSince,
			RoomColor:            r.RoomColor,
			GroupID:              r.GroupID,
			GroupName:            r.GroupName,
			Sick:                 r.Sick,
			SickSince:            r.SickSince,
			Excused:              r.Excused,
			ExcusedSince:         r.ExcusedSince,
			ClassTrip:            r.ClassTrip,
			ClassTripSince:       r.ClassTripSince,
			DayPlanningStatus:    r.DayPlanningStatus,
			DayPlanningReason:    r.DayPlanningReason,
			DayPlanningLabel:     r.DayPlanningLabel,
			PendingExcusedNote:   r.PendingExcusedNote,
			TeacherHints:         r.TeacherHints,
			ClassHandover:        r.ClassHandover,
			DepartureModes:       departure.Modes,
			DepartureLabel:       departure.LegacyLabel,
			DepartureIsException: departure.Exception,
			PickupTime:           r.PickupTime,
			PickupIsException:    r.PickupIsException,
			PickupNotes:          r.PickupNotes,
			ArrivalTime:          r.ArrivalTime,
			ArrivalIsException:   r.ArrivalIsException,
			ArrivalNotes:         r.ArrivalNotes,
			ActualArrivalTime:    r.ActualArrivalTime,
			ActualPickupTime:     r.ActualPickupTime,
			CompanionStudentIDs:  r.CompanionStudentIDs,
			PhotoVersion:         r.PhotoVersion,
			PhotoConsentGiven:    r.PhotoConsentGiven,
			HasFullAccess:        r.HasFullAccess,
		}
	}
	return slim
}
