package devices

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/devicefleet"
)

// LifecycleEventResponse is one entry of a device's history (#2321). It
// names who changed what and when; it never carries a credential. A staff
// member is named with the name the school's directory has now; the moto
// support stays anonymous to the school.
type LifecycleEventResponse struct {
	ID        string                                 `json:"id"`
	Action    string                                 `json:"action"`
	ActorKind string                                 `json:"actor_kind"`
	ActorName *string                                `json:"actor_name"`
	Changes   map[string]devicefleet.LifecycleChange `json:"changes"`
	// OccurredAt keeps the administrative API's second precision (RFC 3339).
	OccurredAt string `json:"occurred_at"`
}

// getDeviceHistory answers the history of one device of the school, newest
// first. A device of another school is not found.
func (rs *Resource) getDeviceHistory(w http.ResponseWriter, r *http.Request) {
	id, err := rs.runtime.ParseID(r, "id")
	if err != nil {
		rs.runtime.Failure(w, r, http.StatusBadRequest, errors.New(errMsgInvalidDeviceID), "")
		return
	}
	events, err := rs.runtime.History.ListLifecycleEvents(r.Context(), id)
	if errors.Is(err, devicefleet.ErrDeviceNotFound) {
		rs.renderError(w, r, &devicefleet.AdministrationError{Op: "GetDeviceHistory", Err: devicefleet.ErrAdministrationDeviceNotFound})
		return
	}
	if err != nil {
		rs.runtime.Failure(w, r, http.StatusInternalServerError, err, "")
		return
	}
	names, err := rs.runtime.ActorNames(r.Context(), lifecycleAccountIDs(events))
	if err != nil {
		rs.runtime.Failure(w, r, http.StatusInternalServerError, err, "")
		return
	}
	responses := make([]LifecycleEventResponse, 0, len(events))
	for _, event := range events {
		responses = append(responses, newLifecycleEventResponse(event, names))
	}
	rs.runtime.Success(w, r, http.StatusOK, responses, "Device history retrieved successfully")
}

// lifecycleAccountIDs are the staff accounts a history names, each once.
func lifecycleAccountIDs(events []devicefleet.LifecycleEvent) []int64 {
	seen := make(map[int64]struct{}, len(events))
	ids := make([]int64, 0, len(events))
	for _, event := range events {
		if event.ActorAccountID == nil {
			continue
		}
		if _, found := seen[*event.ActorAccountID]; !found {
			seen[*event.ActorAccountID] = struct{}{}
			ids = append(ids, *event.ActorAccountID)
		}
	}
	return ids
}

func newLifecycleEventResponse(event devicefleet.LifecycleEvent, names map[int64]string) LifecycleEventResponse {
	var actorName *string
	if event.ActorKind == devicefleet.LifecycleActorSchoolStaff && event.ActorAccountID != nil {
		if name, found := names[*event.ActorAccountID]; found && name != "" {
			actorName = &name
		}
	}
	return LifecycleEventResponse{
		ID: strconv.FormatInt(event.ID, 10), Action: string(event.Action), ActorKind: string(event.ActorKind),
		ActorName: actorName, Changes: event.Changes, OccurredAt: event.OccurredAt.Format(time.RFC3339),
	}
}

// recordLifecycle appends one entry in the request's transaction. A failed
// record fails the request, so its change rolls back with it.
func (rs *Resource) recordLifecycle(r *http.Request, deviceRowID int64, action devicefleet.LifecycleAction, changes map[string]devicefleet.LifecycleChange) error {
	return rs.runtime.History.RecordLifecycleEvent(r.Context(), devicefleet.RecordLifecycleEvent{
		DeviceRowID: deviceRowID, Action: action,
		ActorKind: devicefleet.LifecycleActorSchoolStaff, ActorID: rs.runtime.Actor(r),
		Changes: changes,
	})
}

// statusLifecycleAction names a status change: a block, an unblock or
// another status.
func statusLifecycleAction(to devicefleet.DeviceStatus) devicefleet.LifecycleAction {
	switch to {
	case devicefleet.DeviceStatusInactive:
		return devicefleet.LifecycleBlocked
	case devicefleet.DeviceStatusActive:
		return devicefleet.LifecycleUnblocked
	default:
		return devicefleet.LifecycleStatusChanged
	}
}

// statusChange is the before and after of a status change.
func statusChange(from, to devicefleet.DeviceStatus) map[string]devicefleet.LifecycleChange {
	return devicefleet.LifecycleChanges(map[string][2]*string{
		devicefleet.LifecycleFieldStatus: {devicefleet.LifecycleValue(string(from)), devicefleet.LifecycleValue(string(to))},
	})
}

// recordingContext marks the request's create or edit as made by its staff
// account, so the write records itself in the device's history.
func (rs *Resource) recordingContext(r *http.Request) context.Context {
	return devicefleet.WithLifecycleActor(r.Context(), devicefleet.LifecycleActorRef{
		Kind: devicefleet.LifecycleActorSchoolStaff, ID: rs.runtime.Actor(r),
	})
}
