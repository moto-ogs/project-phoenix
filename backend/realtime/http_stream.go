package realtime

import (
	"strconv"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// SSEEvent is the payload at the HTTP stream boundary.
type SSEEvent struct {
	Type          EventType    `json:"type"`
	ActiveGroupID string       `json:"active_group_id" contract_text:"decimal, edu:<ID>, or empty topic"`
	Data          SSEEventData `json:"data"`
	Timestamp     time.Time    `json:"timestamp"`
}

// SSEEventData writes IDs with wire's ident.ID codec. Its fields shadow
// the relay's decimal strings, without changing the PostgreSQL signal format.
type SSEEventData struct {
	EventData
	StudentID     *ident.ID   `json:"student_id,omitempty"`
	StudentIDs    *[]ident.ID `json:"student_ids,omitempty"`
	GroupIDs      *[]ident.ID `json:"group_ids,omitempty"`
	RoomID        *ident.ID   `json:"room_id,omitempty"`
	SupervisorIDs *[]ident.ID `json:"supervisor_ids,omitempty"`
	InstanceID    *ident.ID   `json:"instance_id,omitempty"`
	ThreadID      *ident.ID   `json:"thread_id,omitempty"`
}

// SSEPayload returns the browser projection independently of relay data.
func (event Event) SSEPayload() any {
	return SSEEvent{
		Type: event.Type, ActiveGroupID: event.ActiveGroupID, Timestamp: event.Timestamp,
		Data: SSEEventData{
			EventData: event.Data, StudentID: parseEventID(event.Data.StudentID),
			StudentIDs: parseEventIDs(event.Data.StudentIDs), GroupIDs: parseEventIDs(event.Data.GroupIDs),
			RoomID: parseEventID(event.Data.RoomID), SupervisorIDs: parseEventIDs(event.Data.SupervisorIDs),
			InstanceID: parseEventID(event.Data.InstanceID),
			ThreadID:   parseEventID(event.Data.ThreadID),
		},
	}
}

func parseEventID(raw *string) *ident.ID {
	if raw == nil {
		return nil
	}
	value, err := strconv.ParseInt(*raw, 10, 64)
	if err != nil || value <= 0 {
		return nil
	}
	id := ident.ID(value)
	return &id
}

func parseEventIDs(raw *[]string) *[]ident.ID {
	if raw == nil {
		return nil
	}
	ids := make([]ident.ID, 0, len(*raw))
	for _, value := range *raw {
		if id := parseEventID(&value); id != nil {
			ids = append(ids, *id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	return &ids
}

// EventTypeValues lists the application event names the generated client subscribes to.
func EventTypeValues() []string {
	return []string{
		string(EventStudentCheckIn),
		string(EventStudentCheckOut),
		string(EventStudentUpdated),
		string(EventStudentCompanionsChanged),
		string(EventBulkStudentCheckOut),
		string(EventBulkStudentCheckIn),
		string(EventActivityStart),
		string(EventActivityEnd),
		string(EventActivityUpdate),
		string(EventInstanceStarted),
		string(EventInstanceCompleted),
		string(EventInstanceCancelled),
		string(EventInstanceOverdue),
		string(EventStaffingDeviationChanged),
		string(EventDashboardCountsChanged),
		string(EventGroupAccessChanged),
		string(EventStaffTimeTrackingChanged),
		string(EventActiveSupervisionChanged),
		string(EventArrivalScheduleChanged),
		string(EventPickupScheduleChanged),
		string(EventChangeRequestsChanged),
		string(EventStaffNoticesChanged),
		string(EventCalendarAppointmentsChanged),
		string(EventMealPlanChanged),
		string(EventTenantSettingsChanged),
		string(EventParentMessage),
		string(EventParentMessageRead),
		string(EventParentMessageUnreadChanged),
		string(EventStaffMessage),
		string(EventParentChildUpdated),
		string(EventClassDayChanged),
		string(EventNotificationFeedChanged),
		string(EventNotification),
	}
}

// SSEType exposes the existing wire event name to the HTTP stream port.
func (event Event) SSEType() string { return string(event.Type) }

// SSEEvents exposes the same channel used by the hub, without a bridge.
func (client *Client) SSEEvents() <-chan Event { return client.Channel }

// NewSSEClient builds the client selected by the root's HTTP composition.
func NewSSEClient(events chan Event, userID, accountID, tenantID int64, admin bool, groups map[string]bool) *Client {
	return &Client{Channel: events, UserID: userID, AccountID: accountID, TenantID: tenantID, IsAdmin: admin, SubscribedGroups: groups}
}

// MarkReadsLeadershipMessages records that the connection's account reads the
// leadership conversations (#5200). The stream calls it before registering.
func (client *Client) MarkReadsLeadershipMessages(reads bool) {
	client.ReadsLeadershipMessages = reads
}
