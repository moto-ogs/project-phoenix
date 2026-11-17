package compose

import (
	"testing"
	"time"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestRequestShareVisibilityRequiresTheLedgerAndTheFamilyProtection(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	shares := NewParentRequestShareEventRepository(db, time.Now)
	protection := NewFamilyProtectionEventRepository(db, time.Now)
	const message = "parent: request share visibility needs the sharing ledger and the family protection"
	_, err := NewRequestShareVisibility(nil, protection)
	require.EqualError(t, err, message)
	_, err = NewRequestShareVisibility(shares, nil)
	require.EqualError(t, err, message)
}
