package application

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/ports"
)

// checkPasswordLogin runs under the identity row lock. A refusal returns false,
// not an error: the caller must commit its failure counter before answering.
// The verifier performs the normal password work even for missing/locked rows.
func checkPasswordLogin(ctx context.Context, store ports.PasswordLoginStore, passwords ports.PasswordVerifier, policy func() (int, time.Duration, error), id int64, hash, password string, operator bool) (bool, error) {
	threshold, duration, err := policy()
	if err != nil || threshold <= 0 || duration <= 0 {
		return false, errors.New("password login protection policy unavailable")
	}
	var state domain.PasswordLoginState
	if id != 0 {
		state, err = store.LockPasswordLoginState(ctx, id, operator)
		if err != nil {
			return false, err
		}
	}
	valid, verifyErr := passwords.VerifyPassword(password, hash)
	now := time.Now()
	if id == 0 || (state.PasswordLockedUntil != nil && state.PasswordLockedUntil.After(now)) {
		return false, nil
	}
	if verifyErr == nil && valid && hash != "" {
		if state == (domain.PasswordLoginState{}) {
			return true, nil
		}
		return true, store.SavePasswordLoginState(ctx, id, operator, domain.PasswordLoginState{})
	}
	state = currentPasswordFailures(state, now, duration)
	state.PasswordAttempts++
	state.PasswordFailedAt = &now
	if state.PasswordAttempts >= threshold {
		until := now.Add(duration)
		state.PasswordLockedUntil = &until
	}
	return false, store.SavePasswordLoginState(ctx, id, operator, state)
}

// currentPasswordFailures drops what no longer counts: an expired lock and
// failures older than the lock duration start a fresh budget, so mistakes
// spread over weeks never add up to a lock (#7214).
func currentPasswordFailures(state domain.PasswordLoginState, now time.Time, duration time.Duration) domain.PasswordLoginState {
	if state.PasswordLockedUntil != nil || (state.PasswordFailedAt != nil && !state.PasswordFailedAt.Add(duration).After(now)) {
		return domain.PasswordLoginState{}
	}
	return state
}
