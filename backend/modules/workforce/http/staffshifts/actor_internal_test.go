package staffshifts

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewActorRequiresAStaffRecord(t *testing.T) {
	t.Parallel()
	staffID, accountID := int64(41), int64(73)

	actor, err := NewActor(staffID, &accountID)
	require.NoError(t, err)
	assert.Equal(t, Actor{StaffID: staffID, AccountID: &accountID}, actor)

	for _, missing := range []int64{0, -staffID} {
		_, err := NewActor(missing, &accountID)
		require.ErrorIs(t, err, ErrNoStaffActor)
		assert.EqualError(t, err, "staff record not found")
	}
}

// A person of the Träger-Büro without a staff record writes under its
// account and the mark of the Träger-Büro (#7818); a staff member never
// carries that account into the mark.
func TestTraegerActorPlansUnderItsAccount(t *testing.T) {
	t.Parallel()
	staffID, accountID := int64(41), int64(73)

	actor, err := NewTraegerActor(&accountID)
	require.NoError(t, err)
	assert.Equal(t, Actor{AccountID: &accountID, Traeger: true}, actor)
	assert.Equal(t, accountID, actor.traegerAccountID())

	staff, err := NewActor(staffID, &accountID)
	require.NoError(t, err)
	assert.Zero(t, staff.traegerAccountID(), "a staff member writes as staff, also in a session of the Träger")

	for _, missing := range []*int64{nil, new(int64)} {
		_, err := NewTraegerActor(missing)
		require.Error(t, err)
		assert.NotErrorIs(t, err, ErrNoStaffActor, "a session without an account is the server's failure, not a missing staff record")
	}
}
