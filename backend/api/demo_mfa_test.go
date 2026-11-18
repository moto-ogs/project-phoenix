package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestDemoAdminEnrollsAndSignsInAgainWithoutExternalMail(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	codes := make(chan string, 2)
	// Delivery-only test peer, matching the sidecar wire protocol. No code-read API.
	done := make(chan struct{})
	go func() {
		defer close(done)
		for range 2 {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
			var message struct{ Recipient, Code string }
			if json.NewDecoder(conn).Decode(&message) == nil {
				codes <- message.Code
				_, _ = conn.Write([]byte{1})
			}
			_ = conn.Close()
		}
	}()
	defer func() { _ = listener.Close(); <-done }()
	transport := testpkg.NewCapturingMailer()
	module, err := NewAuthTestModule(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db),
		WithAuthTestMailer(transport.InDemoEnvironmentWithCodeInbox(listener.Addr().String())), WithAuthTestMFABackoff(time.Millisecond))
	require.NoError(t, err)
	password := testpkg.NewTestPassword()
	account := testpkg.CreateTestAccountWithPassword(t, db, fmt.Sprintf("demo-mfa-%d@example.test", testpkg.UniqueSuffix()), password)
	school, slug := testpkg.CreateTestTenant(t, db)
	testpkg.EnsureAccountTenant(t, db, account.ID, school)
	testpkg.GrantTestPermission(t, db, school, account.ID, "config:manage")
	ctx := context.Background()
	login, err := module.Auth.LoginWithMFAGate(ctx, account.Email, password, "", "", slug, "")
	require.NoError(t, err)
	require.Equal(t, identityaccess.LoginStatusMFAEnrollmentRequired, login.Status)

	challenge, err := module.MFA.StartMFAChallenge(ctx, account.ID, school, identityaccess.MFAChallengeScopeTenant, nil, 0)
	require.NoError(t, err, "demo bootstrap must be able to deliver an enrollment code internally")
	code := <-codes
	_, err = module.MFA.VerifyMFACodeForAccount(ctx, account.ID, school, code, identityaccess.MFAChallengeScopeTenant)
	require.NoError(t, err)
	require.NoError(t, enrollMFA(testpkg.TenantContext(school), t, db, module.MFA, account.ID))
	_, _, err = module.Auth.IssueTokensForPasskey(ctx, account.ID, school, "", "")
	require.NoError(t, err)
	// The simulator's next password login still needs a genuine new code.
	login, err = module.Auth.LoginWithMFAGate(ctx, account.Email, password, "", "", slug, "")
	require.NoError(t, err)
	require.Equal(t, identityaccess.LoginStatusMFARequired, login.Status)
	require.NotEqual(t, challenge, login.ChallengeToken)
	code = <-codes
	_, err = module.MFA.VerifyMFAChallenge(ctx, login.ChallengeToken, code)
	require.NoError(t, err)
	_, refresh, err := module.Auth.IssueTokensForPasskey(ctx, account.ID, school, "", "")
	require.NoError(t, err)
	_, _, err = module.Auth.RefreshTokenWithAudit(ctx, refresh, "", "", "")
	require.NoError(t, err)
	require.Empty(t, transport.Messages(), "MFA codes must stay in the internal demo inbox")
}
