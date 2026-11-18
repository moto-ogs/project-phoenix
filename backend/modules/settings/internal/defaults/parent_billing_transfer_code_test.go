package defaults

import (
	"testing"

	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestTransferCodeSwitchIsOnByDefault holds the decision of #5624: every
// Träger prints the GiroCode until it switches it off, so the letters keep
// what #7266 printed. Only the Träger sets it, with the right Einstellungen,
// on the page of the letterhead.
func TestTransferCodeSwitchIsOnByDefault(t *testing.T) {
	t.Parallel()
	definition := config.DefaultRegistry().GetDefinition(config.KeyParentBillingPrintTransferQR)
	require.NotNil(t, definition)
	assert.Equal(t, config.FieldBoolean, definition.Type)
	assert.Equal(t, true, definition.Default)
	assert.Equal(t, config.LevelTraeger, definition.Levels)
	assert.Equal(t, "config:manage", definition.WritePermission)
	assert.Equal(t, "branding", definition.Tab, "the switch stands on the Briefkopf page")
}
