package application

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/stretchr/testify/require"
)

type crmJobs struct {
	job               domain.DemoCRMJob
	authorized        bool
	claimed, finished bool
	terminal          bool
	next              time.Time
}

func (s *crmJobs) ClaimDemoCRM(context.Context, time.Time) (domain.DemoCRMJob, bool, error) {
	if s.claimed {
		return domain.DemoCRMJob{}, false, nil
	}
	s.claimed = true
	return s.job, true, nil
}
func (s *crmJobs) DemoCRMAuthorized(context.Context, domain.DemoCRMJob, time.Time) (bool, error) {
	return s.authorized, nil
}
func (s *crmJobs) FinishDemoCRM(_ context.Context, _ domain.DemoCRMJob, next time.Time, terminal bool) error {
	s.finished, s.terminal, s.next = true, terminal, next
	return nil
}

type crmProvider struct {
	calls  int
	err    error
	before func()
}

func (p *crmProvider) Sync(context.Context, domain.DemoCRMContact) error {
	if p.before != nil {
		p.before()
	}
	p.calls++
	return p.err
}

type crmThrottle struct{ delay time.Duration }

func (crmThrottle) Error() string                        { return "throttled" }
func (crmThrottle) Retryable() bool                      { return true }
func (e crmThrottle) RetryDelay(time.Time) time.Duration { return e.delay }

func TestDemoCRMWorkerRefusesAnAmbientTransaction(t *testing.T) {
	t.Parallel()
	store, provider := &crmJobs{}, &crmProvider{}
	transactions := CommandTransactions{
		attach:  func(ctx context.Context) context.Context { return ctx },
		current: func(context.Context) (any, bool) { return struct{}{}, true },
	}
	worker := &DemoCRMWorker{Store: store, Provider: provider, Execute: transactions.RunAdmin, Now: time.Now}
	processed, err := worker.RunOnce(t.Context(), 1, 6)
	require.ErrorContains(t, err, "cannot join an ambient transaction")
	require.Zero(t, processed)
	require.False(t, store.claimed)
	require.Zero(t, provider.calls)
}

func TestDemoCRMWorkerChecksConsentRetriesAndErasesCompletedPayloads(t *testing.T) {
	t.Parallel()
	for _, scenario := range []struct {
		name     string
		allowed  bool
		attempt  int
		failure  error
		terminal bool
	}{
		{"sent", true, 1, nil, true},
		{"withdrawn", false, 1, nil, true},
		{"retry", true, 1, errors.New("transport failed"), false},
		{"throttled", true, 1, crmThrottle{3 * time.Hour}, false},
		{"missing retry after", true, 1, crmThrottle{}, false},
		{"exhausted", true, 6, errors.New("transport failed"), true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			t.Parallel()
			now := time.Date(2026, time.November, 20, 18, 0, 0, 0, time.UTC)
			store := &crmJobs{authorized: scenario.allowed, job: domain.DemoCRMJob{Attempts: scenario.attempt}}
			provider := &crmProvider{err: scenario.failure}
			inTx := false
			provider.before = func() { require.False(t, inTx, "provider calls must not hold a database transaction") }
			worker := &DemoCRMWorker{Store: store, Provider: provider, Now: func() time.Time { return now }, Execute: func(ctx context.Context, fn func(context.Context) error) error {
				require.False(t, inTx)
				inTx = true
				err := fn(ctx)
				inTx = false
				return err
			}}
			processed, err := worker.RunOnce(t.Context(), 2, 6)
			if scenario.name == "exhausted" {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
			require.Equal(t, 1, processed)
			require.True(t, store.finished)
			require.Equal(t, scenario.terminal, store.terminal)
			if scenario.allowed {
				require.Equal(t, 1, provider.calls)
			} else {
				require.Zero(t, provider.calls)
			}
			if scenario.name == "throttled" {
				require.Equal(t, now.Add(3*time.Hour), store.next)
			}
			if scenario.name == "missing retry after" {
				require.Equal(t, now.Add(2*time.Minute), store.next)
			}
		})
	}
}

type crmRequestStore struct {
	knownDemoAccessStore
	newAddress bool
}

func (s crmRequestStore) FindActiveDemoAccessByEmail(context.Context, string, time.Time) (domain.DemoAccess, bool, error) {
	return s.known, !s.newAddress, nil
}

type crmRequestSchools struct{ demoRedemptionSchools }

func (crmRequestSchools) PrepareDemoSchool(context.Context, string, string, string) (string, error) {
	return "demo-school", nil
}

type demoCRMRecorder struct {
	calls   int
	started bool
	access  domain.DemoAccess
}

func (r *demoCRMRecorder) QueueDemoCRM(_ context.Context, access domain.DemoAccess, _ time.Time, started bool) error {
	r.calls++
	r.started = started
	r.access = access
	return nil
}

