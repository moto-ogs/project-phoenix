package application

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/ports"
)

// DisplayPreferenceStore reads and writes the display preferences on the
// holder's own row: auth.accounts for an account, platform.operators for an
// operator. found=false when the row is gone or, for an account, erased.
type DisplayPreferenceStore interface {
	FindMoreContrast(ctx context.Context, operator bool, id int64) (moreContrast *bool, found bool, err error)
	// SetMoreContrast writes the choice and returns the value as stored.
	SetMoreContrast(ctx context.Context, operator bool, id int64, moreContrast bool) (stored *bool, found bool, err error)
}

// DisplayPreferences serves identityaccess.AccountDisplayPreferences over
// the global identity unit: the preference belongs to the person, not to a
// school, so like the analytics consent it runs administratively and joins a
// caller's transaction (globalIdentityRead).
type DisplayPreferences struct {
	store   DisplayPreferenceStore
	runtime ports.Runtime
}

var errDisplayPreferenceHolder = errors.New("identity access display preferences: the holder needs an ID")

// NewDisplayPreferences composes the preferences over their store and the
// tenant runtime whose administrative unit they run on.
func NewDisplayPreferences(store DisplayPreferenceStore, runtime ports.Runtime) *DisplayPreferences {
	if store == nil || runtime == nil {
		panic("identity access: display preferences require all dependencies")
	}
	return &DisplayPreferences{store: store, runtime: runtime}
}

// FindDisplayPreferences reads the holder's own preferences; an undecided
// holder reports a nil MoreContrast.
func (p *DisplayPreferences) FindDisplayPreferences(ctx context.Context, holder identityaccess.DisplayPreferenceHolder) (identityaccess.DisplayPreferences, error) {
	if holder.ID <= 0 {
		return identityaccess.DisplayPreferences{}, errDisplayPreferenceHolder
	}
	var result identityaccess.DisplayPreferences
	err := globalIdentityRead(ctx, p.runtime, func(txCtx context.Context) error {
		value, found, err := p.store.FindMoreContrast(txCtx, holder.Operator, holder.ID)
		result.MoreContrast = value
		return holderOutcome(holder, found, err)
	})
	if err != nil {
		return identityaccess.DisplayPreferences{}, err
	}
	return result, nil
}

// SetMoreContrast records the holder's choice and returns it as stored, so
// the caller confirms what was persisted.
func (p *DisplayPreferences) SetMoreContrast(ctx context.Context, holder identityaccess.DisplayPreferenceHolder, moreContrast bool) (identityaccess.DisplayPreferences, error) {
	if holder.ID <= 0 {
		return identityaccess.DisplayPreferences{}, errDisplayPreferenceHolder
	}
	var result identityaccess.DisplayPreferences
	err := globalIdentityRead(ctx, p.runtime, func(txCtx context.Context) error {
		stored, found, err := p.store.SetMoreContrast(txCtx, holder.Operator, holder.ID, moreContrast)
		result.MoreContrast = stored
		return holderOutcome(holder, found, err)
	})
	if err != nil {
		return identityaccess.DisplayPreferences{}, err
	}
	return result, nil
}

// holderOutcome reports a missing row with the public sentinel of its kind.
func holderOutcome(holder identityaccess.DisplayPreferenceHolder, found bool, err error) error {
	switch {
	case err != nil:
		return err
	case found:
		return nil
	case holder.Operator:
		return identityaccess.ErrOperatorNotFound
	default:
		return identityaccess.ErrAccountNotFound
	}
}
