package application

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type signingScopeStore struct {
	ContractStore
	versions []carecontract.Version
}

func (s signingScopeStore) Versions(context.Context, int64, int64) ([]carecontract.Version, error) {
	return s.versions, nil
}

func TestSignedVersionKeepsItsScopeFromTheStoredHistory(t *testing.T) {
	t.Parallel()
	for _, status := range []string{carecontract.VersionRequested, carecontract.VersionOvertaken, carecontract.VersionRejected, carecontract.VersionEffective, carecontract.VersionSuperseded, carecontract.VersionReplaced} {
		t.Run(status, func(t *testing.T) {
			t.Parallel()
			s := Signatures{store: signingScopeStore{versions: []carecontract.Version{{Number: 1, Status: status}}}}
			record := ContractRecord{Version: carecontract.Version{Number: 2, Status: carecontract.VersionEffective}}
			previous, amendment, err := s.previousVersion(context.Background(), 1, record)
			require.NoError(t, err)
			assert.Nil(t, previous, "a signed page no longer compares versions")
			assert.Equal(t, status == carecontract.VersionEffective || status == carecontract.VersionSuperseded || status == carecontract.VersionReplaced, amendment)
		})
	}
}