func TestDemoCRMRequestFollowsLeadMailConditions(t *testing.T) {
	t.Parallel()
	for _, scenario := range []struct {
		name                                    string
		previousOptIn, optIn, cooling, disabled bool
		newAddress                              bool
		phone                                   string
		wantMail, wantQueue                     int
	}{
		{name: "new with consent", newAddress: true, optIn: true, wantMail: 1, wantQueue: 1},
		{name: "new without consent drops phone", newAddress: true, phone: " 0211 123456 ", wantMail: 1, wantQueue: 1},
		{name: "opt in", optIn: true, wantMail: 1, wantQueue: 1},
		{name: "withdrawal", previousOptIn: true, wantMail: 1, wantQueue: 1},
		{name: "unchanged consent", previousOptIn: true, optIn: true},
		{name: "callback", previousOptIn: true, optIn: true, phone: " 0211  123456 ", wantMail: 1, wantQueue: 1},
		{name: "no consent drops phone", phone: " 0211 123456 "},
		{name: "cooldown", optIn: true, cooling: true},
		{name: "disabled", optIn: true, disabled: true, wantMail: 1},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			t.Parallel()
			now := time.Date(2026, time.November, 20, 18, 0, 0, 0, time.UTC)
			created := now.Add(-time.Hour)
			if scenario.cooling {
				created = now
			}
			var leads []domain.DemoAccess
			crm := &demoCRMRecorder{}
			deps := DemoAccessDependencies{Now: func() time.Time { return now }, Sessions: demoRedemptionSessions{},
				Store:   crmRequestStore{newAddress: scenario.newAddress, knownDemoAccessStore: knownDemoAccessStore{known: domain.DemoAccess{ContactOptIn: scenario.previousOptIn, CreatedAt: created, ExpiresAt: now.Add(time.Hour), SchoolSlug: "demo-school"}}},
				Schools: crmRequestSchools{demoRedemptionSchools{calls: new([]string), entry: domain.DemoSchoolEntry{Exists: true, Status: domain.DemoSchoolReady}}},
				Tokens:  mintingDemoTokens{}, Mail: recordingDemoMail{leads: &leads},
				AdminTx: func(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) },
			}
			if !scenario.disabled {
				deps.CRM = crm
			}
			flow, err := NewDemoAccess(deps)
			require.NoError(t, err)
			err = flow.Request(t.Context(), domain.DemoAccess{Email: "kim@example.org", FirstName: "Kim", LastName: "Beispiel", SchoolName: "OGS Beispiel", ContactOptIn: scenario.optIn, Phone: scenario.phone}, "127.0.0.1", "https://demo.example/demo#token=")
			require.NoError(t, err)
			require.Len(t, leads, scenario.wantMail)
			require.Equal(t, scenario.wantQueue, crm.calls)
			if crm.calls > 0 {
				require.False(t, crm.started)
				require.Equal(t, now, crm.access.CreatedAt)
				require.Equal(t, scenario.optIn, crm.access.ContactOptIn)
				if !scenario.optIn {
					require.Empty(t, crm.access.Phone)
				}
			}
		})
	}
}

func TestDemoCRMStartsOnlyOnFirstRedeemAndOnlyWhenConfigured(t *testing.T) {
	t.Parallel()
	for _, scenario := range []struct {
		name       string
		uses       int
		configured bool
		expected   int
	}{
		{"first", 0, true, 1}, {"second", 1, true, 0}, {"disabled", 0, false, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			t.Parallel()
			now := time.Date(2026, time.November, 20, 18, 0, 0, 0, time.UTC)
			var calls []string
			crm := &demoCRMRecorder{}
			deps := DemoAccessDependencies{Now: func() time.Time { return now }, Sessions: demoRedemptionSessions{},
				Store:   demoRedemptionStore{calls: &calls, access: domain.DemoAccess{UseCount: scenario.uses, ExpiresAt: now.Add(time.Hour)}},
				Schools: demoRedemptionSchools{calls: &calls, entry: domain.DemoSchoolEntry{Exists: true, Status: domain.DemoSchoolReady, AccountID: now.UnixNano()}},
				Tokens:  demoRedemptionTokens{}, Mail: demoRedemptionMail{}, AdminTx: func(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) }}
			if scenario.configured {
				deps.CRM = crm
			}
			flow, err := NewDemoAccess(deps)
			require.NoError(t, err)
			_, err = flow.Redeem(t.Context(), "test-token", "", "127.0.0.1", "test")
			require.NoError(t, err)
			require.Equal(t, scenario.expected, crm.calls)
			if crm.calls > 0 {
				require.True(t, crm.started)
			}
		})
	}
}
