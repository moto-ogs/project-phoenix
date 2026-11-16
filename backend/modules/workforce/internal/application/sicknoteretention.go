package application

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// SickNoteRetention deletes a school's sick notes (AU-Bescheinigungen) after
// the window the moto team records for the school (#3961). Other staff
// document categories stay until the staff member leaves.
type SickNoteRetention struct {
	store    ports.SickNoteRetentionStore
	settings ports.SickNoteRetentionSettings
	today    func() calendar.Date
}

// NewSickNoteRetention composes the retention over the Berlin day of now.
func NewSickNoteRetention(store ports.SickNoteRetentionStore, settings ports.SickNoteRetentionSettings, now func() time.Time) *SickNoteRetention {
	if store == nil || settings == nil || now == nil {
		panic("workforce application: sick note retention requires its store, settings and clock")
	}
	return &SickNoteRetention{store: store, settings: settings, today: calendar.CalendarDateClock(now)}
}

// DeleteExpiredStaffSickNotes deletes the sick notes uploaded before the first Berlin day
// the window keeps and reports them with the window in days. A window it
// cannot read or outside the configured frame deletes nothing.
func (r *SickNoteRetention) DeleteExpiredStaffSickNotes(ctx context.Context) (deleted, retentionDays int, err error) {
	days, err := r.settings.StaffSickNoteRetentionDays(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("resolve sick note retention window: %w", err)
	}
	if days < domain.MinSickNoteRetentionDays || days > domain.MaxSickNoteRetentionDays {
		return 0, 0, fmt.Errorf("sick note retention window must be between %d and %d days, got %d", domain.MinSickNoteRetentionDays, domain.MaxSickNoteRetentionDays, days)
	}
	cutoff := r.today().AddDays(-days).BerlinMidnight()
	deleted, err = r.store.DeleteStaffSickNotesUploadedBefore(ctx, cutoff)
	if err != nil {
		return 0, 0, err
	}
	return deleted, days, nil
}
