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
// block (#8153). An area belongs to the Träger when none of its settings has
// a school level: the school app heads exactly these with „Vom Träger“.
func TestTabOrderPutsTheTraegerAreasLast(t *testing.T) {
	t.Parallel()

	schoolLevel := make(map[string]bool)
	for _, def := range config.DefaultRegistry().AllDefinitions() {
		if def.Levels == config.LevelSchool {
			schoolLevel[def.Tab] = true
		}
	}

	firstTraeger := ""
	var school, traeger []string
	for _, tab := range config.TabOrder {
		if !schoolLevel[tab] {
			if firstTraeger == "" {
				firstTraeger = tab
			}
			traeger = append(traeger, tab)
			continue
		}
		school = append(school, tab)
		assert.Empty(t, firstTraeger,
			"school area %q comes after the Träger area %q", tab, firstTraeger)
	}
	assert.Contains(t, school, "security", "„Sicherheit“ is an area of the school")
	assert.Equal(t, "operations", config.TabOrder[0])
	assert.Equal(t, []string{
		"zustaendigkeiten", "vertraege", "ferien", "monatsbeitrag", "datev",
		"einsatzplanung", "lohnexport", "dashboard", "branding",
	}, traeger)
}
