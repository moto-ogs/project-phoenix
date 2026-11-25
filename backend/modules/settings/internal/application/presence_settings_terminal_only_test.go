package config

import (
	"context"
	"errors"
	"testing"

	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// boolSettingsDouble answers the two switches of terminal-only stamping; a
// missing key is a resolution error.
type boolSettingsDouble struct {
	creditSettingsDouble
	values map[string]bool
}

func (d boolSettingsDouble) ResolveBool(_ context.Context, key string) (bool, error) {
	value, ok := d.values[key]
	if !ok {
		return false, errors.New("unreadable " + key)
	}
	return value, nil
}

func TestPresenceSettings_TerminalOnlyStamping(t *testing.T) {
	t.Parallel()
	const (
		rule     = configModels.KeyTimeTrackingTerminalOnlyStamping
		terminal = configModels.KeyModuleNFCAnwesenheit
	)
	cases := map[string]struct {
		values  map[string]bool
		want    bool
		wantErr bool
	}{
		"on with a terminal":            {map[string]bool{rule: true, terminal: true}, true, false},
		"off never reads the module":    {map[string]bool{rule: false}, false, false},
		"on without NFC stays inert":    {map[string]bool{rule: true, terminal: false}, false, false},
		"unreadable switch is an error": {map[string]bool{terminal: true}, false, true},
		"unreadable module is an error": {map[string]bool{rule: true}, false, true},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			got, err := NewPresenceSettings(boolSettingsDouble{values: tc.values}).TerminalOnlyStamping(context.Background())
			if tc.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
			assert.Equal(t, tc.want, got)
		})
	}
}
