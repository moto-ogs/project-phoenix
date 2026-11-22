package application

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The deviation of a family goes when its contract is deleted, so it hangs
// on the family's contract that runs today and ends last, whichever
// contract the office saved through (#7770).
func TestDeviationHangsOnTheLongestRunningContract(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2027, 1, 10)
	start, windowEnd := calendar.NewDate(2026, 1, 10), calendar.NewDate(2031, 1, 9)
	ended := familyContract{id: 1, from: start, until: calendar.NewDate(2026, 7, 31)}
	running := familyContract{id: 2, from: start, until: calendar.NewDate(2027, 7, 31)}
	longer := familyContract{id: 3, from: start, until: calendar.NewDate(2028, 7, 31)}
	lastDay := familyContract{id: 4, from: start, until: today}
	later := familyContract{id: 5, from: calendar.NewDate(2027, 8, 1), until: windowEnd}
	open6 := familyContract{id: 6, from: start, until: windowEnd}
	open7 := familyContract{id: 7, from: start, until: windowEnd}
	for name, c := range map[string]struct {
		contracts   []familyContract
		saved, held int64
		want        int64
	}{
		"saved through an ended sibling":                       {[]familyContract{ended, running}, 1, 0, 2},
		"the longer of two running contracts":                  {[]familyContract{running, longer}, 2, 2, 3},
		"the last day still runs":                              {[]familyContract{ended, lastDay}, 1, 1, 4},
		"a contract that only starts later does not count":     {[]familyContract{running, later}, 2, 0, 2},
		"equal ends: the one saved through":                    {[]familyContract{open6, open7}, 7, 6, 7},
		"equal ends: else the one it hangs on":                 {[]familyContract{open6, open7, ended}, 1, 7, 7},
		"equal ends: else the first":                           {[]familyContract{open6, open7, ended}, 1, 0, 6},
		"none runs, saved through one that starts later":       {[]familyContract{ended, later}, 5, 1, 5},
		"none runs: stays where it hangs":                      {[]familyContract{ended}, 9, 1, 1},
		"none runs, saved through another one, nothing stored": {[]familyContract{ended}, 9, 0, 9},
		"none runs and nothing stored: the one saved through":  {[]familyContract{ended}, 1, 0, 1},
	} {
		assert.Equal(t, c.want, bindingContractOf(c.contracts, c.saved, c.held, today), name)
	}
}
