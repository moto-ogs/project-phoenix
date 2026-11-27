package parent

import (
	"errors"
	"net/http"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// ChildDayChangesResponse is "Heute anders" of one child (#7671): what is
// different today for the child. It carries no name of a staff member and
// no free text of the school besides the name of a closing day; the frontend
// builds the German text from Kind.
type ChildDayChangesResponse struct {
	Date    calendar.Date          `json:"date"`
	Sources []ChildDaySourceStatus `json:"sources"`
	Entries []ChildDayChangeEntry  `json:"entries"`
}

// ChildDaySourceStatus says whether one source answered. A failed source
// means its changes are missing; the card then never says "alles wie
// geplant".
type ChildDaySourceStatus struct {
	Source string `json:"source"`
	Status string `json:"status"`
}

// ChildDayChangeEntry is one change of the child's day.
type ChildDayChangeEntry struct {
	Kind         string         `json:"kind"`
	AllDay       bool           `json:"all_day"`
	Since        *calendar.Date `json:"since"`
	Until        *calendar.Date `json:"until"`
	StartsAt     *time.Time     `json:"starts_at"`
	EndsAt       *time.Time     `json:"ends_at"`
	EnteredByYou bool           `json:"entered_by_you"`
	ChildStatus  *string        `json:"child_status"`
	PickupTime   *string        `json:"pickup_time"`
	// PickupPersonName is who collects the child (#8162);
	// PickupPersonOneTime asks the person to bring an ID card.
	PickupPersonName    *string `json:"pickup_person_name"`
	PickupPersonOneTime bool    `json:"pickup_person_one_time"`
	ActivityTitle       *string `json:"activity_title"`
	RoomName            *string `json:"room_name"`
	PreviousRoomName    *string `json:"previous_room_name"`
	ClosingName         *string `json:"closing_name"`
	ClosingTraeger      bool    `json:"closing_traeger"`
	// OpeningName, OpensAt and ClosesAt describe an opening change (#8170);
	// PickupAfterClosing marks a changed pickup after its closing time.
	OpeningName        *string `json:"opening_name"`
	OpensAt            *string `json:"opens_at"`
	ClosesAt           *string `json:"closes_at"`
	PickupAfterClosing bool    `json:"pickup_after_closing"`
	ClassName          *string `json:"class_name"`
	ClassTime          *string `json:"class_time"`
}

// ChildDayChangeKinds are the kinds of the child's day.
var ChildDayChangeKinds = []string{
	"child_absent", "child_pickup_changed", "child_goes_alone", "child_pickup_person", "class_trip",
	"closing_day", "opening_changed",
	"activity_cancelled", "activity_reinstated", "activity_room_changed", "activity_lead_changed",
	"class_dismissal_changed", "meal_cancelled",
}

// ChildDaySources are the sources of the child's day, in answer order.
var ChildDaySources = []string{"children", "closing_days", "activities", "classes", "meal_plan"}

// childDayChangesEnums types the wire's closed strings for the frontend.
func childDayChangesEnums() []common.EnumContract {
	return []common.EnumContract{
		{Name: "ChildDayChangeKind", Fields: []string{"ChildDayChangeEntry.kind"}, Values: ChildDayChangeKinds},
		{Name: "ChildDaySource", Fields: []string{"ChildDaySourceStatus.source"}, Values: ChildDaySources},
		{Name: "ChildDaySourceState", Fields: []string{"ChildDaySourceStatus.status"}, Values: []string{"loaded", "failed"}},
		{Name: "ChildDayStatus", Fields: []string{"ChildDayChangeEntry.child_status"}, Values: []string{"sick", "excused"}},
	}
}

// errChildDayDateFormat reports a date query parameter that is not
// YYYY-MM-DD.
var errChildDayDateFormat = errors.New("date query parameter must be YYYY-MM-DD")

// getChildDayChanges reads "Heute anders" of a linked child the account may
// see (parent_portal.access). Without date it reads today of the child's
// school; date may name tomorrow for the preview (#8236). A malformed date
// is refused at once; a well-formed day other than today and tomorrow is
// refused after the relationship check, so a child without the right
// answers 403/404 for it.
func (rs *Resource) getChildDayChanges(w http.ResponseWriter, r *http.Request) {
	accountID, ok := rs.parentAccountID(w, r)
	if !ok {
		return
	}
	studentID, ok := parsePathStudentID(w, r)
	if !ok {
		return
	}
	var on *calendar.Date
	if raw := r.URL.Query().Get("date"); raw != "" {
		parsed, parseErr := calendar.ParseDate(raw)
		if parseErr != nil {
			common.RenderError(w, r, common.ErrorInvalidRequest(errChildDayDateFormat))
			return
		}
		on = &parsed
	}
	day, err := rs.ParentService.GetChildDayChanges(r.Context(), accountID, studentID, on)
	if errors.Is(err, parentService.ErrDayChangesDayOutOfRange) {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	if err != nil {
		renderParentWriteError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, toChildDayChangesResponse(day), "Day changes retrieved")
}

func toChildDayChangesResponse(day parentService.ChildDay) ChildDayChangesResponse {
	out := ChildDayChangesResponse{
		Date:    day.Date,
		Sources: make([]ChildDaySourceStatus, 0, len(day.Sources)),
		Entries: make([]ChildDayChangeEntry, 0, len(day.Entries)),
	}
	for _, source := range day.Sources {
		status := "loaded"
		if source.Failed {
			status = "failed"
		}
		out.Sources = append(out.Sources, ChildDaySourceStatus{Source: source.Source, Status: status})
	}
	for _, entry := range day.Entries {
		out.Entries = append(out.Entries, ChildDayChangeEntry{
			Kind: entry.Kind, AllDay: entry.AllDay, Since: entry.Since, Until: entry.Until,
			StartsAt: entry.StartsAt, EndsAt: entry.EndsAt, EnteredByYou: entry.EnteredByYou,
			ChildStatus: entry.ChildStatus, PickupTime: entry.PickupTime,
			PickupPersonName: entry.PickupPersonName, PickupPersonOneTime: entry.PickupPersonOneTime,
			ActivityTitle: entry.ActivityTitle, RoomName: entry.RoomName, PreviousRoomName: entry.PreviousRoomName,
			ClosingName: entry.ClosingName, ClosingTraeger: entry.ClosingTraeger,
			OpeningName: entry.OpeningName, OpensAt: entry.OpensAt, ClosesAt: entry.ClosesAt, PickupAfterClosing: entry.PickupAfterClosing,
			ClassName: entry.ClassName, ClassTime: entry.ClassTime,
		})
	}
	return out
}
