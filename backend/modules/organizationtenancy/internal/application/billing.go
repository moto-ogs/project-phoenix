package application

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/ports"
)

// BillingDependencies are the collaborators of the billing report (#2791).
// Every field except Logger is required.
type BillingDependencies struct {
	Transaction ports.Transaction
	Store       ports.BillingStore
	Counts      ports.BillingCounts
	Clock       ports.BillingClock
	// Location is the clock of the school calendar (Europe/Berlin): the key
	// date and the capture hour are read on it.
	Location *time.Location
	Logger   *slog.Logger
}

// Billing implements the operator billing report.
type Billing struct {
	tx       ports.Transaction
	store    ports.BillingStore
	counts   ports.BillingCounts
	clock    ports.BillingClock
	location *time.Location
	logger   *slog.Logger
}

var _ organizationtenancy.BillingReport = (*Billing)(nil)

// NewBilling builds the billing report.
func NewBilling(deps BillingDependencies) (*Billing, error) {
	if deps.Transaction == nil || deps.Store == nil || deps.Counts == nil || deps.Clock == nil || deps.Location == nil {
		return nil, errors.New("organization tenancy billing: all dependencies are required")
	}
	logger := deps.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &Billing{tx: deps.Transaction, store: deps.Store, counts: deps.Counts, clock: deps.Clock, location: deps.Location, logger: logger}, nil
}

// BillingKeyDay reads the key day, the next key date it produces and the
// own days of Träger and schools in one administrative transaction.
func (b *Billing) BillingKeyDay(ctx context.Context) (organizationtenancy.BillingKeyDay, error) {
	var settings domain.BillingSettings
	var overrides []domain.BillingKeyDayOverride
	err := b.tx.RunAdmin(ctx, func(adminCtx context.Context) error {
		var err error
		if settings, err = b.store.BillingSettings(adminCtx); err != nil {
			return err
		}
		overrides, err = b.store.ListBillingKeyDayOverrides(adminCtx)
		return err
	})
	if err != nil {
		return organizationtenancy.BillingKeyDay{}, err
	}
	result := b.keyDay(settings)
	result.Overrides = b.keyDayOverrides(overrides)
	return result, nil
}

// readKeyDay reads the setting and the overrides on the caller's
// transaction.
func (b *Billing) readKeyDay(ctx context.Context) (organizationtenancy.BillingKeyDay, error) {
	settings, err := b.store.BillingSettings(ctx)
	if err != nil {
		return organizationtenancy.BillingKeyDay{}, err
	}
	overrides, err := b.store.ListBillingKeyDayOverrides(ctx)
	if err != nil {
		return organizationtenancy.BillingKeyDay{}, err
	}
	result := b.keyDay(settings)
	result.Overrides = b.keyDayOverrides(overrides)
	return result, nil
}

// SetBillingKeyDay changes the key day of every school or the own day of a
// Träger or a school (#7301) and returns the key day afterwards.
func (b *Billing) SetBillingKeyDay(ctx context.Context, change organizationtenancy.BillingKeyDayChange, operatorID int64) (organizationtenancy.BillingKeyDay, error) {
	if (change.Day == nil && change.Target == nil) || (change.Day != nil && !domain.ValidBillingKeyDay(*change.Day)) {
		return organizationtenancy.BillingKeyDay{}, organizationtenancy.ErrInvalidBillingKeyDay
	}
	var result organizationtenancy.BillingKeyDay
	err := b.tx.RunAdmin(ctx, func(adminCtx context.Context) error {
		if err := b.writeKeyDay(adminCtx, change, operatorID); err != nil {
			return err
		}
		var err error
		result, err = b.readKeyDay(adminCtx)
		return err
	})
	if err != nil {
		return organizationtenancy.BillingKeyDay{}, err
	}
	if change.Target == nil {
		b.logger.Info("billing key day changed",
			"key_day", result.Day,
			"operator_id", operatorID,
		)
	} else {
		b.logger.Info("billing key day override changed",
			"target_id", change.Target.ID,
			"school", change.Target.School,
			"reset", change.Day == nil,
			"operator_id", operatorID,
		)
	}
	return result, nil
}

