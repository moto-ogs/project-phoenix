package postgres

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The numbers of the children of a family have five writers (#7904, ADR
// 0311): the change and the confirmation of a holiday registration, the
// list of families and the two imports. All of them write through the three
// statements below, and each statement takes the lock of the family's
// numbers first. A save that checks the numbers it read holds that lock, so
// every writer of the same family waits for it; another family does not.

// holdChildNumbers takes the lock of the family's numbers in a Träger
// transaction and keeps it until release is closed.
func holdChildNumbers(t *testing.T, db *bun.DB, organization int64, family string) (release chan struct{}, done <-chan error) {
	t.Helper()
	release, held, finished := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	ctx := testpkg.ContextWithTenantRuntime(context.Background(), testpkg.TenantRuntime(t, db))
	go func() {
		finished <- testpkg.WithinTraeger(ctx, organization, func(ctx context.Context) error {
			if err := NewStore(time.Now).LockChildDebtorNumbers(ctx, organization, []string{family}); err != nil {
				close(held)
				return err
			}
			close(held)
			<-release
			return nil
		})
	}()
	<-held
	return release, finished
}

// writeChildNumbers runs write in a Träger transaction of its own and
// answers its backend and its result.
func writeChildNumbers(t *testing.T, db *bun.DB, organization int64, write func(context.Context, *Store) error) (int64, <-chan error) {
	t.Helper()
	pid, done := make(chan int64, 1), make(chan error, 1)
	ctx := testpkg.ContextWithTenantRuntime(context.Background(), testpkg.TenantRuntime(t, db))
	go func() {
		done <- testpkg.WithinTraeger(ctx, organization, func(ctx context.Context) error {
			tx, err := traegerDB(ctx, organization)
			if err != nil {
				pid <- 0
				return err
			}
			var backend int64
			if err := tx.NewRaw(`SELECT pg_backend_pid()`).Scan(ctx, &backend); err != nil {
				pid <- 0
				return err
			}
			pid <- backend
			return write(ctx, NewStore(time.Now))
		})
	}()
	backend := <-pid
	require.NotZero(t, backend)
	return backend, done
}

func waitsForALock(t *testing.T, db *bun.DB, backend int64) bool {
	t.Helper()
	var waiting bool
	require.NoError(t, db.NewRaw(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = ? AND wait_event_type = 'Lock')`, backend).
		Scan(context.Background(), &waiting))
	return waiting
}

func TestEveryWriterOfAChildNumberWaitsForTheLockOfItsFamily(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	unique := testpkg.UniqueTestTenantID(t)
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Träger Kindernummern Sperre", Slug: fmt.Sprintf("child-number-lock-%d", unique),
	}).ID
	family, other := fmt.Sprintf("familie.%d@example.org", unique), fmt.Sprintf("andere.%d@example.org", unique)
	birth := calendar.NewDate(2018, time.March, 1)
	number := func(email, debtor string) []parentbilling.ChildDebtorNumber {
		return []parentbilling.ChildDebtorNumber{{FamilyEmail: email, ChildFirstName: "Lia", ChildLastName: "Muster", ChildBirthDate: &birth,
			DebtorNumber: debtor, LastUsedOn: calendar.NewDate(2027, time.July, 9)}}
	}
	today := calendar.NewDate(2027, time.June, 1)
	writers := map[string]func(context.Context, *Store) error{
		"save": func(ctx context.Context, s *Store) error {
			_, err := s.SaveChildDebtorNumbers(ctx, organization, 0, number(family, "60101"), today, false)
			return err
		},
		"save only new (imports)": func(ctx context.Context, s *Store) error {
			_, err := s.SaveChildDebtorNumbers(ctx, organization, 0, number(family, "60102"), today, true)
			return err
		},
		"extend": func(ctx context.Context, s *Store) error {
			return s.ExtendChildDebtorNumbers(ctx, organization, number(family, ""))
		},
		"delete": func(ctx context.Context, s *Store) error {
			_, err := s.DeleteChildDebtorNumbers(ctx, organization, 0, parentbilling.FamilyKey(family),
				[]string{parentbilling.ChildKey("Lia", "Muster", &birth)})
			return err
		},
	}
	// One after another: each writer waits for the same family's lock.
	for _, name := range []string{"save", "save only new (imports)", "extend", "delete"} {
		release, held := holdChildNumbers(t, db, organization, family)
		backend, done := writeChildNumbers(t, db, organization, writers[name])
		require.Eventually(t, func() bool { return waitsForALock(t, db, backend) }, 10*time.Second, 5*time.Millisecond,
			"%s waits for the lock of the family's numbers", name)
		close(release)
		require.NoError(t, <-held)
		select {
		case err := <-done:
			require.NoError(t, err, name)
		case <-time.After(10 * time.Second):
			t.Fatalf("%s still waits after the lock was released", name)
		}
	}

	// Another family's numbers do not wait.
	release, held := holdChildNumbers(t, db, organization, family)
	_, done := writeChildNumbers(t, db, organization, func(ctx context.Context, s *Store) error {
		_, err := s.SaveChildDebtorNumbers(ctx, organization, 0, number(other, "60201"), today, false)
		return err
	})
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(10 * time.Second):
		t.Fatal("a write of another family waits for a lock it does not need")
	}
	close(release)
	require.NoError(t, <-held)
}
