package devicefleet

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// lockedEditFleet answers the unlocked read with the snapshot an edit saw
// before a concurrent rename committed, and the locked read with the row as
// stored now.
type lockedEditFleet struct {
	Capability
	snapshot, stored Device
	edits            int
}

func (f *lockedEditFleet) FindDevice(context.Context, int64) (Device, error) { return f.snapshot, nil }

func (f *lockedEditFleet) FindDeviceForUpdate(context.Context, int64) (Device, error) {
	return f.stored, nil
}

func (f *lockedEditFleet) ApplyDeviceEdit(_ context.Context, edit DeviceEdit) (Device, error) {
	f.edits++
	return Device{ID: edit.ID, DeviceID: edit.DeviceID, DeviceType: edit.DeviceType, Name: edit.Name}, nil
}

// TestUpdateDeviceChecksTheReadStateUnderItsOwnLock locks ADR 0311 in the
// owner: the check reads the device under its row lock, so an edit of an
// older read is refused even when the caller took no lock first.
func TestUpdateDeviceChecksTheReadStateUnderItsOwnLock(t *testing.T) {
	t.Parallel()
	oldName, newName := "Eingang", "Mensa"
	fleet := &lockedEditFleet{
		snapshot: Device{ID: 4, DeviceID: "dev-4", DeviceType: "terminal", Name: &oldName},
		stored:   Device{ID: 4, DeviceID: "dev-4", DeviceType: "terminal", Name: &newName},
	}
	admin := NewAdministration(fleet, time.Now)
	edited := "Foyer"

	err := admin.UpdateDevice(context.Background(), &Device{ID: 4, DeviceID: "dev-4", DeviceType: "terminal", Name: &edited}, DeviceVersion(&fleet.snapshot))
	if !errors.Is(err, readstate.ErrChanged) {
		t.Fatalf("edit of an older read: got %v, want readstate.ErrChanged", err)
	}
	if fleet.edits != 0 {
		t.Fatalf("a refused edit wrote %d times", fleet.edits)
	}

	if err := admin.UpdateDevice(context.Background(), &Device{ID: 4, DeviceID: "dev-4", DeviceType: "terminal", Name: &edited}, DeviceVersion(&fleet.stored)); err != nil {
		t.Fatalf("edit of the stored state: %v", err)
	}
	if fleet.edits != 1 {
		t.Fatalf("the current edit wrote %d times, want 1", fleet.edits)
	}
}