// writeKeyDay stores the change on the caller's transaction; an own day of a
// Träger or school that is not live is refused.
func (b *Billing) writeKeyDay(ctx context.Context, change organizationtenancy.BillingKeyDayChange, operatorID int64) error {
	if change.Target == nil {
		_, err := b.store.UpdateBillingKeyDay(ctx, *change.Day, operatorID)
		return err
	}
	live, err := b.store.SetBillingKeyDayOverride(ctx, domain.BillingKeyDayTarget(*change.Target), change.Day, operatorID)
	switch {
	case err != nil:
		return err
	case !live && change.Target.School:
		return organizationtenancy.ErrSchoolNotFound
	case !live:
		return organizationtenancy.ErrOrganizationNotFound
	}
	return nil
}

// ListBillingKeyDateCounts reads every captured row.
func (b *Billing) ListBillingKeyDateCounts(ctx context.Context) ([]organizationtenancy.BillingKeyDateCount, error) {
	var counts []domain.BillingKeyDateCount
	err := b.tx.RunAdmin(ctx, func(adminCtx context.Context) error {
		var err error
		counts, err = b.store.ListBillingKeyDateCounts(adminCtx)
		return err
	})
	if err != nil {
		return nil, err
	}
	result := make([]organizationtenancy.BillingKeyDateCount, 0, len(counts))
	for _, count := range counts {
		count.RecordedAt = count.RecordedAt.In(b.location)
		result = append(result, organizationtenancy.BillingKeyDateCount(count))
	}
	return result, nil
}

// RecordDueBillingKeyDates captures every school whose key date of the
// current month is due. Each school has its own key day: its own override,
// else its Träger's, else the day of every school (#7301). The owners' live
// counts are read once, in the same transaction that writes the rows, so all
// schools of one run share one snapshot.
//
// The Worker's commit fence share-locks its lease row as the last statement.
// A lease renewal committed after the snapshot makes that lock fail with a
// serialization conflict (#5715), so the run replays the whole transaction
// on a fresh snapshot. A lost lease is no conflict and still aborts.
func (b *Billing) RecordDueBillingKeyDates(ctx context.Context, now time.Time) (int, error) {
	written := 0
	err := b.tx.RunAdminRetry(ctx, func(adminCtx context.Context) error {
		written = 0
		if err := b.store.UseRepeatableReadSnapshot(adminCtx); err != nil {
			return err
		}
		settings, err := b.store.BillingSettings(adminCtx)
		if err != nil {
			return err
		}
		localNow := now.In(b.location)
		schools, err := b.store.SchoolsMissingBillingPeriod(adminCtx, domain.BillingPeriodOf(localNow))
		if err != nil {
			return err
		}
		due := dueSchools(schools, settings, localNow)
		var captureErr error
		written, captureErr = b.captureSchools(adminCtx, due, localNow)
		return captureErr
	})
	if err != nil {
		return 0, fmt.Errorf("record billing key-date counts: %w", err)
	}
	if written > 0 {
		b.logger.Info("billing key-date counts recorded",
			"rows", written,
		)
	}
	return written, nil
}

// dueSchool is a school with the key date the capture writes for it.
type dueSchool struct {
	domain.BillingSchool
	keyDate string
}

// dueSchools keeps the schools whose own key date of the month is due at
// localNow, was configured before it became capturable and does not lie
// before the school was created.
func dueSchools(schools []domain.BillingSchool, settings domain.BillingSettings, localNow time.Time) []dueSchool {
	due := make([]dueSchool, 0, len(schools))
	for _, school := range schools {
		day, changedAt := domain.EffectiveBillingKeyDay(settings, school.School, school.Organization)
		keyDate, isDue := domain.DueBillingKeyDate(localNow, day)
		if !isDue || !domain.BillingKeyDateWasConfigured(changedAt, localNow, day) || school.CreatedOn > keyDate {
			continue
		}
		due = append(due, dueSchool{BillingSchool: school, keyDate: keyDate})
	}
	return due
}

