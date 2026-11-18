package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/devicefleet"
	"github.com/moto-ogs/project-phoenix/modules/devicefleet/internal/domain"
	"github.com/uptrace/bun"
)

// lifecycleEventLimit caps one history read. A device collects a handful of
// entries a year; the cap only guards a runaway caller.
const lifecycleEventLimit = 500

// lifecycleEventRow is this owner's private mapping of
// audit.device_lifecycle_events. It never leaves the adapter.
type lifecycleEventRow struct {
	bun.BaseModel `bun:"table:audit.device_lifecycle_events,alias:event"`

	ID         int64           `bun:"id,pk,autoincrement"`
	TenantID   int64           `bun:"tenant_id,notnull"`
	DeviceID   int64           `bun:"device_id,notnull"`
	Action     string          `bun:"action,notnull"`
	ActorKind  string          `bun:"actor_kind,notnull"`
	AccountID  *int64          `bun:"actor_account_id"`
	Changes    json.RawMessage `bun:"changes,type:jsonb,notnull"`
	OccurredAt time.Time       `bun:"occurred_at,notnull"`
}

// LifecycleEventStore appends and reads the Gerätelebenszyklus. A school
// request carries its tenant and sees only its own devices, also through
// RLS; an operator's administrative transaction sees every school.
type LifecycleEventStore struct{ database Database }

// NewLifecycleEventStore builds the history adapter over the supplied runtime.
func NewLifecycleEventStore(database Database) *LifecycleEventStore {
	if database == nil {
		panic("devicefleet postgres: database runtime is required")
	}
	return &LifecycleEventStore{database: database}
}

// Insert appends one entry. The school comes from the device row, so an
// operator's entry lands at the device's school. Archived rows count, so a
// removal and a transfer can record themselves; a device the caller cannot
// see reports found=false.
func (s *LifecycleEventStore) Insert(ctx context.Context, input devicefleet.RecordLifecycleEvent, occurredAt time.Time) (bool, domain.OperationStats, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return false, domain.OperationStats{}, err
	}
	changes := input.Changes
	if changes == nil {
		changes = map[string]devicefleet.LifecycleChange{}
	}
	payload, err := json.Marshal(changes)
	if err != nil {
		return false, domain.OperationStats{}, fmt.Errorf("devicefleet postgres: encode lifecycle changes: %w", err)
	}
	var accountID, operatorID *int64
	if input.ActorKind == devicefleet.LifecycleActorOperator {
		operatorID = &input.ActorID
	} else {
		accountID = &input.ActorID
	}
	query := db.NewRaw(`
		INSERT INTO audit.device_lifecycle_events
			(tenant_id, device_id, action, actor_kind, actor_account_id, actor_operator_id, changes, occurred_at)
		SELECT d.tenant_id, d.id, ?, ?, ?, ?, ?::jsonb, ?
		FROM iot.devices AS d
		WHERE d.id = ? AND (? OR d.tenant_id = ?)`,
		string(input.Action), string(input.ActorKind), accountID, operatorID, string(payload), occurredAt,
		input.DeviceRowID, scope.AcrossSchools, scope.TenantID)
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	result, err := query.Exec(ctx)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return false, stats, fmt.Errorf("devicefleet postgres: record device lifecycle event: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, stats, fmt.Errorf("devicefleet postgres: count recorded lifecycle events: %w", err)
	}
	stats.Rows = affected
	return affected == 1, stats, nil
}

// List reads the history of a device and of the devices it was transferred
// from, newest first. found=false when the caller cannot see the device.
func (s *LifecycleEventStore) List(ctx context.Context, deviceRowID int64) ([]devicefleet.LifecycleEvent, bool, domain.OperationStats, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return nil, false, domain.OperationStats{}, err
	}
	stats := domain.OperationStats{Queries: 1}
	var found bool
	started := time.Now()
	err = db.NewRaw(`SELECT EXISTS (SELECT 1 FROM iot.devices AS d WHERE d.id = ? AND (? OR d.tenant_id = ?))`,
		deviceRowID, scope.AcrossSchools, scope.TenantID).Scan(ctx, &found)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return nil, false, stats, fmt.Errorf("devicefleet postgres: find device for lifecycle history: %w", err)
	}
	if !found {
		return nil, false, stats, nil
	}
	var rows []lifecycleEventRow
	stats.Queries++
	started = time.Now()
	// The chain follows transferred_to_device_id backwards: the archived
	// source rows of earlier schools. RLS and the tenant predicate keep a
	// school's read at its own rows.
	err = db.NewRaw(`
		WITH RECURSIVE chain(id) AS (
			SELECT d.id FROM iot.devices AS d WHERE d.id = ?
			UNION
			SELECT d.id FROM iot.devices AS d JOIN chain AS c ON d.transferred_to_device_id = c.id
		)
		SELECT event.id, event.tenant_id, event.device_id, event.action, event.actor_kind,
			event.actor_account_id, event.changes, event.occurred_at
		FROM audit.device_lifecycle_events AS event
		WHERE event.device_id IN (SELECT id FROM chain) AND (? OR event.tenant_id = ?)
		ORDER BY event.occurred_at DESC, event.id DESC
		LIMIT ?`,
		deviceRowID, scope.AcrossSchools, scope.TenantID, lifecycleEventLimit).Scan(ctx, &rows)
	stats.StatementDuration += time.Since(started)
	if err != nil {
		return nil, true, stats, fmt.Errorf("devicefleet postgres: list device lifecycle events: %w", err)
	}
	stats.Rows = int64(len(rows))
	events := make([]devicefleet.LifecycleEvent, 0, len(rows))
	for _, row := range rows {
		event, err := toLifecycleEventDomain(row)
		if err != nil {
			return nil, true, stats, err
		}
		events = append(events, event)
	}
	return events, true, stats, nil
}

func toLifecycleEventDomain(row lifecycleEventRow) (devicefleet.LifecycleEvent, error) {
	changes := map[string]devicefleet.LifecycleChange{}
	if len(row.Changes) > 0 {
		if err := json.Unmarshal(row.Changes, &changes); err != nil {
			return devicefleet.LifecycleEvent{}, fmt.Errorf("devicefleet postgres: decode lifecycle changes of entry %d: %w", row.ID, err)
		}
	}
	return devicefleet.LifecycleEvent{
		ID: row.ID, TenantID: row.TenantID, DeviceRowID: row.DeviceID,
		Action: devicefleet.LifecycleAction(row.Action), ActorKind: devicefleet.LifecycleActorKind(row.ActorKind),
		ActorAccountID: row.AccountID, Changes: changes, OccurredAt: row.OccurredAt,
	}, nil
}
