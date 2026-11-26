package application

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// storedAt is the updated_at of a fake row: the table's trigger stamps every
// stored announcement, so no stored row has a zero change time.
var storedAt = time.Date(2026, time.September, 1, 8, 0, 0, 0, time.UTC)

// asStored stamps a fixture the way the database stores it.
func asStored(a *StaffParentAnnouncement) *StaffParentAnnouncement {
	if a != nil && a.UpdatedAt.IsZero() {
		a.UpdatedAt = storedAt
	}
	return a
}

// readVersion is the version the service's own read answers, which a person
// who opened the announcement sends back (ADR 0311). A failed read sends no
// version; the write then reports the failure itself.
func readVersion(ctx context.Context, svc StaffService, id int64) string {
	read, err := svc.Get(ctx, id, communication.ParentAnnouncementHeaderOnly)
	if err != nil {
		return ""
	}
	return readstate.Of(read.UpdatedAt)
}

// publishAsRead publishes the draft as it was read.
func publishAsRead(ctx context.Context, svc StaffService, id int64) (*StaffParentAnnouncement, error) {
	return svc.Publish(ctx, id, readVersion(ctx, svc, id))
}

// updateAsRead edits the announcement as it was read.
func updateAsRead(ctx context.Context, svc StaffService, id int64, in Input) (*StaffParentAnnouncement, error) {
	in.ExpectedVersion = readVersion(ctx, svc, id)
	return svc.Update(ctx, id, in)
}

// updateReminderAsRead changes the reminder of the announcement as read.
func updateReminderAsRead(ctx context.Context, svc StaffService, id int64, in ReminderInput) (*StaffParentAnnouncement, error) {
	in.ExpectedVersion = readVersion(ctx, svc, id)
	return svc.UpdateReminder(ctx, id, in)
}
