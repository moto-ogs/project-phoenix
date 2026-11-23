package application

import (
	"testing"

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

// Two offerings of one child name the same roster through their direct link
// (#7760). A draft is one row per child and roster with one end for all its
// weekdays. Bookings that end on the same day end the row there. Bookings
// that end on different days (Monday in February, Wednesday in July) leave
// the row open to the end of the phase, as before #7760: an end taken from
// either booking would be wrong for the weekdays of the other.
func TestLegacyLinksThatShareATemplateEndTheRowOnlyTogether(t *testing.T) {
	t.Parallel()

	segments := []careplan.LinkedSegment{{Group: careplan.LinkedGroup{ID: 40, IsTemplate: true}}}
	february, july := calendar.NewDate(2027, 3, 1), calendar.NewDate(2027, 8, 1)
	draft := func(mondayUntil, wednesdayUntil *calendar.Date) *careEnrollmentDraft {
		drafts := map[int64]*careEnrollmentDraft{}
		for _, link := range []*careplan.BookedOffering{
			{CareOfferingID: 1, SelectedDays: []string{"mon"}, ValidUntil: mondayUntil},
			{CareOfferingID: 2, SelectedDays: []string{"wed"}, ValidUntil: wednesdayUntil},
		} {
			if err := addLegacySegmentDrafts(drafts, segments, link.SelectedDays, link); err != nil {
				t.Fatal(err)
			}
		}
		return drafts[40]
	}

	apart := draft(&february, &july)
	if apart.linkValidUntil != nil {
		t.Fatalf("bookings that end apart must leave the row open, got %s", *apart.linkValidUntil)
	}
	if !apart.selectedWeekday[1] || !apart.selectedWeekday[3] || !apart.legacyOwned {
		t.Fatalf("the row carries the weekdays of both bookings, got %v", apart.selectedWeekday)
	}
	if reversed := draft(&july, &february); reversed.linkValidUntil != nil {
		t.Fatal("the order of the bookings must not decide the end")
	}
	together := draft(&february, &february)
	if together.linkValidUntil == nil || *together.linkValidUntil != february {
		t.Fatal("bookings that end on the same day end the row there")
	}
	if open := draft(&february, nil); open.linkValidUntil != nil {
		t.Fatal("an open booking keeps the row open")
	}
	single := map[int64]*careEnrollmentDraft{}
	if err := addLegacySegmentDrafts(single, segments, []string{"mon"}, &careplan.BookedOffering{CareOfferingID: 1, ValidUntil: &february}); err != nil {
		t.Fatal(err)
	}
	if single[40].linkValidUntil == nil || *single[40].linkValidUntil != february {
		t.Fatal("a single bounded booking ends its row")
	}
}
