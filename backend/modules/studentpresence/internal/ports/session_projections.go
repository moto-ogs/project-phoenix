package ports

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// SessionActivity is timetable-owned activity data projected onto a presence session.
// It has no persistence or activity mutation behavior.
type SessionActivity struct {
	ID                    ident.ID                 `json:"id"`
	TenantID              ident.ID                 `json:"tenant_id"`
	CreatedAt             time.Time                `json:"created_at"`
	UpdatedAt             time.Time                `json:"updated_at"`
	Name                  string                   `json:"name"`
	MaxParticipants       int                      `json:"max_participants"`
	RequiredStaff         *int                     `json:"required_staff,omitempty"`
	IsOpen                bool                     `json:"is_open"`
	CategoryID            ident.ID                 `json:"category_id"`
	PlanningTrackID       *ident.ID                `json:"planning_track_id,omitempty"`
	PlannedRoomID         *ident.ID                `json:"planned_room_id,omitempty"`
	CreatedBy             *ident.ID                `json:"created_by"`
	Type                  string                   `json:"type"`
	EducationGroupID      *ident.ID                `json:"education_group_id,omitempty"`
	ListKind              *string                  `json:"list_kind,omitempty"`
	IsTemplate            bool                     `json:"is_template"`
	IsSystem              bool                     `json:"is_system"`
	ArchivedAt            *time.Time               `json:"archived_at,omitempty"`
	SeriesRootID          *int64                   `json:"-"`
	CalendarPeriodID      *ident.ID                `json:"calendar_period_id,omitempty"`
	TargetGroupType       string                   `json:"target_group_type"`
	TargetGradeLevel      *int16                   `json:"target_grade_level,omitempty"`
	TargetSchoolClass     *string                  `json:"target_school_class,omitempty"`
	SourceCareOfferingIDs []ident.ID               `json:"source_care_offering_ids,omitempty"`
	SourceGradeLevels     []int                    `json:"source_grade_levels,omitempty"`
	SourceSchoolClasses   []string                 `json:"source_school_classes,omitempty"`
	Notes                 *string                  `json:"notes,omitempty"`
	Category              *SessionActivityCategory `json:"category,omitempty"`
}

// SessionActivityCategory is the category projected with a session activity.
type SessionActivityCategory struct {
	ID          ident.ID   `json:"id"`
	TenantID    ident.ID   `json:"tenant_id"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	Name        string     `json:"name"`
	Description string     `json:"description,omitempty"`
	Color       string     `json:"color,omitempty"`
	IsSystem    bool       `json:"is_system"`
	ShiftTypeID *ident.ID  `json:"shift_type_id,omitempty"`
	ArchivedAt  *time.Time `json:"archived_at,omitempty"`
}

// ParticipantLimit returns the activity's participant cap, or nil when it
// has none.
func (g *SessionActivity) ParticipantLimit() *int {
	if g.MaxParticipants <= 0 {
		return nil
	}
	limit := g.MaxParticipants
	return &limit
}

// SessionStaff is membership information attached to a supervision read.
type SessionStaff struct {
	ID                    ident.ID            `json:"id"`
	TenantID              ident.ID            `json:"tenant_id"`
	CreatedAt             time.Time           `json:"created_at"`
	UpdatedAt             time.Time           `json:"updated_at"`
	PersonID              ident.ID            `json:"person_id"`
	StaffNotes            string              `json:"staff_notes,omitempty"`
	EmploymentType        *string             `json:"employment_type,omitempty"`
	WorkTimeModelID       *ident.ID           `json:"work_time_model_id,omitempty"`
	RotationAnchorDate    *Date               `json:"rotation_anchor_date,omitempty"`
	BirthdayDisplayOptOut bool                `json:"birthday_display_opt_out"`
	Person                *SessionStaffPerson `json:"person,omitempty"`
}

// SessionStaffPerson preserves the person facts returned by the owner directory.
type SessionStaffPerson struct {
	ID        ident.ID  `json:"id"`
	TenantID  ident.ID  `json:"tenant_id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	FirstName string    `json:"first_name"`
	LastName  string    `json:"last_name"`
	Birthday  *Date     `json:"birthday,omitempty"`
	TagID     *string   `json:"tag_id,omitempty"`
	AccountID *ident.ID `json:"account_id,omitempty"`
}

// GetFullName returns the person's display name.
func (p *SessionStaffPerson) GetFullName() string { return p.FirstName + " " + p.LastName }
