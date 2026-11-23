package application

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// A form write without the token of the form it filled proves nothing and
// is refused like an outdated one (ADR 0311 point 3), also for a Basis form.
func TestCheckFilledInFormRefusesAMissingToken(t *testing.T) {
	t.Parallel()
	blocks := []enrollment.LegalBlock{{Key: enrollment.ConsentKeyDataProcessing, Text: "Datenschutz"}}
	require.ErrorIs(t, checkFilledInForm("", nil, blocks), readstate.ErrChanged)
	require.ErrorIs(t, checkFilledInForm("0", nil, blocks), readstate.ErrChanged)
	require.NoError(t, checkFilledInForm(enrollment.FormTermsFingerprint(nil, blocks), nil, blocks))
}
