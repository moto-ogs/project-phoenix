package timetablehttp

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// weekProtocolResponse is the wire form of a protocol; int64 ids travel as
// strings, calendar days as YYYY-MM-DD.
type weekProtocolResponse struct {
	ID                  ident.ID                  `json:"id"`
	Scope               string                    `json:"scope"`
	GroupID             *ident.ID                 `json:"group_id,omitempty"`
	GroupName           string                    `json:"group_name"`
	WeekStart           string                    `json:"week_start"`
	WeekEnd             string                    `json:"week_end"`
	Status              string                    `json:"status"`
	DraftFrom           string                    `json:"draft_from"`
	AutoCloseOn         string                    `json:"auto_close_on"`
	WeekNote            string                    `json:"week_note"`
	DraftedAt           *string                   `json:"drafted_at,omitempty"`
	ClosedAt            *string                   `json:"closed_at,omitempty"`
	ClosedByName        string                    `json:"closed_by_name,omitempty"`
	ClosedAutomatically bool                      `json:"closed_automatically"`
	Days                []weekProtocolDayResponse `json:"days,omitempty"`
	// Version is the protocol's read-state token (ADR 0311), answered with
	// the days; the notes and the closing send it back as expected_version.
	Version string `json:"version,omitempty"`
}

type weekProtocolDayResponse struct {
	Date       string                             `json:"date"`
	Captured   bool                               `json:"captured"`
	CapturedAt *string                            `json:"captured_at,omitempty"`
	Kind       string                             `json:"kind,omitempty"`
	Present    int                                `json:"present"`
	Sick       int                                `json:"sick"`
	Excused    int                                `json:"excused"`
	ClassTrip  int                                `json:"class_trip"`
	Absent     int                                `json:"absent"`
	Missing    []weekProtocolMissingChildResponse `json:"missing"`
	Blocks     []timetable.WeekProtocolBlock      `json:"blocks"`
	Notices    []timetable.WeekProtocolNotice     `json:"notices"`
	Note       string                             `json:"note"`
}

type weekProtocolMissingChildResponse struct {
	StudentID ident.ID `json:"student_id"`
	Name      string   `json:"name"`
	Reason    string   `json:"reason"`
	Label     string   `json:"label"`
}

// weekProtocolResponseOf projects a protocol; withDays adds Monday to Friday
// always and a weekend day only when it was recorded or noted.
func weekProtocolResponseOf(protocol timetable.WeekProtocol, withDays bool) weekProtocolResponse {
	out := weekProtocolResponse{
		ID: ident.ID(protocol.ID), Scope: protocol.Scope, GroupName: protocol.GroupName,
		WeekStart: protocol.WeekStart.String(), WeekEnd: protocol.WeekEnd.String(), Status: protocol.Status,
		DraftFrom: protocol.WeekStart.AddDays(4).String(), AutoCloseOn: protocol.WeekStart.AddDays(14).String(),
		WeekNote: protocol.WeekNote, DraftedAt: rfc3339(protocol.DraftedAt), ClosedAt: rfc3339(protocol.ClosedAt),
		ClosedByName: protocol.ClosedByName, ClosedAutomatically: protocol.ClosedAutomatically,
	}
	if protocol.GroupID != nil {
		id := ident.ID(*protocol.GroupID)
		out.GroupID = &id
	}
	if withDays {
		out.Days = weekProtocolDaysResponse(protocol)
		out.Version = timetable.WeekProtocolVersion(protocol)
	}
	return out
}

func weekProtocolDaysResponse(protocol timetable.WeekProtocol) []weekProtocolDayResponse {
	shown := protocol.ShownDays()
	days := make([]weekProtocolDayResponse, 0, len(shown))
	for _, day := range shown {
		days = append(days, weekProtocolDayResponseOf(day.Date, day))
	}
	return days
}

func weekProtocolDayResponseOf(date calendar.Date, day timetable.WeekProtocolDay) weekProtocolDayResponse {
	out := weekProtocolDayResponse{
		Date: date.String(), Note: day.Note, CapturedAt: rfc3339(day.CapturedAt),
		Missing: []weekProtocolMissingChildResponse{}, Blocks: []timetable.WeekProtocolBlock{}, Notices: []timetable.WeekProtocolNotice{},
	}
	if day.Facts == nil {
		return out
	}
	facts := day.Facts
	out.Captured, out.Kind = true, facts.Kind
	out.Present, out.Sick, out.Excused, out.ClassTrip, out.Absent = facts.Present, facts.Sick, facts.Excused, facts.ClassTrip, facts.Absent
	for _, child := range facts.Missing {
		out.Missing = append(out.Missing, weekProtocolMissingChildResponse{
			StudentID: ident.ID(child.StudentID), Name: child.Name, Reason: child.Reason, Label: child.Label,
		})
	}
	if facts.Blocks != nil {
		out.Blocks = facts.Blocks
	}
	if facts.Notices != nil {
		out.Notices = facts.Notices
	}
	return out
}

func rfc3339(t *time.Time) *string {
	if t == nil {
		return nil
	}
	value := t.Format(time.RFC3339)
	return &value
}
