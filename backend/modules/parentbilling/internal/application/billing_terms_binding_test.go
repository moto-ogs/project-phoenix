package application

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The deviation of a family goes when its contract is deleted, so it hangs
// on the family's contract that runs longest, whichever contract the office
// saved through (#7770).
func TestDeviationHangsOnTheLongestRunningContract(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2027, 1, 10)
	ended := familyContract{id: 1, until: calendar.NewDate(2026, 7, 31)}
	running := familyContract{id: 2, until: calendar.NewDate(2027, 7, 31)}
	longer := familyContract{id: 3, until: calendar.NewDate(2028, 7, 31)}
	lastDay := familyContract{id: 4, until: today}
	for name, c := range map[string]struct {
		contracts   []familyContract
		saved, held int64
		want        int64
	}{
		"saved through an ended sibling":                      {[]familyContract{ended, running}, 1, 0, 2},
		"the longer of two running contracts":                 {[]familyContract{running, longer}, 2, 2, 3},
		"the last day still runs":                             {[]familyContract{ended, lastDay}, 1, 1, 4},
		"a sent contract when none runs":                      {[]familyContract{ended}, 9, 1, 9},
		"none runs: stays where it hangs":                     {[]familyContract{ended, {id: 5, until: calendar.NewDate(2026, 12, 31)}}, 5, 1, 1},
		"none runs and nothing stored: the one saved through": {[]familyContract{ended}, 1, 0, 1},
	} {
		assert.Equal(t, c.want, bindingContractOf(c.contracts, c.saved, c.held, today), name)
	}
}
