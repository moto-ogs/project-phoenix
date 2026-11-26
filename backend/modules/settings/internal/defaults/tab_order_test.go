package defaults

import (
	"slices"
	"sort"
	"testing"

	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/stretchr/testify/assert"
)

// #8153: every area of the registry has a fixed place in TabOrder. An area
// without one used to be appended alphabetically by its key, so „Sicherheit“
// landed between the areas of the Träger and „Betreuungsverträge“ (key
// `vertraege`) after it.
func TestEveryTabHasAFixedPlace(t *testing.T) {
	t.Parallel()

	used := make(map[string]bool)
	for _, def := range config.DefaultRegistry().AllDefinitions() {
		used[def.Tab] = true
	}

	var unplaced []string
	for tab := range used {
		if !slices.Contains(config.TabOrder, tab) {
			unplaced = append(unplaced, tab)
		}
	}
	sort.Strings(unplaced)
	assert.Empty(t, unplaced, "add these areas to records.TabOrder")

	var unused []string
	for _, tab := range config.TabOrder {
		if !used[tab] {
			unused = append(unused, tab)
		}
	}
	assert.Empty(t, unused, "records.TabOrder names areas no setting uses")

	seen := make(map[string]bool)
	for _, tab := range config.TabOrder {
		assert.False(t, seen[tab], "records.TabOrder names %q twice", tab)
		seen[tab] = true
	}
}

// The school's own areas come first, the areas of the Träger follow as one
// block (#8153).
func TestTabOrderKeepsTheTraegerAreasTogether(t *testing.T) {
	t.Parallel()

	assert.Equal(t, []string{
		"operations", "meals", "reminders", "devices", "enrollment",
		"gdpr", "security",
		"system", "modules", "startseite",
		"zustaendigkeiten", "vertraege", "ferien", "monatsbeitrag",
		"abrechnung", "datev", "einsatzplanung", "lohnexport",
		"dashboard", "branding",
	}, config.TabOrder)
}
