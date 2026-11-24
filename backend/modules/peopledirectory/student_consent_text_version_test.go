package peopledirectory

import "testing"

func TestStudentConsentTextVersion(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		key     string
		source  string
		granted bool
		want    *string
	}{
		{"parent portal photo grant", StudentConsentPhoto, "parent_portal", true, new(StudentConsentPhotoTextVersion)},
		{"tenant portal photo grant", StudentConsentPhoto, "tenant_portal", true, new(StudentConsentPhotoTextVersion)},
		{"parent portal photo withdrawal", StudentConsentPhoto, "parent_portal", false, nil},
		{"tenant portal photo withdrawal", StudentConsentPhoto, "tenant_portal", false, nil},
		{"enrollment photo grant", StudentConsentPhoto, "enrollment", true, nil},
		{"import photo grant", StudentConsentPhoto, "import", true, nil},
		{"migration snapshot photo grant", StudentConsentPhoto, "migration_snapshot", true, nil},
		{"unknown source photo grant", StudentConsentPhoto, "kiosk", true, nil},
		{"parent portal email grant", StudentConsentEmailContact, "parent_portal", true, nil},
		{"tenant portal agb grant", StudentConsentAGB, "tenant_portal", true, nil},
		{"tenant portal data processing grant", StudentConsentDataProcessing, "tenant_portal", true, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := StudentConsentTextVersion(tc.key, tc.source, tc.granted)
			switch {
			case tc.want == nil && got != nil:
				t.Fatalf("StudentConsentTextVersion(%q, %q, %v) = %q, want nil", tc.key, tc.source, tc.granted, *got)
			case tc.want != nil && got == nil:
				t.Fatalf("StudentConsentTextVersion(%q, %q, %v) = nil, want %q", tc.key, tc.source, tc.granted, *tc.want)
			case tc.want != nil && *got != *tc.want:
				t.Fatalf("StudentConsentTextVersion(%q, %q, %v) = %q, want %q", tc.key, tc.source, tc.granted, *got, *tc.want)
			}
		})
	}
	if StudentConsentPhotoTextVersion != "photo-1" {
		t.Fatalf("StudentConsentPhotoTextVersion = %q, want photo-1", StudentConsentPhotoTextVersion)
	}
}
