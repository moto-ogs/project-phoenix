package users

import (
	"testing"
)

func TestStudentGuardian_Validate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		sg      *StudentGuardian
		wantErr bool
	}{
		{
			name: "valid",
			sg: &StudentGuardian{
				StudentID:         1,
				GuardianProfileID: 2,
				RelationshipType:  "parent",
				IsPrimary:         true,
			},
			wantErr: false,
		},
		{
			name: "missing student ID",
			sg: &StudentGuardian{
				GuardianProfileID: 2,
				RelationshipType:  "parent",
			},
			wantErr: true,
		},
		{
			name: "missing guardian profile ID",
			sg: &StudentGuardian{
				StudentID:        1,
				RelationshipType: "parent",
			},
			wantErr: true,
		},
		{
			name: "missing relationship type",
			sg: &StudentGuardian{
				StudentID:         1,
				GuardianProfileID: 2,
			},
			wantErr: true,
		},
		{
			name: "invalid relationship type",
			sg: &StudentGuardian{
				StudentID:         1,
				GuardianProfileID: 2,
				RelationshipType:  "invalid",
			},
			wantErr: true,
		},
		{
			name: "normalize relationship type to lowercase",
			sg: &StudentGuardian{
				StudentID:         1,
				GuardianProfileID: 2,
				RelationshipType:  "PARENT",
			},
			wantErr: false,
		},
		{
			name: "permissions map",
			sg: &StudentGuardian{
				StudentID:         1,
				GuardianProfileID: 2,
				RelationshipType:  "parent",
				Permissions:       map[string]interface{}{"test": true},
			},
			wantErr: false,
		},
		{
			name: "normalizes guardian role",
			sg: &StudentGuardian{
				StudentID:         1,
				GuardianProfileID: 2,
				RelationshipType:  "parent",
				GuardianRole:      " Legal_Guardian ",
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.sg.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("StudentGuardian.Validate() error = %v, wantErr %v", err, tt.wantErr)
			}

			// Check normalization of relationship type
			if tt.name == "normalize relationship type to lowercase" && tt.sg.RelationshipType != "parent" {
				t.Errorf("StudentGuardian.Validate() failed to normalize relationship type, got %v", tt.sg.RelationshipType)
			}
			if err == nil && tt.sg.GuardianRole == "" {
				t.Error("StudentGuardian.Validate() left guardian role empty")
			}
			if tt.name == "normalizes guardian role" && tt.sg.GuardianRole != "legal_guardian" {
				t.Errorf("StudentGuardian.Validate() guardian role = %q, want legal_guardian", tt.sg.GuardianRole)
			}
		})
	}
}
