package behavior_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// passkeyCeremonyOwnerClock is far ahead of the real day. go-webauthn stamps
// and checks a ceremony's expiry on the real clock, so the owner's clock
// must not decide whether a ceremony is still open (ADR 0261).
func passkeyCeremonyOwnerClock() time.Time {
	return time.Date(2030, time.March, 4, 9, 0, 0, 0, time.UTC)
}

func TestAccountPasskeyCeremoniesCompleteWhileTheOwnerClockIsFarFromTheRealDay(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	scene := newAccountPasskeySceneAt(t, db, passkeyCeremonyOwnerClock)
	account := scene.member(t)

	authenticator, registered := scene.register(t, account, "Laptop")
	require.NotEmpty(t, registered.ID)

	result, err := scene.login(context.Background(), t, authenticator)
	require.NoError(t, err)
	assert.NotEmpty(t, result.AccessToken)
	assert.NotEmpty(t, result.RefreshToken)
}

func TestOperatorPasskeyCeremoniesCompleteWhileTheOwnerClockIsFarFromTheRealDay(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	scene := newOperatorPasskeySceneAt(t, db, passkeyCeremonyOwnerClock)
	operator := scene.operator(t)

	authenticator, registered := scene.register(t, operator, "Laptop")
	require.NotEmpty(t, registered.ID)

	result, err := scene.login(context.Background(), t, authenticator)
	require.NoError(t, err)
	assert.NotEmpty(t, result.AccessToken)
	assert.NotEmpty(t, result.RefreshToken)
}
