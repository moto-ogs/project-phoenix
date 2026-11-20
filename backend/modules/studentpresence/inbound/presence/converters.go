package presence

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
)

// ===== Conversion Functions =====

func newPresenceLiveGroupResponse(group studentpresence.LiveGroup) ActiveGroupResponse {
	return ActiveGroupResponse{
		ID: group.ID, GroupID: group.ActivityGroupID, RoomID: group.RoomID,
		StartTime: group.StartTime, EndTime: group.EndTime, IsActive: group.IsOpen(),
		CreatedAt: group.CreatedAt, UpdatedAt: group.UpdatedAt,
	}
}

// newSessionRoomResponse projects the room summary a session response embeds.
func newSessionRoomResponse(room studentpresence.SessionRoomSummary) *RoomSimple {
	return &RoomSimple{ID: room.ID, Name: room.Name, Color: room.Color}
}

// claimedSupervisionResponse keeps the wire shape of the claimed supervision
// record: the persisted row with its calendar start day.
type claimedSupervisionResponse struct {
	ID        int64     `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	TenantID  int64     `json:"tenant_id"`
	StaffID   int64     `json:"staff_id"`
	GroupID   int64     `json:"group_id"`
	Role      string    `json:"role"`
	StartDate string    `json:"start_date"`
}

func newClaimedSupervisionResponse(row studentpresence.ClaimedSupervision) claimedSupervisionResponse {
	return claimedSupervisionResponse{
		ID: row.ID, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, TenantID: row.TenantID,
		StaffID: row.StaffID, GroupID: row.GroupID, Role: row.Role, StartDate: row.StartDate,
	}
}

// crossTenantStudentResponse keeps the wire shape of a hosted child.
type crossTenantStudentResponse struct {
	StudentID  int64  `json:"student_id"`
	FirstName  string `json:"first_name"`
	LastName   string `json:"last_name"`
	GroupName  string `json:"group_name"`
	HomeTenant string `json:"home_tenant"`
}

func newCrossTenantStudentResponses(rows []studentpresence.CrossTenantStudent) []crossTenantStudentResponse {
	responses := make([]crossTenantStudentResponse, 0, len(rows))
	for _, row := range rows {
		responses = append(responses, crossTenantStudentResponse{
			StudentID: row.StudentID, FirstName: row.FirstName, LastName: row.LastName,
			GroupName: row.GroupName, HomeTenant: row.HomeTenant,
		})
	}
	return responses
}
