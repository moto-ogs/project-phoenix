package application

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
)

// TestSplitWithoutCarePlaceKeepsChildrenInTheirClassPeriod lists a child
// without an OGS place (#4803 review) only on days it belongs to its class:
// from its start, up to its enrollment end, a graduate only with a dated end.
func TestSplitWithoutCarePlaceKeepsChildrenInTheirClassPeriod(t *testing.T) {
	t.Parallel()
	until := calendar.Date("2026-09-08")
	students := []*RosterStudent{
		{ID: 1},
		{ID: 2, WithoutCarePlace: true, MemberFrom: "2026-09-09"},
		{ID: 3, WithoutCarePlace: true, MemberFrom: "2026-08-01", MemberUntil: &until},
		{ID: 4, WithoutCarePlace: true, Departed: true, MemberFrom: "2026-08-01"},
		{ID: 5, WithoutCarePlace: true, Departed: true, MemberFrom: "2026-08-01", MemberUntil: &until},
	}
	ids := func(day calendar.Date) []int64 {
		care, withoutPlace := splitWithoutCarePlace(append([]*RosterStudent(nil), students...), day)
		assert.Len(t, care, 1)
		result := []int64{}
		for _, student := range withoutPlace {
			result = append(result, student.ID)
		}
		return result
	}

	assert.Equal(t, []int64{3, 5}, ids("2026-09-08"), "before the new child, up to the end of the others")
	assert.Equal(t, []int64{2}, ids("2026-09-09"), "the new child from its first day, the others gone")
}

// TestSplitWithoutCarePlaceKeepsTheClassTimeBeforeCare lists a child with an
// OGS place on the days before its care started as a class member (#4803
// review): its class-list entry, or its time without a place, stood for it
// then; from its care start it passes the care participation.
func TestSplitWithoutCarePlaceKeepsTheClassTimeBeforeCare(t *testing.T) {
	t.Parallel()
	from, until := calendar.Date("2026-09-01"), calendar.Date("2027-01-31")
	student := &RosterStudent{ID: 7, ClassTimeFrom: &from, ClassTimeUntil: &until}

	care, withoutPlace := splitWithoutCarePlace([]*RosterStudent{student}, "2026-12-01")
	assert.Empty(t, care)
	assert.Equal(t, []*RosterStudent{student}, withoutPlace, "a class member before its care starts")

	care, withoutPlace = splitWithoutCarePlace([]*RosterStudent{student}, "2027-02-01")
	assert.Equal(t, []*RosterStudent{student}, care, "from its care start it is a care candidate")
	assert.Empty(t, withoutPlace)

	care, withoutPlace = splitWithoutCarePlace([]*RosterStudent{student}, "2026-08-31")
	assert.Equal(t, []*RosterStudent{student}, care)
	assert.Empty(t, withoutPlace, "not before its class time")
}
