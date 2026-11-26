package behavior_test

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	identityCompose "github.com/moto-ogs/project-phoenix/modules/identityaccess/compose"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

// "Mehr Kontrast" belongs to the person: it starts undecided, an account
// keeps it on auth.accounts in every school, an operator on
// platform.operators, and an erased account has none.
func TestAccountDisplayPreferences(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	preferences := identityCompose.NewAccountDisplayPreferences(db, testpkg.NewDatabase(t, db).UnitOfWork())
	ctx := testpkg.Ctx(t)

	account := testpkg.CreateTestAccount(t, db, "display-contrast")
	holder := identityaccess.DisplayPreferenceHolder{ID: account.ID}
	found, err := preferences.FindDisplayPreferences(ctx, holder)
	require.NoError(t, err)
	require.Nil(t, found.MoreContrast, "a new account has not decided")

	stored, err := preferences.SetMoreContrast(ctx, holder, true)
	require.NoError(t, err)
	require.NotNil(t, stored.MoreContrast)
	require.True(t, *stored.MoreContrast)
	stored, err = preferences.SetMoreContrast(ctx, holder, false)
	require.NoError(t, err)
	require.False(t, *stored.MoreContrast, "the latest choice replaces the earlier one")

	other, err := preferences.FindDisplayPreferences(testpkg.OwnCtx(t), holder)
	require.NoError(t, err)
	require.NotNil(t, other.MoreContrast, "the choice holds in every school")
	require.False(t, *other.MoreContrast)

	operator := testpkg.CreateTestOperator(t, db)
	operatorHolder := identityaccess.DisplayPreferenceHolder{Operator: true, ID: operator.ID}
	found, err = preferences.FindDisplayPreferences(ctx, operatorHolder)
	require.NoError(t, err)
	require.Nil(t, found.MoreContrast, "a new operator has not decided")
	stored, err = preferences.SetMoreContrast(ctx, operatorHolder, true)
	require.NoError(t, err)
	require.True(t, *stored.MoreContrast)
	var onOperator *bool
	require.NoError(t, db.NewRaw(`SELECT more_contrast FROM platform.operators WHERE id = ?`, operator.ID).Scan(ctx, &onOperator))
	require.NotNil(t, onOperator, "an operator's choice lives on its own row")
	require.True(t, *onOperator)
	var accountsTouched int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM auth.accounts WHERE id = ? AND more_contrast IS NOT NULL`, operator.ID).Scan(ctx, &accountsTouched))
	require.Zero(t, accountsTouched, "an operator ID never writes the account with the same number")

	_, err = preferences.FindDisplayPreferences(ctx, identityaccess.DisplayPreferenceHolder{Operator: true, ID: operator.ID + 1_000_000})
	require.ErrorIs(t, err, identityaccess.ErrOperatorNotFound)

	erased := testpkg.CreateTestAccount(t, db, "display-contrast-erased")
	_, err = db.NewRaw(`UPDATE auth.accounts SET personal_data_erased_at = NOW() WHERE id = ?`, erased.ID).Exec(ctx)
	require.NoError(t, err)
	erasedHolder := identityaccess.DisplayPreferenceHolder{ID: erased.ID}
	_, err = preferences.FindDisplayPreferences(ctx, erasedHolder)
	require.ErrorIs(t, err, identityaccess.ErrAccountNotFound)
	_, err = preferences.SetMoreContrast(ctx, erasedHolder, true)
	require.ErrorIs(t, err, identityaccess.ErrAccountNotFound)
}
