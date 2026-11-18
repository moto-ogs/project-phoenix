package application

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
)

// A retained write (an approved excused request, an applied master-data
// change) carries the mark of a child without an OGS place, so the
// membership renewal behind it keeps the child without a place (#4803).
func TestStudentWriteFromModelKeepsTheMarkWithoutCarePlace(t *testing.T) {
	t.Parallel()

	for _, without := range []bool{true, false} {
		student := &peopledirectory.StudentState{ID: 7, Status: "active", WithoutCarePlace: without}
		if got := StudentWriteFromModel(student).Record.WithoutCarePlace; got != without {
			t.Fatalf("WithoutCarePlace = %v, want %v", got, without)
		}
	}
}
