package records

import "testing"

func TestIsTrivialDevicePIN(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		pin     string
		trivial bool
	}{
		{"1234", true},
		{"0123", true},
		{"6789", true},
		{"4321", true},
		{"9876", true},
		{"0000", true},
		{"1111", true},
		{"9999", true},
		{"1212", true},
		{"6969", true},
		{"1010", true},
		{"", false},
		{"4729", false},
		{"2580", false},
		{"7890", false},
		{"1122", false},
		{"12a4", false},
	} {
		if got := IsTrivialDevicePIN(tc.pin); got != tc.trivial {
			t.Errorf("IsTrivialDevicePIN(%q) = %v, want %v", tc.pin, got, tc.trivial)
		}
	}
}
