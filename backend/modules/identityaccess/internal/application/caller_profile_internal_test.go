package application

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// A failed person lookup is no missing person: the profile read fails instead
// of answering readstate.Absent, and a save fails instead of being refused as
// changed since it was read (ADR 0311).
func TestProfileKeepsAFailedPersonLookupApartFromNoPerson(t *testing.T) {
	t.Parallel()
	lookup := errors.New("connection reset")
	harness := newCallerHarness(authenticatedCaller(false))
	harness.people = &callerTestPeople{err: lookup}
	caller := harness.build(t)
	ctx := context.Background()

	_, err := caller.Profile(ctx)
	require.ErrorIs(t, err, lookup)

	name := "Neu"
	_, err = caller.UpdateProfile(ctx, domain.CallerProfileUpdate{FirstName: &name, ExpectedVersion: "2026-11-24T08:00:00Z"})
	require.ErrorIs(t, err, lookup)
	assert.NotErrorIs(t, err, readstate.ErrChanged)
}

func TestProfileOfAnAccountWithoutPersonIsAbsent(t *testing.T) {
	t.Parallel()
	harness := newCallerHarness(authenticatedCaller(false))
	harness.people = &callerTestPeople{}
	caller := harness.build(t)

	profile, err := caller.Profile(context.Background())
	require.NoError(t, err)
	assert.Nil(t, profile.Person)
}
