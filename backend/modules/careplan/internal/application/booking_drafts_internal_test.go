package application

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The Klassenfilter of an offering-sourced Regeltermin (#2482) moved with the
// roster resync from models/activities (#3560).
func TestSourceClassFilterMatches(t *testing.T) {
	t.Parallel()

	if !sourceClassFilterMatches(nil, "") || !sourceClassFilterMatches(nil, "3a") {
		t.Fatal("empty filter must admit every child")
	}
	if !sourceClassFilterMatches([]string{"1b"}, " 1B ") {
		t.Fatal("class matching must ignore case and padding")
	}
	if sourceClassFilterMatches([]string{"1b"}, "1a") {
		t.Fatal("class 1a must not match filter [1b]")
	}
	if sourceClassFilterMatches([]string{"1b"}, "") {
		t.Fatal("a child without a school class must not match a set filter")
	}
}

func TestGradeFilterMatches(t *testing.T) {
	t.Parallel()

	grade := int16(3)
	if !gradeFilterMatches(nil, nil) || !gradeFilterMatches(nil, &grade) {
		t.Fatal("empty filter must admit every child")
	}
	if !gradeFilterMatches([]int{2, 3}, &grade) {
		t.Fatal("grade 3 must match filter [2 3]")
	}
	if gradeFilterMatches([]int{2}, &grade) {
		t.Fatal("grade 3 must not match filter [2]")
	}
	if gradeFilterMatches([]int{3}, nil) {
		t.Fatal("a child without a derivable grade must not match a set filter")
	}
}

// The legacy links of one activity group are cut into rows where one of them
// ends (#7908): the order of the links decides nothing, links that end
// together or run to the end of the phase share one row, a group without
// weekdays (allWeekdays) needs no cut, and a link that ended before the
// phase plans nothing.
func TestLegacyLinkRowsCutWhereALinkEnds(t *testing.T) {
	t.Parallel()

	phase := careplan.OfferingPhase{ServiceStart: calendar.NewDate(2026, 9, 1), ServiceEnd: calendar.NewDate(2027, 7, 31)}
	february, phaseEnd, before := calendar.NewDate(2027, 2, 1), calendar.NewDate(2027, 8, 1), calendar.NewDate(2026, 8, 1)
	link := func(until *calendar.Date, weekdays ...int) *careEnrollmentDraft {
		draft := &careEnrollmentDraft{activityGroupID: 40, selectedWeekday: map[int]bool{}, validUntil: until, allWeekdays: len(weekdays) == 0}
		for _, weekday := range weekdays {
			draft.selectedWeekday[weekday] = true
		}
		return draft
	}
	type span struct {
		weekdays    []int
		from, until calendar.Date
	}
	cut := func(links ...*careEnrollmentDraft) []span {
		spans := []span{}
		for _, row := range legacyLinkRows(links, phase) {
			row := rosterRowFromCareDraft(7, 8, phase, row, nil)
			spans = append(spans, span{row.SelectedWeekdays, row.ValidFrom, *row.ValidUntil})
		}
		return spans
	}

	apart := []span{{[]int{1, 3}, phase.ServiceStart, february}, {[]int{3}, february, phaseEnd}}
	assert.Equal(t, apart, cut(link(&february, 1), link(nil, 3)))
	assert.Equal(t, apart, cut(link(&phaseEnd, 3), link(&february, 1)), "the order of the links decides nothing")
	assert.Equal(t, []span{{[]int{1, 3}, phase.ServiceStart, phaseEnd}}, cut(link(nil, 1), link(nil, 3)), "open links share the phase-wide row")
	assert.Equal(t, []span{{[]int{1, 3}, phase.ServiceStart, february}}, cut(link(&february, 1), link(&february, 3)))
	assert.Equal(t, []span{{nil, phase.ServiceStart, phaseEnd}}, cut(link(&february), link(nil)), "every weekday needs no cut")
	assert.Equal(t, []span{{[]int{3}, phase.ServiceStart, phaseEnd}}, cut(link(&before, 1), link(nil, 3)), "a link that ended before the phase plans nothing")
	assert.Empty(t, cut(link(&before, 1)))
}
