package care

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The holiday registrations of a parent account (ADR 0216 points 3 and 9).
// Enrollment keeps the account in the registration's row; the parents
// portal claims the registrations of the account's address at every
// sign-in, lists the account's registrations and opens the document inbox
// of their Träger. The account always comes from the session; a
// registration links no child of a school, so none of this reads or opens
// a record of a school.

// HolidayRegistrationEntryWeek is a booked week of a child: its days, its
// time model and whether it got a place ("placed", "waitlisted" or
// "pending").
type HolidayRegistrationEntryWeek struct {
	FirstDay      calendar.Date
	LastDay       calendar.Date
	TimeModelName string
	Placement     string
	// Lunch says the child eats lunch in the week (#5631).
	Lunch bool
}

// HolidayRegistrationEntryChild is a child of the registration by its first
// name.
type HolidayRegistrationEntryChild struct {
	FirstName string
	Weeks     []HolidayRegistrationEntryWeek
}

// HolidayRegistrationConsent is a voluntary consent of the registration in
// the words the parents gave it with (#8038, ADR 0321): whether it is given
// right now, and when it was given or withdrawn (nil when never given).
type HolidayRegistrationConsent struct {
	Key       string
	Title     string
	Label     string
	Text      string
	Given     bool
	ChangedAt *time.Time
}

// HolidayRegistrationEntry is a holiday registration linked to the account:
// the Träger, the period with its first and last care day (zero without
// weeks), when it came in, its state, the children with their weeks and the
// voluntary consents. No health information, address, contact, last name or
// date of birth.
type HolidayRegistrationEntry struct {
	ID          int64
	TraegerName string
	PeriodName  string
	FirstDay    calendar.Date
	LastDay     calendar.Date
	SubmittedAt time.Time
	Status      string
	Children    []HolidayRegistrationEntryChild
	Consents    []HolidayRegistrationConsent
}

// ErrHolidayRegistrationConsentNotFound reports a registration the account
// does not have, or a consent its form version does not ask.
var ErrHolidayRegistrationConsentNotFound = errors.New("parent: holiday registration consent not found")

// HolidayParentRegistrations is the consumer-owned port over Enrollment's
// registrations of a parent account. Every operation runs in the caller's
// administrative transaction with the account in its filter; the root binds
// it and names the Träger.
type HolidayParentRegistrations interface {
	// ClaimHolidayRegistrations links the registrations without an account
	// that name email, without regard to case, to the account.
	ClaimHolidayRegistrations(ctx context.Context, accountID int64, email string) (int, error)
	// HolidayRegistrationEntries reads the account's registrations, newest
	// first.
	HolidayRegistrationEntries(ctx context.Context, accountID int64) ([]HolidayRegistrationEntry, error)
	// HolidayRegistrationTraeger names the active Träger at which the
	// account has a linked registration.
	HolidayRegistrationTraeger(ctx context.Context, accountID int64) ([]Traeger, error)
	// SetHolidayRegistrationConsent withdraws or gives again a voluntary
	// consent of the account's registration and records the change with
	// the account as its author; found is false without such a
	// registration or consent.
	SetHolidayRegistrationConsent(ctx context.Context, accountID, registrationID int64, key string, given bool) (found bool, err error)
}

// HolidayAccountProofs seals the signed-in account for the prefill of a
// holiday registration's link (ADR 0216 point 2). It reads nothing.
type HolidayAccountProofs interface {
	HolidayParentAccountProof(organizationID, periodID, accountID int64) (string, error)
}

// ClaimHolidayRegistrationsAfterSignIn links the holiday registrations of
// the address a parent just signed in with to the account (ADR 0216 point
// 3). The sign-in proved the address: an account only comes into being
// through a link that went to it. The claim commits in an administrative
// transaction of its own after the sign-in; a failure never undoes the
// sign-in, is logged without the address and is retried at the next one.
func (s *Service) ClaimHolidayRegistrationsAfterSignIn(ctx context.Context, email string) {
	email = strings.TrimSpace(email)
	if s.HolidayRegistrations == nil || s.ParentAccounts == nil || email == "" {
		return
	}
	var accountID int64
	claimed := 0
	err := s.Runtime.WithinAdmin(ctx, func(adminCtx context.Context) error {
		id, found, err := s.ParentAccounts.AccountIDByEmail(adminCtx, email)
		if err != nil || !found {
			return err
		}
		accountID = id
		claimed, err = s.HolidayRegistrations.ClaimHolidayRegistrations(adminCtx, id, email)
		return err
	})
	if err != nil {
		s.Logger.Warn("parent: claim holiday registrations after sign-in failed",
			slog.Int64("account_id", accountID),
			slog.String("error", err.Error()))
		return
	}
	if claimed > 0 {
		s.Logger.Info("parent: holiday registrations claimed",
			slog.Int64("account_id", accountID),
			slog.Int("count", claimed))
	}
}

// HolidayRegistrationEntries reads the holiday registrations linked to the
// account, newest first, in one administrative transaction.
func (s *Service) HolidayRegistrationEntries(ctx context.Context, accountID int64) ([]HolidayRegistrationEntry, error) {
	if s.HolidayRegistrations == nil {
		return nil, errors.New("parent: holiday registration entries are not configured")
	}
	entries := []HolidayRegistrationEntry{}
	err := s.Runtime.WithinAdmin(ctx, func(adminCtx context.Context) error {
		read, err := s.HolidayRegistrations.HolidayRegistrationEntries(adminCtx, accountID)
		if read != nil {
			entries = read
		}
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("parent: holiday registration entries: %w", err)
	}
	return entries, nil
}

// ChangeHolidayRegistrationConsent withdraws (given false) or gives again
// (given true) a voluntary consent of a holiday registration linked to the
// account (#8038, ADR 0321), in one administrative transaction with the
// account in the filter. The parents withdraw as easily as they gave it
// (Art. 7 Abs. 3 DSGVO); the hosting school reads the new state with its
// next read. A registration the account does not have and a consent its
// form version does not ask are ErrHolidayRegistrationConsentNotFound.
func (s *Service) ChangeHolidayRegistrationConsent(ctx context.Context, accountID, registrationID int64, key string, given bool) error {
	if s.HolidayRegistrations == nil {
		return errors.New("parent: holiday registration entries are not configured")
	}
	found := false
	err := s.Runtime.WithinAdmin(ctx, func(adminCtx context.Context) error {
		var err error
		found, err = s.HolidayRegistrations.SetHolidayRegistrationConsent(adminCtx, accountID, registrationID, key, given)
		return err
	})
	if err != nil {
		return fmt.Errorf("parent: change holiday registration consent: %w", err)
	}
	if !found {
		return ErrHolidayRegistrationConsentNotFound
	}
	return nil
}

// withHolidayRegistrationTraeger opens the inbox of an account whose
// relationships open no Träger at the Träger of its linked holiday
// registrations (ADR 0216 point 9): the inbox of an account without a
// school. The address of the documents still has to be the account's.
// An account whose relationships open a Träger reads no further Träger: the
// inbox's statement budget (workflows.parentportal.billing_documents.list)
// leaves no room for the read, and the register only falls.
func (s *Service) withHolidayRegistrationTraeger(ctx context.Context, accountID int64, traeger []Traeger) ([]Traeger, error) {
	if s.HolidayRegistrations == nil || len(traeger) > 0 {
		return traeger, nil
	}
	return s.HolidayRegistrations.HolidayRegistrationTraeger(ctx, accountID)
}
