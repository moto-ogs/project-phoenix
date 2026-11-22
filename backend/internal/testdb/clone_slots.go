package testdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/uptrace/bun/driver/pgdriver"
)

// Clone slots admit clones to a server whose data directory is a sized tmpfs
// (#7860). Three overlapping local runs asked for 57 clones at once, the
// shared 2560 MB server holds about 43, and a full server failed every run of
// every session. A clone now waits for a slot instead.
//
// The slot count follows from the server: (tmpfs size - cloneSlotReserveMB) /
// cloneSlotSizeMB, 24 on the local 2560 MB server and 94 on CI's 8 GB, where
// twelve package binaries peak near 50 clones and never wait. A server
// without a sized tmpfs is not limited.
const (
	// cloneSlotLockClass is the first key of the two-key advisory locks, a
	// key space of its own beside the one-key lifecycle lock.
	cloneSlotLockClass = int32(914735693)
	// cloneSlotSizeMB is the largest clone measured (47 MB fresh, 81 MB used).
	cloneSlotSizeMB = 80
	// cloneSlotReserveMB covers what lives beside the clones: 482 MB measured
	// (WAL up to max_wal_size, one template, system databases) plus the
	// templates of three more migration states.
	cloneSlotReserveMB = 640
	// shortCloneSlotReserve slots are closed to lasting clones. A binary holds
	// its package clone's slot while its tests wait for short-lived clones;
	// without the reserve, waiting binaries could hold every slot and no test
	// could ever get the clone that lets its binary finish.
	shortCloneSlotReserve = 4
	cloneSlotPoll         = 100 * time.Millisecond
)

// cloneSlots is one binary's slot session: a connection on the maintenance
// database that holds one advisory lock per live clone. The locks die with
// the session, so a killed binary frees its slots at once.
type cloneSlots struct {
	mu       sync.Mutex
	conn     *sql.Conn
	class    int32
	limit    int // 0: the server is not limited
	resolved bool
	held     map[string]int // clone name -> slot
}

// acquire waits for a free slot and records it for the clone name. Lasting
// clones (a package clone, a package template) stay out of the reserve.
func (s *cloneSlots) acquire(ctx context.Context, db *sql.DB, name string, lasting bool) error {
	for {
		got, limit, err := s.try(ctx, db, name, lasting)
		if err != nil {
			return fmt.Errorf("acquire clone slot: %w", err)
		}
		if got {
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait for one of %d clone slots of the test server (ADR 0004): %w", limit, ctx.Err())
		case <-time.After(cloneSlotPoll):
		}
	}
}

func (s *cloneSlots) try(ctx context.Context, db *sql.DB, name string, lasting bool) (bool, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.resolved && s.limit == 0 {
		return true, 0, nil
	}
	// A caller's deadline must not cancel a statement on the slot session:
	// the driver closes a cancelled connection, and its slots with it.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	if s.conn == nil {
		conn, err := db.Conn(ctx)
		if err != nil {
			return false, 0, err
		}
		s.conn, s.held = conn, make(map[string]int)
	}
	if !s.resolved {
		s.limit, s.resolved = serverCloneSlots(ctx, s.conn), true
		if s.limit == 0 {
			s.closeLocked()
			return true, 0, nil
		}
	}
	if _, kept := s.held[name]; kept {
		// A clone whose drop failed kept its slot; its successor reuses it.
		return true, s.limit, nil
	}
	// Short-lived clones start at the reserve, lasting clones at the other end.
	from, to, step := s.limit-1, 0, -1
	if lasting {
		from, to, step = 0, max(s.limit-shortCloneSlotReserve, 1)-1, 1
	}
	mine := make([]string, 0, len(s.held))
	for _, slot := range s.held {
		mine = append(mine, strconv.Itoa(slot))
	}
	// Advisory locks are reentrant per session: CASE keeps the lock function
	// away from the slots this session already holds.
	var slot int
	err := s.conn.QueryRowContext(ctx, `
		SELECT k FROM generate_series($1::int, $2::int, $3::int) AS k
		WHERE CASE WHEN k = ANY(string_to_array($4, ',')::int[]) THEN false
		           ELSE pg_try_advisory_lock($5::int, k) END
		LIMIT 1`, from, to, step, strings.Join(mine, ","), s.class).Scan(&slot)
	if errors.Is(err, sql.ErrNoRows) {
		return false, s.limit, nil
	}
	if err != nil {
		// A lost session lost its slots; the next clone opens a new one.
		s.closeLocked()
		return false, s.limit, err
	}
	s.held[name] = slot
	return true, s.limit, nil
}

