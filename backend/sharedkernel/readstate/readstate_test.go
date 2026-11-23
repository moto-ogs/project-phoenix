package readstate_test

import (
	"errors"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

func TestCheckAcceptsOnlyTheStoredToken(t *testing.T) {
	t.Parallel()
	stored := readstate.Of(time.Date(2026, 11, 23, 9, 30, 0, 123456000, time.FixedZone("CET", 3600)))
	cases := map[string]struct {
		expected string
		refused  bool
	}{
		"same state":        {stored, false},
		"older state":       {readstate.Of(time.Date(2026, 11, 23, 8, 0, 0, 0, time.UTC)), true},
		"no state was read": {"", true},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			err := readstate.Check(tc.expected, stored)
			if refused := errors.Is(err, readstate.ErrChanged); refused != tc.refused {
				t.Fatalf("Check(%q) = %v, refused %v", tc.expected, err, tc.refused)
			}
		})
	}
}

// TestAnUnloadedChangeTimeIsNoToken pins that a projection which failed to
// load updated_at cannot pass the check against itself: a zero time has the
// empty token, which Check refuses. A row not stored yet has Absent instead.
func TestAnUnloadedChangeTimeIsNoToken(t *testing.T) {
	t.Parallel()
	unloaded := readstate.Of(time.Time{})
	if !errors.Is(readstate.Check(unloaded, unloaded), readstate.ErrChanged) {
		t.Fatalf("zero time token %q passed the check", unloaded)
	}
	if err := readstate.Check(readstate.Absent, readstate.Absent); err != nil {
		t.Fatalf("Absent against Absent: %v", err)
	}
	if readstate.Absent == readstate.Of(time.Date(2026, 11, 23, 9, 0, 0, 0, time.UTC)) {
		t.Fatal("Absent is the token of a stored row")
	}
}

func TestOfIsTheSameInstantInAnyZone(t *testing.T) {
	t.Parallel()
	instant := time.Date(2026, 11, 23, 8, 30, 0, 5000, time.UTC)
	if readstate.Of(instant) != readstate.Of(instant.In(time.FixedZone("CET", 3600))) {
		t.Fatal("one instant gave two tokens")
	}
}

func TestFingerprintFollowsTheState(t *testing.T) {
	t.Parallel()
	read, again := readstate.Fingerprint([]int{1, 2}), readstate.Fingerprint([]int{1, 2})
	if read != again {
		t.Fatal("one state gave two fingerprints")
	}
	if read == readstate.Fingerprint([]int{1, 3}) {
		t.Fatal("two states gave one fingerprint")
	}
}

func TestErrChangedIsABusinessRejection(t *testing.T) {
	t.Parallel()
	var rejection interface {
		ErrorCode() string
		ErrorDetails() any
	}
	if !errors.As(readstate.Check("", "x"), &rejection) || rejection.ErrorCode() != readstate.ChangedCode {
		t.Fatal("ErrChanged does not carry its registered code")
	}
}
