package authorize

import "testing"

func TestDefaultGuardianRoleIsConservative(t *testing.T) {
	t.Parallel()
	tests := []struct {
		relationship       string
		primary, emergency bool
		pickup             bool
		want               string
	}{
		{"other", true, false, false, GuardianRolePrimaryGuardian},
		{"guardian", false, false, false, GuardianRoleLegalGuardian},
		{"other", false, false, true, GuardianRolePickupOnly},
		{"other", false, true, false, GuardianRoleEmergency},
		{"other", false, false, false, GuardianRoleCustom},
	}
	for _, tt := range tests {
		if got := DefaultStudentGuardianRole(tt.relationship, tt.primary, tt.emergency, tt.pickup); got != tt.want {
			t.Errorf("DefaultStudentGuardianRole() = %q, want %q", got, tt.want)
		}
	}
}

func TestFullGuardianCanManageStudentConsents(t *testing.T) {
	t.Parallel()

	for _, role := range []string{GuardianRolePrimaryGuardian, GuardianRoleLegalGuardian, GuardianRoleCoGuardian} {
		if StudentGuardianPermissionSet(role)[GuardianPermissionConsentManage] != true {
			t.Fatalf("full guardian role %q cannot manage student consents", role)
		}
	}
}

func TestFullGuardianCanManageMealParticipation(t *testing.T) {
	t.Parallel()

	for _, role := range []string{GuardianRolePrimaryGuardian, GuardianRoleLegalGuardian, GuardianRoleCoGuardian} {
		if StudentGuardianPermissionSet(role)[GuardianPermissionMealParticipationManage] != true {
			t.Fatalf("full guardian role %q cannot manage meal participation", role)
		}
	}
}

func TestGuardianRoleNormalizationAndPermissionSets(t *testing.T) {
	t.Parallel()
	for _, role := range []string{GuardianRolePrimaryGuardian, GuardianRoleLegalGuardian, GuardianRoleCoGuardian} {
		if !IsFullGuardianRole(role) || len(StudentGuardianPermissionSet(role)) != len(fullParentPortalPermissions) {
			t.Fatalf("full role %q did not receive the full permission set", role)
		}
	}
	for _, role := range []string{GuardianRoleEmergency, GuardianRolePickupOnly, GuardianRoleSocialWorker, GuardianRoleCustom, "unknown"} {
		if len(StudentGuardianPermissionSet(role)) != 0 {
			t.Fatalf("restricted role %q received permissions", role)
		}
	}
	if got := NormalizeGuardianRole("  LEGAL_GUARDIAN "); got != GuardianRoleLegalGuardian {
		t.Fatalf("NormalizeGuardianRole() = %q", got)
	}
}
