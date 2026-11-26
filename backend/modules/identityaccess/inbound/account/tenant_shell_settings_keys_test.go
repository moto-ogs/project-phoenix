package account

import (
	"maps"
	"slices"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/settings"
)

func TestTenantShellSettingKeysCoverEveryLookupRead(t *testing.T) {
	t.Parallel()
	keys := map[string]bool{settings.KeyEnrollmentGradeLevelMax: true}
	_, err := resolveTenantShellValues(
		func(key string) (bool, error) {
			keys[key] = true
			return true, nil // Include reads behind enabled flags.
		},
		func(key string) (string, error) {
			keys[key] = true
			return "", nil
		},
		func(key string) (int, error) {
			keys[key] = true
			return 0, nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	want := slices.Sorted(maps.Keys(keys))
	got := TenantShellSettingKeys()
	slices.Sort(got)
	if !slices.Equal(got, want) {
		t.Fatalf("lookup invalidation keys = %q, want %q", got, want)
	}
}
