package records

import "fmt"

// EnrollmentPrivacyNoticeGap names what keeps the privacy notice of the
// public enrollment form from being shown (#7176).
type EnrollmentPrivacyNoticeGap string

const (
	// EnrollmentPrivacyNoticeTextMissing: the notice text is empty or blank.
	EnrollmentPrivacyNoticeTextMissing EnrollmentPrivacyNoticeGap = "text"
	// EnrollmentPrivacyNoticeSwitchOff: a text exists, but its switch is off.
	EnrollmentPrivacyNoticeSwitchOff EnrollmentPrivacyNoticeGap = "switch"
)

// EnrollmentPrivacyNoticeError rejects switching the public enrollment form
// on while the form would show no privacy notice under Art. 13 DSGVO. The
// HTTP layer answers with its own error code so the person learns what is
// missing and where to add it.
type EnrollmentPrivacyNoticeError struct {
	Key     string
	Missing EnrollmentPrivacyNoticeGap
}

func (e *EnrollmentPrivacyNoticeError) Error() string {
	return fmt.Sprintf("invalid value for setting %s: the enrollment privacy notice is missing (%s)", e.Key, e.Missing)
}

// Unwrap keeps the rejection an invalid value (400) for every caller.
func (e *EnrollmentPrivacyNoticeError) Unwrap() error {
	return ErrInvalidValue
}
