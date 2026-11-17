package application

import (
	"context"
	"errors"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/stretchr/testify/require"
)

// The orphan sweep deletes only the push links the session liveness answer
// names dead. A failed or incomplete answer deletes nothing (fail closed).
func TestOrphanPushSweepDeletesOnlyLinksAnsweredDead(t *testing.T) {
	t.Parallel()
	links := []identityaccess.PushSubscriptionLink{
		{SubscriptionID: 1, AccountID: 7, TenantID: 3, Portal: "staff", TokenFamilyID: "live"},
		{SubscriptionID: 2, AccountID: 7, TenantID: 3, Portal: "parent"},
	}
	cases := []struct {
		name     string
		liveness map[int64]bool
		err      error
		want     []string
		wantErr  bool
	}{
		{name: "dead link goes, live link stays", liveness: map[int64]bool{1: true, 2: false}, want: []string{"link:2"}},
		{name: "failed answer deletes nothing", err: errors.New("database down"), wantErr: true},
		{name: "partial answer deletes nothing", liveness: map[int64]bool{1: false}, wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			f := newAuthFixture(t)
			f.push.links = links
			f.store.pushLiveness, f.store.pushLivenessErr = tc.liveness, tc.err

			err := f.auth.deleteOrphanedPush(context.Background())

			if tc.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
			require.Equal(t, tc.want, f.push.calls)
		})
	}
}
