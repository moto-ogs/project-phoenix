package domain

import (
	"slices"
	"strings"
	"time"
)

// TraegerSchoolRole is a role a Träger gives the staff of all its schools
// (#4810, ADR 0317): one auth.traeger_school_roles row with its permission
// selection.
type TraegerSchoolRole struct {
	ID             int64
	OrganizationID int64
	Name           string
	Description    string
	BaseRole       string
	PermissionIDs  []int64
	UpdatedAt      time.Time
}

// TraegerSchoolRoleNameMax bounds the name the lists of every school show.
const TraegerSchoolRoleNameMax = 100

// CopyName is the name the copies at the schools carry: every stored school
// role name is lower case (ManagedRole.Validate). The Träger-Büro keeps its
// own spelling.
func (r TraegerSchoolRole) CopyName() string {
	return strings.ToLower(r.Name)
}

// Normalize trims the texts and orders the selection without duplicates.
func (r *TraegerSchoolRole) Normalize() {
	r.Name = strings.TrimSpace(r.Name)
	r.Description = strings.TrimSpace(r.Description)
	r.BaseRole = strings.TrimSpace(r.BaseRole)
	ids := append(make([]int64, 0, len(r.PermissionIDs)), r.PermissionIDs...)
	slices.Sort(ids)
	r.PermissionIDs = slices.Compact(ids)
}

// InvalidField names the first field a Träger role may not be stored with,
// with the reason, or two empty strings.
func (r TraegerSchoolRole) InvalidField() (field, reason string) {
	switch {
	case r.Name == "":
		return "name", "name is required"
	case len([]rune(r.Name)) > TraegerSchoolRoleNameMax:
		return "name", "name is too long"
	case r.BaseRole != AdminRoleName && r.BaseRole != BaseRoleUser:
		return "base_role", "base_role must be admin or user"
	}
	for _, id := range r.PermissionIDs {
		if id <= 0 {
			return "permission_ids", "permission ids must be positive"
		}
	}
	return "", ""
}

// SchoolRoleState is one role of the school of the tenant transaction as the
// Träger roles see it: its name, the Träger role it is the copy of (nil for
// a role of the school's own) and the number of accounts that hold it.
type SchoolRoleState struct {
	RoleID        int64
	Name          string
	TraegerRoleID *int64
	Holders       int
}
