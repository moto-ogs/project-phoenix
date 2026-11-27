package postgres

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

type moreContrastRow struct {
	MoreContrast *bool `bun:"more_contrast"`
}

// FindMoreContrast reads the "Mehr Kontrast" choice of a live holder: an
// operator on platform.operators, an account on auth.accounts, where an
// erased account has no preferences left.
func (s *Store) FindMoreContrast(ctx context.Context, operator bool, id int64) (*bool, bool, error) {
	db, err := s.database(ctx)
	if err != nil {
		return nil, false, err
	}
	query := db.NewRaw(`SELECT more_contrast FROM auth.accounts WHERE id = ? AND personal_data_erased_at IS NULL`, id)
	if operator {
		query = db.NewRaw(`SELECT more_contrast FROM platform.operators WHERE id = ?`, id)
	}
	stored, found, err := scanMoreContrast(ctx, query)
	if err != nil {
		return nil, false, fmt.Errorf("identity access postgres: find display preferences: %w", err)
	}
	return stored, found, nil
}

// SetMoreContrast writes the choice of a live holder and returns the stored
// value in the same statement.
func (s *Store) SetMoreContrast(ctx context.Context, operator bool, id int64, moreContrast bool) (*bool, bool, error) {
	db, err := s.database(ctx)
	if err != nil {
		return nil, false, err
	}
	query := db.NewRaw(`UPDATE auth.accounts SET more_contrast = ?
		WHERE id = ? AND personal_data_erased_at IS NULL RETURNING more_contrast`, moreContrast, id)
	if operator {
		query = db.NewRaw(`UPDATE platform.operators SET more_contrast = ? WHERE id = ? RETURNING more_contrast`, moreContrast, id)
	}
	stored, found, err := scanMoreContrast(ctx, query)
	if err != nil {
		return nil, false, fmt.Errorf("identity access postgres: set display preferences: %w", err)
	}
	return stored, found, nil
}

// scanMoreContrast reads the one row a holder's statement matched;
// found=false when it matched none.
func scanMoreContrast(ctx context.Context, query *bun.RawQuery) (*bool, bool, error) {
	var rows []moreContrastRow
	if err := query.Scan(ctx, &rows); err != nil {
		return nil, false, err
	}
	if len(rows) == 0 {
		return nil, false, nil
	}
	return rows[0].MoreContrast, true, nil
}
