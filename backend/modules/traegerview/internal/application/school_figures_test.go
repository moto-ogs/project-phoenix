package application

import (
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCountSickCountsEachRosterChildOnce(t *testing.T) {
	t.Parallel()
	const (
		bothMarks, dayOnly, flagOnly, healthy     int64 = 10, 11, 12, 13
		bothMarksM, dayOnlyM, flagOnlyM, healthyM int64 = 20, 21, 22, 23
		endedCare, endedCareM                     int64 = 14, 24
	)
	roster := map[int64]int64{bothMarks: bothMarksM, dayOnly: dayOnlyM, flagOnly: flagOnlyM, healthy: healthyM}

	assert.Equal(t, 3, countSick(roster, []int64{bothMarks, dayOnly, endedCare}, []int64{bothMarksM, flagOnlyM, endedCareM}, nil))
	assert.Zero(t, countSick(nil, []int64{dayOnly}, []int64{flagOnlyM}, nil))
}

// Place before status (#6371): a checked-in child counts as present only. Its
// sick day or flag is a hint and leaves the sick figure and the sick-rate alert.
func TestSchoolFiguresCountACheckedInSickChildAsPresentOnly(t *testing.T) {
	t.Parallel()
	const (
		sickHome, sickHere, healthyHere    int64 = 10, 11, 12
		sickHomeM, sickHereM, healthyHereM int64 = 20, 21, 22
	)
	roster := map[int64]int64{sickHome: sickHomeM, sickHere: sickHereM, healthyHere: healthyHereM}
	present := []int64{sickHere, healthyHere}

	assert.Equal(t, 1, countSick(roster, []int64{sickHome, sickHere}, nil, present), "sick day")
	assert.Equal(t, 1, countSick(roster, nil, []int64{sickHomeM, sickHereM}, present), "sick flag")
	assert.Equal(t, len(roster), countStudents(roster, present)+countSick(roster, []int64{sickHome, sickHere}, []int64{sickHereM}, present),
		"present and sick name every child once")
}

func TestCountMembersKeepsOnlyTheRoster(t *testing.T) {
	t.Parallel()
	const onSite, away, leaver int64 = 30, 31, 32

	assert.Equal(t, 1, countMembers([]int64{onSite, away}, []int64{onSite, leaver}))
}

func TestSchoolFigureCountsPreserveInputMultiplicity(t *testing.T) {
	t.Parallel()
	roster := map[int64]int64{10: 20, 11: 21}
	present := []int64{10, 10, 99}
	assert.Equal(t, 2, countStudents(roster, present))
	assert.Equal(t, 1, countSick(roster, []int64{10, 11, 11, 99}, []int64{20, 21, 21}, present))
	assert.Equal(t, 2, countMembers([]int64{30, 30}, []int64{30, 30, 99}))
}

func BenchmarkSchoolFigureCounts(b *testing.B) {
	for _, size := range []int{50, 300, 1000} {
		b.Run(strconv.Itoa(size), func(b *testing.B) {
			roster := make(map[int64]int64, size)
			var present, days, flags, staff, onSite []int64
			for i := range size {
				student := int64(17*i + 103)
				membership := student + 100000
				roster[student] = membership
				if i%2 == 0 {
					present = append(present, student)
				}
				if i%13 == 0 {
					days = append(days, student)
				}
				if i%23 == 0 {
					flags = append(flags, membership)
				}
				if i%10 == 0 {
					staff = append(staff, student)
					if i%30 != 0 {
						onSite = append(onSite, student)
					}
				}
			}
			b.ReportAllocs()
			for b.Loop() {
				countStudents(roster, present)
				countSick(roster, days, flags, present)
				countMembers(staff, onSite)
			}
		})
	}
}
