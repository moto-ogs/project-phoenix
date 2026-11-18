package peopledirectory

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
)

// TestClassTimeBeforeCareBelongsToItsClass keeps the class time a child with
// an OGS place had before its care (#4803) only while it is still in that
// class: a later class change, by whatever write, ends it.
func TestClassTimeBeforeCareBelongsToItsClass(t *testing.T) {
	t.Parallel()
	since, care := calendar.Date("2026-09-01"), calendar.Date("2027-02-01")
	child := &StudentState{SchoolClass: "1c", FirstCareFrom: &care, ClassMemberSince: &since, ClassMemberClass: " 1C "}

	from, until, ok := child.ClassTimeBeforeCare()
	assert.True(t, ok)
	assert.Equal(t, since, from)
	assert.Equal(t, calendar.Date("2027-01-31"), until)

	moved := *child
	moved.SchoolClass = "2c"
	_, _, ok = moved.ClassTimeBeforeCare()
	assert.False(t, ok, "a class change ends the kept class time")

	without := *child
	without.WithoutCarePlace = true
	_, _, ok = without.ClassTimeBeforeCare()
	assert.False(t, ok, "a child without a place has its own class time")

	early := *child
	early.FirstCareFrom = &since
	_, _, ok = early.ClassTimeBeforeCare()
	assert.False(t, ok, "no class time when care started with it")
}
