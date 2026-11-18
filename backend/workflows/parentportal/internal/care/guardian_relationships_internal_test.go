package care

import (
	"errors"
	"testing"
)

// TestRelationshipEditWithoutCarePlaceStillRevokesPickup lets the family of
// a child without an OGS place (#4803) take back a pickup right and clear a
// pickup note; only granting one needs an OGS place.
func TestRelationshipEditWithoutCarePlaceStillRevokesPickup(t *testing.T) {
	t.Parallel()
	child := &Child{WithoutCarePlace: true}
	yes, no := true, false
	empty, note := "", "Oma holt ab"

	for name, input := range map[string]GuardianRelationshipInput{
		"revoke pickup": {CanPickup: &no},
		"clear note":    {PickupNotes: &empty},
		"emergency":     {IsEmergencyContact: &yes},
	} {
		if err := relationshipEditAllowed(child, input); err != nil {
			t.Errorf("%s: refused with %v", name, err)
		}
	}
	for name, input := range map[string]GuardianRelationshipInput{
		"grant pickup": {CanPickup: &yes},
		"write note":   {PickupNotes: &note},
	} {
		if err := relationshipEditAllowed(child, input); !errors.Is(err, ErrChildWithoutCarePlace) {
			t.Errorf("%s: got %v, want ErrChildWithoutCarePlace", name, err)
		}
	}
}
