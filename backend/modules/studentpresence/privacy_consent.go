package studentpresence

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// ErrInvalidPrivacyConsent reports a consent that violates the retention
// bounds or the acceptance/expiry pairing.
var ErrInvalidPrivacyConsent = errors.New("invalid privacy consent")

// Retention bounds and default of the GDPR visit-data retention consent
// (users.privacy_consents.data_retention_days).
const (
	MinPrivacyConsentRetentionDays     = 1
	MaxPrivacyConsentRetentionDays     = 31
	DefaultPrivacyConsentRetentionDays = 30
)

// PrivacyConsent is one recorded retention consent of a student. Student
// Presence owns the row because it bounds how long presence data is kept.
type PrivacyConsent struct {
	ID, TenantID, StudentID int64
	CreatedAt, UpdatedAt    time.Time
	PolicyVersion           string
	Accepted                bool
	AcceptedAt, ExpiresAt   *time.Time
	DurationDays            *int
	RenewalRequired         bool
	DataRetentionDays       int
	// Details is the recorded JSON document, not a query-filter map.
	Details []byte
}

// PrivacyConsentQuery reads the recorded consents of a student.
type PrivacyConsentQuery interface {
	ListAcceptedRetentionSettings(context.Context) ([]StudentRetentionSetting, error)
	ListPrivacyConsents(context.Context, int64) ([]PrivacyConsent, error)
}

// PrivacyConsentCommand writes consents. RecordPrivacyConsent joins the
// caller's tenant transaction and never rewrites an existing row.
// RevisePrivacyConsent is the edit of a child's consent by staff: it records or
// revises the consent of the saved policy version, bound to the consents the
// editor read (ADR 0311).
type PrivacyConsentCommand interface {
	RevisePrivacyConsent(context.Context, PrivacyConsentRevision) (RevisedPrivacyConsent, error)
	RecordPrivacyConsent(context.Context, PrivacyConsent) (PrivacyConsent, error)
}

// PrivacyConsentRevision is one staff edit of a child's consent. ExpectedVersion
// is the PrivacyConsentVersion of the consents the editor read; a student
// whose consents changed since is refused with readstate.ErrChanged.
type PrivacyConsentRevision struct {
	StudentID         int64
	ExpectedVersion   string
	PolicyVersion     string
	Accepted          bool
	DurationDays      *int
	DataRetentionDays int
	// Details is the JSON document to record.
	Details []byte
}

// RevisedPrivacyConsent is the stored consent and the version of the
// student's consents after the save.
type RevisedPrivacyConsent struct {
	Consent PrivacyConsent
	Version string
}

// PrivacyConsentVersion is the read-state token of a student's recorded
// consents (ADR 0311): which rows exist and when each last changed. A student
// without a recorded consent has a token too, so the first save is bound to
// the school defaults its editor saw being still unrecorded.
func PrivacyConsentVersion(consents []PrivacyConsent) string {
	type state struct {
		ID      int64  `json:"id"`
		Changed string `json:"changed"`
	}
	states := make([]state, 0, len(consents))
	for _, consent := range consents {
		states = append(states, state{ID: consent.ID, Changed: readstate.Of(consent.UpdatedAt)})
	}
	sort.Slice(states, func(i, j int) bool { return states[i].ID < states[j].ID })
	return readstate.Fingerprint(states)
}

// PrivacyConsentBatches records the retention consents of many new students
// at once (#5552, ADR 0067 addendum of 2026-11-08, step 5). It is a leaf
// command (#4538) and stays outside Capability and Owner; the data import
// binds it on its own. Every value is validated like RecordPrivacyConsent,
// the call joins the caller's tenant transaction and writes every consent or
// none, with the columns RecordPrivacyConsent writes.
type PrivacyConsentBatches interface {
	RecordPrivacyConsents(context.Context, []PrivacyConsent) error
}

type StudentRetentionSetting struct {
	StudentID         int64
	DataRetentionDays int
}

// AcceptPrivacyConsent marks a consent accepted at now and derives the expiry
// from the configured duration. It returns the changed value; persisting it is
// the caller's job. This is the consent lifecycle the owner decides, not the
// model (issue #586, Rule 12).
func AcceptPrivacyConsent(value PrivacyConsent, now time.Time) PrivacyConsent {
	value.Accepted = true
	value.AcceptedAt = &now
	return DerivePrivacyConsentExpiry(value)
}

// DerivePrivacyConsentExpiry stamps ExpiresAt = AcceptedAt + DurationDays when
// a positive duration is set and no expiry is present yet.
func DerivePrivacyConsentExpiry(value PrivacyConsent) PrivacyConsent {
	if value.DurationDays == nil || *value.DurationDays <= 0 {
		return value
	}
	if value.ExpiresAt != nil || value.AcceptedAt == nil {
		return value
	}
	expiresAt := value.AcceptedAt.AddDate(0, 0, *value.DurationDays)
	value.ExpiresAt = &expiresAt
	return value
}

// LatestAcceptedPrivacyConsent selects the same effective retention consent for
// the standalone read and the child-detail projection. Newer refusals do not
// replace the latest accepted policy.
func LatestAcceptedPrivacyConsent(consents []PrivacyConsent) *PrivacyConsent {
	var latest *PrivacyConsent
	for i := range consents {
		consent := &consents[i]
		if consent.Accepted && (latest == nil || consent.CreatedAt.After(latest.CreatedAt)) {
			latest = consent
		}
	}
	return latest
}
