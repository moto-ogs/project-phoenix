package postgres

import (
	context "context"

	domain "github.com/moto-ogs/project-phoenix/modules/exporttransfer/internal/domain"
)

// JournalRetention deletes the journal on the database clock, which stamps
// it and guards the deletion window (ADR 0281).
type JournalRetention struct {
	Journal *Store
}

func (r JournalRetention) DeleteExpiredTransfers(ctx context.Context) (int, int, error) {
	now, err := r.Journal.DatabaseTime(ctx)
	if err != nil {
		return 0, 0, err
	}
	cutoff := domain.JournalRetentionCutoff(now)
	deleted, err := r.Journal.DeleteExpired(ctx, cutoff)
	if err != nil {
		return 0, 0, err
	}
	return deleted, int(now.Sub(cutoff).Hours() / 24), nil
}
