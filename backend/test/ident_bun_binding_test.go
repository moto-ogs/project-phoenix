package test

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type identBindingRow struct {
	bun.BaseModel `bun:"table:ident_binding"`

	ID       ident.ID   `bun:"id"`
	ParentID *ident.ID  `bun:"parent_id"`
	Friends  []ident.ID `bun:"friend_ids,array"`
}

// TestIdentIDBindsAsBigint holds that bun binds and scans ident.ID as the
// bigint it is (ADR 0300). bun writes a value whose pointer implements
// json.Marshaler as JSON text ('"42"'), so the type renders its JSON string
// through MarshalText. The row lives in a temporary table of one transaction.
func TestIdentIDBindsAsBigint(t *testing.T) {
	t.Parallel()
	db := SetupTestDB(t)
	ctx := context.Background()

	parent := ident.ID(9223372036854775807)
	row := identBindingRow{ID: 42, ParentID: &parent, Friends: []ident.ID{1, 2}}
	assert.Equal(t, `INSERT INTO "ident_binding" ("id", "parent_id", "friend_ids") VALUES (42, 9223372036854775807, '{1,2}')`,
		db.NewInsert().Model(&row).String())

	tx, err := db.BeginTx(ctx, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = tx.Rollback() })
	_, err = tx.ExecContext(ctx, `CREATE TEMP TABLE ident_binding (id bigint, parent_id bigint, friend_ids bigint[]) ON COMMIT DROP`)
	require.NoError(t, err)
	_, err = tx.NewInsert().Model(&row).Exec(ctx)
	require.NoError(t, err)

	var read identBindingRow
	require.NoError(t, tx.NewSelect().Model(&read).Where("parent_id = ?", &parent).Where("id IN (?)", bun.List([]ident.ID{42, 43})).Scan(ctx))
	assert.Equal(t, row, read)
}
