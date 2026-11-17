package domain

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
)

// A child without an OGS place (#4803) never takes part in OGS care, not
// even when someone recorded it as present; the administrative child list
// keeps it so the school can maintain it and invite its family. A graduate
// without a place leaves that list as every graduate does.
func TestChildWithoutCarePlaceNeverParticipates(t *testing.T) {
	t.Parallel()
	const (
		withPlace = iota + 1
		withoutPlace
		graduatedWithoutPlace
	)
	students := map[int64]CareStudent{
		withPlace:             {Status: careplan.StudentStatusActive},
		withoutPlace:          {Status: careplan.StudentStatusActive, WithoutCarePlace: true},
		graduatedWithoutPlace: {Status: careplan.StudentStatusAlumnus, WithoutCarePlace: true},
	}
	ids := []int64{withPlace, withoutPlace, graduatedWithoutPlace}
	boundaries := ParticipationBoundaries(students, nil)
	const today calendar.Date = "2026-11-16"

	participating := ParticipatingOn(ids, students, boundaries, today, today, map[int64]bool{withoutPlace: true})
	assert.True(t, participating[withPlace])
	assert.False(t, participating[withoutPlace], "presence does not make a child without a place an OGS child")

	historical := HistoricalParticipationOn(ids, students, boundaries, "2026-11-02", today, map[int64]bool{withoutPlace: true})
	assert.True(t, historical[withPlace])
	assert.False(t, historical[withoutPlace])

	visible := AdministrativelyVisibleOn(ids, students, boundaries, today, today, nil)
	assert.True(t, visible[withPlace])
	assert.True(t, visible[withoutPlace], "the administrative list keeps the child without a place")
	assert.False(t, visible[graduatedWithoutPlace])
}
