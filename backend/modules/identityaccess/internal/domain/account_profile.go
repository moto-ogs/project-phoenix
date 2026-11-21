package domain

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

type AccountMetadata struct {
	ID            ident.ID
	CreatedAt     time.Time
	UpdatedAt     time.Time
	Email         string
	Username      *string
	Avatar        string
	Active        bool
	IsPasswordOTP bool
	LastLogin     *time.Time
}

type AccountProfile struct {
	Bio      string
	Settings string
}

// AnalyticsConsent is the account's answer to the usage analytics; Granted
// is nil while the account has not decided.
type AnalyticsConsent struct {
	Granted   *bool
	DecidedAt *time.Time
}
