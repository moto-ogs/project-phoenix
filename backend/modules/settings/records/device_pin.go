package records

import "fmt"

// DevicePINTooSimpleError rejects a device PIN that is easy to guess (#7175):
// the same digit throughout, a straight run up or down, or a repeated pair.
type DevicePINTooSimpleError struct {
	Key string
}

func (e *DevicePINTooSimpleError) Error() string {
	return fmt.Sprintf("invalid value for setting %s: the device PIN is too easy to guess", e.Key)
}

// Unwrap keeps the rejection an invalid value (400) for every caller.
func (e *DevicePINTooSimpleError) Unwrap() error {
	return ErrInvalidValue
}

// IsTrivialDevicePIN reports whether a device PIN is easy to guess: one digit
// repeated (1111), a straight run up or down (1234, 4321), or a repeated pair
// (1212). The empty PIN is not trivial; it is no PIN at all.
func IsTrivialDevicePIN(pin string) bool {
	if len(pin) < 2 {
		return false
	}
	for _, r := range pin {
		if r < '0' || r > '9' {
			return false
		}
	}
	return constantStep(pin) || repeatedPair(pin)
}

// constantStep reports whether every digit differs from the one before by the
// same step of -1, 0 or +1.
func constantStep(pin string) bool {
	step := int(pin[1]) - int(pin[0])
	if step < -1 || step > 1 {
		return false
	}
	for i := 2; i < len(pin); i++ {
		if int(pin[i])-int(pin[i-1]) != step {
			return false
		}
	}
	return true
}

// repeatedPair reports whether the PIN repeats its first two digits (1212).
func repeatedPair(pin string) bool {
	if len(pin) < 4 {
		return false
	}
	for i := 2; i < len(pin); i++ {
		if pin[i] != pin[i-2] {
			return false
		}
	}
	return true
}

// Why a school still needs a device PIN of its own (#7175).
const (
	// DevicePINMissing: no PIN, the tablets refuse every sign-in.
	DevicePINMissing = "missing"
	// DevicePINTooSimple: a PIN that is easy to guess, such as the former
	// default 1234; the tablets still work with it.
	DevicePINTooSimple = "too_simple"
)

// DevicePINStatus tells a school admin whether the tablets of the school still
// need a device PIN of the school's own (#7175). It never carries the PIN.
type DevicePINStatus struct {
	// SetupRequired is true while NFC-Anwesenheit is booked and the school has
	// no PIN or one that is easy to guess.
	SetupRequired bool `json:"setup_required"`
	// Reason is DevicePINMissing or DevicePINTooSimple while SetupRequired.
	Reason string `json:"reason,omitempty"`
}

// DevicePINStatusOf derives the status from the booked module and the PIN.
func DevicePINStatusOf(nfcBooked bool, pin string) DevicePINStatus {
	switch {
	case !nfcBooked:
		return DevicePINStatus{}
	case pin == "":
		return DevicePINStatus{SetupRequired: true, Reason: DevicePINMissing}
	case IsTrivialDevicePIN(pin):
		return DevicePINStatus{SetupRequired: true, Reason: DevicePINTooSimple}
	default:
		return DevicePINStatus{}
	}
}
