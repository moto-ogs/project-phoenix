package application

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// prepareCreate validates a new announcement: the common fields, the shape of
// a class letter (#4800), the poll options and the reminder.
func prepareCreate(ctx context.Context, in *Input, now time.Time) ([]*StaffParentAnnouncementTarget, []*StaffParentAnnouncementOption, error) {
	targets, err := normalizeInput(in, now)
	if err != nil {
		return nil, nil, err
	}
	if err := normalizeClassLetter(ctx, in, in.Sender, targets); err != nil {
		return nil, nil, err
	}
	options, err := normalizePollOptions(in, now)
	if err != nil {
		return nil, nil, err
	}
	if err := normalizeReminder(in); err != nil {
		return nil, nil, err
	}
	return targets, options, nil
}

// prepareUpdate validates an editable announcement before changing its stored
// fields. A declaration with submissions keeps its delivery mode so its
// status and guardian proof remain reachable.
func (s *service) prepareUpdate(ctx context.Context, a *StaffParentAnnouncement, in *Input) ([]*StaffParentAnnouncementTarget, []*StaffParentAnnouncementOption, error) {
	targets, err := normalizeInput(in, s.now())
	if err != nil {
		return nil, nil, err
	}
	// An edit keeps the stored sender: it never moves a class letter to
	// another class or author name (#4800).
	if err := normalizeClassLetter(ctx, in, classLetterSenderOf(a), targets); err != nil {
		return nil, nil, err
	}
	if err := s.guardDeclarationModeChange(ctx, a, in.DeliveryMode); err != nil {
		return nil, nil, err
	}
	if err := s.guardDeclarationSettingsChange(ctx, a, in); err != nil {
		return nil, nil, err
	}
	options, err := normalizePollOptions(in, s.now())
	if err != nil {
		return nil, nil, err
	}
	if err := normalizeReminder(in); err != nil {
		return nil, nil, err
	}
	return targets, options, nil
}

// lockAsRead loads an announcement under its row lock for a write of the
// caller, which may change it, and refuses it unless it is the state the
// author read: expectedVersion is the token of its updated_at (ADR 0311).
// Not found and a foreign class letter refuse before the token is compared.
func (s *service) lockAsRead(ctx context.Context, id int64, expectedVersion, operation string) (*StaffParentAnnouncement, error) {
	a, err := s.repo.FindByIDForUpdate(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("announcement: load for %s: %w", operation, err)
	}
	if a == nil {
		return nil, ErrNotFound
	}
	if err := guardClassLetterWrite(ctx, a); err != nil {
		return nil, err
	}
	if err := readstate.Check(expectedVersion, readstate.Of(a.UpdatedAt)); err != nil {
		return nil, err
	}
	return a, nil
}