// releaseCloneSlot frees the slot of a dropped clone, or of one that was
// never created.
func releaseCloneSlot(s *cloneSlots, name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	slot, ok := s.held[name]
	if !ok {
		return
	}
	delete(s.held, name)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = s.conn.ExecContext(ctx, `SELECT pg_advisory_unlock($1::int, $2::int)`, s.class, slot)
}

func (s *cloneSlots) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closeLocked()
}

func (s *cloneSlots) closeLocked() {
	if s.conn != nil {
		_ = s.conn.Close()
		s.conn, s.held = nil, nil
	}
}

// serverCloneSlots derives the slot count from the server's own storage. Any
// server that does not answer (no Linux, no superuser) is not limited.
func serverCloneSlots(ctx context.Context, conn *sql.Conn) int {
	var dataDir, mountinfo string
	if err := conn.QueryRowContext(ctx,
		`SELECT current_setting('data_directory'), pg_read_file('/proc/self/mountinfo')`).Scan(&dataDir, &mountinfo); err != nil {
		return 0
	}
	sizeMB := tmpfsSizeMB(mountinfo, dataDir)
	if sizeMB == 0 {
		return 0
	}
	return max((sizeMB-cloneSlotReserveMB)/cloneSlotSizeMB, 1)
}

// tmpfsSizeMB returns the size of the tmpfs that holds dir according to a
// /proc/self/mountinfo listing, or 0 when dir is not on a sized tmpfs.
func tmpfsSizeMB(mountinfo, dir string) int {
	deepest, sizeMB := "", 0
	for line := range strings.SplitSeq(mountinfo, "\n") {
		mount, super, ok := strings.Cut(line, " - ")
		fields, filesystem := strings.Fields(mount), strings.Fields(super)
		if !ok || len(fields) < 5 || len(filesystem) < 3 {
			continue
		}
		point := fields[4]
		inside := point == dir || strings.HasPrefix(dir, strings.TrimSuffix(point, "/")+"/")
		if !inside || len(point) < len(deepest) {
			continue
		}
		deepest, sizeMB = point, 0
		if filesystem[0] != "tmpfs" {
			continue
		}
		for option := range strings.SplitSeq(filesystem[2], ",") {
			if kilobytes, found := strings.CutPrefix(option, "size="); found {
				size, _ := strconv.Atoi(strings.TrimSuffix(kilobytes, "k"))
				sizeMB = size / 1024
			}
		}
	}
	return sizeMB
}

// isDiskFull reports PostgreSQL's disk_full (53100): the tmpfs has no room.
func isDiskFull(err error) bool {
	var pgErr pgdriver.Error
	return errors.As(err, &pgErr) && pgErr.Field('C') == "53100"
}

// retryAfterDiskFull runs create again after a disk_full failure, once the
// dead clones are gone. The start GC only tries the lifecycle lock and is
// skipped while others clone; here the full server is the reason to wait.
// It spares no run: a worktree's run ID is stable, so the clones a killed
// earlier run left behind carry this run's prefix.
func (m *Maintenance) retryAfterDiskFull(ctx context.Context, cfg *Config, create func() (*CloneHandle, error)) (*CloneHandle, error) {
	handle, err := create()
	if !isDiskFull(err) {
		return handle, err
	}
	conn, unlock, lockErr := acquireLifecycleLock(ctx, m.db)
	if lockErr != nil {
		return nil, errors.Join(err, lockErr)
	}
	_, gcErr := gcLocked(ctx, conn, cfg.TemplateName())
	unlock()
	if gcErr != nil {
		return nil, errors.Join(err, gcErr)
	}
	return create()
}
