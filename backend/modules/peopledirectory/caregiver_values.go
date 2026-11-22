package peopledirectory

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

type ActiveCaregiver struct {
	AccountID int64     `json:"account_id"`
	PersonID  int64     `json:"person_id"`
	StaffID   int64     `json:"staff_id"`
	TeacherID int64     `json:"teacher_id"`
	FirstName string    `json:"first_name"`
	LastName  string    `json:"last_name"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type CaregiverCapabilityBlockerCode string

type CaregiverCapabilityState struct {
	AccountID ident.ID `json:"account_id"`
	Email     string   `json:"email"`

	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`

	PersonID  *ident.ID `json:"person_id,omitempty"`
	StaffID   *ident.ID `json:"staff_id,omitempty"`
	TeacherID *ident.ID `json:"teacher_id,omitempty"`

	HasAdminRole bool `json:"has_admin_role"`
	HasUserRole  bool `json:"has_user_role"`

	HasPerson           bool `json:"has_person"`
	HasStaff            bool `json:"has_staff"`
	HasTeacher          bool `json:"has_teacher"`
	HasCaregiverProfile bool `json:"has_caregiver_profile"`
	IsActiveCaregiver   bool `json:"is_active_caregiver"`
	DisableBlocked      bool `json:"disable_blocked"`

	DisableBlockers []CaregiverCapabilityBlockerCode `json:"disable_blockers,omitempty"`

	ActiveSupervisions   []BlockerSupervision  `json:"active_supervisions,omitempty"`
	ActiveSubstitutions  []BlockerSubstitution `json:"active_substitutions,omitempty"`
	ActivitySupervisions []BlockerActivity     `json:"activity_supervisions,omitempty"`
	GroupAssignments     []BlockerGroup        `json:"group_assignments,omitempty"`
}

type BlockerSupervision struct {
	ID        ident.ID `json:"id"`
	GroupID   int64    `json:"-"`
	GroupName string   `json:"group_name"`
	StartDate string   `json:"start_date"`
}

type BlockerSubstitution struct {
	ID        ident.ID `json:"id"`
	GroupName string   `json:"group_name"`
	StartDate string   `json:"start_date"`
	EndDate   string   `json:"end_date"`
}

type BlockerGroup struct {
	ID         ident.ID   `json:"id"`
	GroupID    ident.ID   `json:"group_id"`
	GroupName  string     `json:"group_name"`
	TeacherID  ident.ID   `json:"teacher_id"`
	TeacherIDs []ident.ID `json:"teacher_ids,omitempty"`
}

type EnableCaregiverCapabilityInput struct {
	FirstName string `json:"first_name,omitempty"`
	LastName  string `json:"last_name,omitempty"`
	Position  string `json:"position,omitempty"`
}

func (c *ActiveCaregiver) FullName() string {
	return c.FirstName + " " + c.LastName
}

const (
	CaregiverCapabilityBlockerMissingUsableRole        CaregiverCapabilityBlockerCode = "missing_usable_role"
	CaregiverCapabilityBlockerActiveGroupSupervisions  CaregiverCapabilityBlockerCode = "active_group_supervisions"
	CaregiverCapabilityBlockerActiveGroupSubstitutions CaregiverCapabilityBlockerCode = "active_group_substitutions"
	CaregiverCapabilityBlockerActivitySupervisions     CaregiverCapabilityBlockerCode = "activity_supervisions"
	CaregiverCapabilityBlockerGroupAssignments         CaregiverCapabilityBlockerCode = "group_assignments"
)
