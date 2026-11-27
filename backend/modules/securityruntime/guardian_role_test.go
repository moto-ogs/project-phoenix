package securityruntime

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/securityruntime/internal/application/authorize"
)

// TestDefaultGuardianRolePresetMatchesThePolicy pins the composition that
// gives a new relationship its default role (#2727): the default preset and
// the permissions it grants equal what the authorization policy applies.
func TestDefaultGuardianRolePresetMatchesThePolicy(t *testing.T) {
	t.Parallel()

	for _, relationshipType := range []string{"parent", "guardian", "grandparent", ""} {
		for _, flags := range [][3]bool{{}, {true, false, false}, {false, true, false}, {false, false, true}} {
			wantRole := authorize.DefaultStudentGuardianRole(relationshipType, flags[0], flags[1], flags[2])
			wantPermissions := authorize.StudentGuardianPermissionSet(wantRole)

			role, granted := StudentGuardianRolePreset(DefaultStudentGuardianRole(relationshipType, flags[0], flags[1], flags[2]))
			if role != wantRole {
				t.Errorf("%q %v: role %q, policy applies %q", relationshipType, flags, role, wantRole)
			}
			if len(granted) != len(wantPermissions) {
				t.Errorf("%q %v: %d permissions, policy applies %d", relationshipType, flags, len(granted), len(wantPermissions))
			}
			for _, permission := range granted {
				if wantPermissions[permission] != true {
					t.Errorf("%q %v: preset grants %q, policy does not", relationshipType, flags, permission)
				}
			}
		}
	}
}

func TestGuardianPermissionGranted(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name  string
		value any
		want  bool
	}{
		{"true", true, true},
		{"false", false, false},
		{"absent", nil, false},
		{"historical non-boolean value", "yes", true},
	} {
		if got := GuardianPermissionGranted(tc.value); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

// TestClassifyGuardianRoleGroupsTheStoredRoles pins the classes the guardian
// invitation flows act on: full presets need no upgrade, the social worker
// preset is school-managed, every other stored role (unknown ones included)
// is a restricted contact.
func TestClassifyGuardianRoleGroupsTheStoredRoles(t *testing.T) {
	t.Parallel()

	cases := map[string]GuardianRoleClass{
		GuardianRolePrimaryGuardian: GuardianRoleClassFull,
		" Legal_Guardian ":          GuardianRoleClassFull,
		GuardianRoleCoGuardian:      GuardianRoleClassFull,
		GuardianRoleSocialWorker:    GuardianRoleClassSocialWorker,
		" SOCIAL_WORKER":            GuardianRoleClassSocialWorker,
		GuardianRoleEmergency:       GuardianRoleClassRestricted,
		GuardianRolePickupOnly:      GuardianRoleClassRestricted,
		GuardianRoleCustom:          GuardianRoleClassRestricted,
		"":                          GuardianRoleClassRestricted,
		"unknown":                   GuardianRoleClassRestricted,
	}
	for role, want := range cases {
		if got := ClassifyGuardianRole(role); got != want {
			t.Errorf("ClassifyGuardianRole(%q) = %d, want %d", role, got, want)
		}
	}
}