// SeedBillingKeyDateCounts writes one synthetic current-day snapshot for the
// local demo seeder. Its HTTP entry point is restricted to local seed
// environments, so production records continue to be created only by the
// monthly worker.
//
// The demo process seeds several schools at once, and each seed captures
// every school still missing its row (#5151). The seed therefore reads at
// read committed: a row another seed wrote after this one listed the schools
// is skipped, where a repeatable-read snapshot fails the whole seed and the
// demo school is rebuilt. The synthetic figures need no shared snapshot.
func (b *Billing) SeedBillingKeyDateCounts(ctx context.Context, now time.Time) (int, error) {
	localNow := now.In(b.location)
	keyDate := localNow.Format("2006-01-02")
	written := 0
	err := b.tx.RunAdmin(ctx, func(adminCtx context.Context) error {
		if err := b.store.UseReadCommitted(adminCtx); err != nil {
			return err
		}
		schools, err := b.store.SchoolsMissingBillingPeriod(adminCtx, domain.BillingPeriodOf(localNow))
		if err != nil {
			return err
		}
		due := make([]dueSchool, 0, len(schools))
		for _, school := range schools {
			if school.CreatedOn <= keyDate {
				due = append(due, dueSchool{BillingSchool: school, keyDate: keyDate})
			}
		}
		var captureErr error
		written, captureErr = b.captureSchools(adminCtx, due, localNow)
		return captureErr
	})
	if err != nil {
		return 0, fmt.Errorf("seed billing key-date counts: %w", err)
	}
	return written, nil
}

// captureSchools reads the owners' live counts once and writes one row per
// due school with its own key date.
func (b *Billing) captureSchools(ctx context.Context, schools []dueSchool, capturedAt time.Time) (int, error) {
	if len(schools) == 0 {
		return 0, nil
	}
	students, err := b.counts.CountActiveStudentsByTenant(ctx, capturedAt)
	if err != nil {
		return 0, fmt.Errorf("count active students: %w", err)
	}
	terminals, err := b.counts.CountActiveTerminalsByTenant(ctx)
	if err != nil {
		return 0, fmt.Errorf("count active terminals: %w", err)
	}
	rows := make([]domain.BillingKeyDateCount, 0, len(schools))
	for _, school := range schools {
		rows = append(rows, domain.BillingKeyDateCount{
			SchoolID: school.ID, SchoolName: school.Name, OrganizationName: school.OrganizationName,
			Period: domain.BillingPeriod(school.keyDate), KeyDate: school.keyDate,
			ActiveStudents: students[school.ID], ActiveTerminals: terminals[school.ID],
		})
	}
	return b.store.InsertBillingKeyDateCounts(ctx, rows)
}

func (b *Billing) keyDayOverrides(overrides []domain.BillingKeyDayOverride) []organizationtenancy.BillingKeyDayOverride {
	local := b.clock().In(b.location)
	result := make([]organizationtenancy.BillingKeyDayOverride, 0, len(overrides))
	for _, override := range overrides {
		if override.KeyDay == nil {
			continue
		}
		result = append(result, organizationtenancy.BillingKeyDayOverride{
			OrganizationID: override.OrganizationID, SchoolID: override.SchoolID,
			Name: override.Name, OrganizationName: override.OrganizationName,
			Day: *override.KeyDay, NextKeyDate: domain.NextBillingKeyDate(local, *override.KeyDay),
			UpdatedAt: override.UpdatedAt,
		})
	}
	return result
}

func (b *Billing) keyDay(settings domain.BillingSettings) organizationtenancy.BillingKeyDay {
	local := b.clock().In(b.location)
	return organizationtenancy.BillingKeyDay{
		Day:                 settings.KeyDay,
		NextKeyDate:         domain.NextBillingKeyDate(local, settings.KeyDay),
		UpdatedAt:           settings.UpdatedAt,
		UpdatedByOperatorID: settings.UpdatedByOperatorID,
	}
}
