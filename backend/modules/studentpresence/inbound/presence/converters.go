package presence

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// ===== Conversion Functions =====

func newPresenceLiveGroupResponse(group studentpresence.LiveGroup) ActiveGroupResponse {
	return ActiveGroupResponse{
		ID: ident.ID(group.ID), GroupID: (*ident.ID)(group.ActivityGroupID), RoomID: ident.ID(group.RoomID),
		StartTime: group.StartTime, EndTime: group.EndTime, IsActive: group.IsOpen(),
		CreatedAt: group.CreatedAt, UpdatedAt: group.UpdatedAt,
	}
}

// newSessionRoomResponse projects the room summary a session response embeds.
func newSessionRoomResponse(room studentpresence.SessionRoomSummary) *RoomSimple {
	return &RoomSimple{ID: ident.ID(room.ID), Name: room.Name, Color: room.Color}
}

// claimedSupervisionResponse keeps the wire shape of the claimed supervision
// record: the persisted row with its calendar start day.
type claimedSupervisionResponse struct {
	ID        ident.ID  `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	TenantID  ident.ID  `json:"tenant_id"`
	StaffID   ident.ID  `json:"staff_id"`
	GroupID   ident.ID  `json:"group_id"`
	Role      string    `json:"role"`
	StartDate string    `json:"start_date"`
}

func newClaimedSupervisionResponse(row studentpresence.ClaimedSupervision) claimedSupervisionResponse {
	return claimedSupervisionResponse{
		ID: ident.ID(row.ID), CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, TenantID: ident.ID(row.TenantID),
		StaffID: ident.ID(row.StaffID), GroupID: ident.ID(row.GroupID), Role: row.Role, StartDate: row.StartDate,
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
