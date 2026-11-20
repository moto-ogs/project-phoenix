package files

import "testing"

// The staff avatar moved its cache rule from the frontend proxy into the
// handler (#2352): only the address of the current file stays a day, and
// nothing is ever public.
func TestStaffAvatarCacheControl(t *testing.T) {
	t.Parallel()
	stored := "/uploads/avatars/account-7-1700000000.jpg"
	for _, tc := range []struct{ version, want string }{
		{"account-7-1700000000.jpg", "private, max-age=86400, immutable"},
		{"account-7-1600000000.jpg", "private, max-age=300"},
		{"", "private, max-age=300"},
	} {
		if got := staffAvatarCacheControl(tc.version, stored); got != tc.want {
			t.Errorf("staffAvatarCacheControl(%q) = %q, want %q", tc.version, got, tc.want)
		}
	}
}
