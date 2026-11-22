package timetracking

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// SessionResponse is a work block as the own time-tracking routes answer it.
// The identifiers travel as decimal strings: JavaScript rounds an int64
// above Number.MAX_SAFE_INTEGER while parsing numeric JSON.
type SessionResponse struct {
	ID             ident.ID   `json:"id"`
	TenantID       ident.ID   `json:"tenant_id"`
	StaffID        ident.ID   `json:"staff_id"`
	Date           string     `json:"date"`
	Status         string     `json:"status"`
	Source         string     `json:"source"`
	CheckInTime    time.Time  `json:"check_in_time"`
	CheckOutTime   *time.Time `json:"check_out_time,omitempty"`
	BreakMinutes   int        `json:"break_minutes"`
	Notes          string     `json:"notes,omitempty"`
	AutoCheckedOut bool       `json:"auto_checked_out"`
	CreatedBy      ident.ID   `json:"created_by"`
	UpdatedBy      *ident.ID  `json:"updated_by,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// sessionResponse renders a block; no block renders as null.
func sessionResponse(session *workforce.WorkSession) *SessionResponse {
	if session == nil {
		return nil
	}
	var updatedBy *ident.ID
	if session.UpdatedBy != nil {
		id := ident.ID(*session.UpdatedBy)
		updatedBy = &id
	}
	return &SessionResponse{
		ID: ident.ID(session.ID), TenantID: ident.ID(session.TenantID), StaffID: ident.ID(session.StaffID),
		Date: session.Date, Status: session.Status, Source: session.Source,
		CheckInTime: session.CheckInTime, CheckOutTime: session.CheckOutTime,
		BreakMinutes: session.BreakMinutes, Notes: session.Notes, AutoCheckedOut: session.AutoCheckedOut,
		CreatedBy: ident.ID(session.CreatedBy), UpdatedBy: updatedBy,
		CreatedAt: session.CreatedAt, UpdatedAt: session.UpdatedAt,
	}
}

// HistorySessionResponse is a block of the history with what was computed
// from it. It names the wire form workforce.SessionResponse writes;
// BreakMinutes is the computed value there, not the block's cached one.
type HistorySessionResponse struct {
	ID               ident.ID                      `json:"id"`
	TenantID         ident.ID                      `json:"tenant_id"`
	StaffID          ident.ID                      `json:"staff_id"`
	Date             string                        `json:"date"`
	Status           string                        `json:"status"`
	Source           string                        `json:"source"`
	CheckInTime      time.Time                     `json:"check_in_time"`
	CheckOutTime     *time.Time                    `json:"check_out_time,omitempty"`
	Notes            string                        `json:"notes,omitempty"`
	AutoCheckedOut   bool                          `json:"auto_checked_out"`
	CreatedBy        ident.ID                      `json:"created_by"`
	UpdatedBy        *ident.ID                     `json:"updated_by,omitempty"`
	CreatedAt        time.Time                     `json:"created_at"`
	UpdatedAt        time.Time                     `json:"updated_at"`
	BreakMinutes     int                           `json:"break_minutes"`
	NetMinutes       int                           `json:"net_minutes"`
	IsOvertime       bool                          `json:"is_overtime"`
	IsBreakCompliant bool                          `json:"is_break_compliant"`
	Breaks           []*workforce.WorkSessionBreak `json:"breaks"`
	EditCount        int                           `json:"edit_count"`
	AuditCount       int                           `json:"audit_count"`
	PackUpMinutes    int                           `json:"pack_up_minutes"`
	RoundingMinutes  int                           `json:"rounding_minutes"`
}

// HistoryResponse is the history of a range with its weekly sums and the
// ArbZG hints per workday.
type HistoryResponse struct {
	Sessions        []HistorySessionResponse     `json:"sessions"`
	WeeklySummaries []workforce.WorkWeekSummary  `json:"weekly_summaries"`
	LaborDays       []workforce.WorkDayLaborHint `json:"labor_days"`
}

func historyResponse(history *workforce.HistoryResponse) HistoryResponse {
	out := HistoryResponse{WeeklySummaries: history.WeeklySummaries, LaborDays: history.LaborDays}
	if history.Sessions != nil {
		out.Sessions = make([]HistorySessionResponse, 0, len(history.Sessions))
	}
	for _, row := range history.Sessions {
		block := sessionResponse(row.WorkSession)
		out.Sessions = append(out.Sessions, HistorySessionResponse{
			ID: block.ID, TenantID: block.TenantID, StaffID: block.StaffID,
			Date: block.Date, Status: block.Status, Source: block.Source,
			CheckInTime: block.CheckInTime, CheckOutTime: block.CheckOutTime,
			Notes: block.Notes, AutoCheckedOut: block.AutoCheckedOut,
			CreatedBy: block.CreatedBy, UpdatedBy: block.UpdatedBy,
			CreatedAt: block.CreatedAt, UpdatedAt: block.UpdatedAt,
			BreakMinutes: row.BreakMinutes, NetMinutes: row.NetMinutes,
			IsOvertime: row.IsOvertime, IsBreakCompliant: row.IsBreakCompliant,
			Breaks: row.Breaks, EditCount: row.EditCount, AuditCount: row.AuditCount,
			PackUpMinutes: row.PackUpMinutes, RoundingMinutes: row.RoundingMinutes,
		})
	}
	return out
}
