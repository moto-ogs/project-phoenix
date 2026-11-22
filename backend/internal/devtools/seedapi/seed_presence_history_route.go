package api

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// presenceHistoryRouteChunk is how many days one request carries. The route
// accepts at most 1000 days; every chunk is its own transaction, and a retry
// recognizes the days an earlier chunk already wrote.
const presenceHistoryRouteChunk = 500

type presenceHistoryRouteDay struct {
	StudentID ident.ID                   `json:"student_id"`
	Date      calendar.Date              `json:"date"`
	DeviceID  ident.ID                   `json:"device_id"`
	CheckIn   time.Time                  `json:"check_in"`
	CheckOut  time.Time                  `json:"check_out"`
	Visit     *presenceHistoryRouteVisit `json:"visit,omitempty"`
}

type presenceHistoryRouteVisit struct {
	ActivityGroupID ident.ID  `json:"activity_group_id"`
	RoomID          ident.ID  `json:"room_id"`
	SessionStart    time.Time `json:"session_start"`
	SessionEnd      time.Time `json:"session_end"`
	Entry           time.Time `json:"entry"`
	Exit            time.Time `json:"exit"`
}

// presenceHistoryWriterFor picks the bound writer, else the demo's operator
// route when the options ask for it; nil seeds the past without presence.
func presenceHistoryWriterFor(options SeedOptions, rt *Runtime) PresenceHistoryWriter {
	if options.PresenceHistory != nil {
		return options.PresenceHistory
	}
	if options.PresenceHistoryRoute {
		return operatorPresenceHistoryWriter(rt)
	}
	return nil
}

// operatorPresenceHistoryWriter records the past care days through the
// operator route the server mounts in the public demo only (ADR 0127). Its
// sidecar has no database it may write presence to.
func operatorPresenceHistoryWriter(rt *Runtime) PresenceHistoryWriter {
	return func(_ context.Context, schoolID int64, days []PastPresenceDay) (int, error) {
		path := fmt.Sprintf("/operator/schools/%d/demo-presence-history", schoolID)
		written := 0
		for start := 0; start < len(days); start += presenceHistoryRouteChunk {
			chunk := days[start:min(start+presenceHistoryRouteChunk, len(days))]
			body, err := textIDBody(map[string]any{"days": presenceHistoryRouteDays(chunk)})
			if err != nil {
				return written, err
			}
			raw, err := rt.Client.PostWithAuth(rt.OperatorAuth, path, body)
			if err != nil {
				return written, err
			}
			var response struct {
				Data struct {
					Written int `json:"written"`
				} `json:"data"`
			}
			if err := parseJSON(raw, &response); err != nil {
				return written, fmt.Errorf("read recorded presence history: %w", err)
			}
			written += response.Data.Written
		}
		return written, nil
	}
}

// textIDBody encodes a body with every ident.ID as a decimal string, as a
// browser sends it (#7808).
func textIDBody(body any) (json.RawMessage, error) {
	return wire.Marshal(body)
}

func presenceHistoryRouteDays(days []PastPresenceDay) []presenceHistoryRouteDay {
	result := make([]presenceHistoryRouteDay, 0, len(days))
	for _, day := range days {
		wire := presenceHistoryRouteDay{
			StudentID: ident.ID(day.StudentID), Date: day.Date, DeviceID: ident.ID(day.DeviceID),
			CheckIn: day.CheckIn, CheckOut: day.CheckOut,
		}
		if visit := day.Visit; visit != nil {
			wire.Visit = &presenceHistoryRouteVisit{
				ActivityGroupID: ident.ID(visit.ActivityGroupID), RoomID: ident.ID(visit.RoomID),
				SessionStart: visit.SessionStart, SessionEnd: visit.SessionEnd,
				Entry: visit.Entry, Exit: visit.Exit,
			}
		}
		result = append(result, wire)
	}
	return result
}
