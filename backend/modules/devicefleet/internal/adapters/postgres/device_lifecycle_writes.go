package postgres

import (
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/devicefleet"
	"github.com/moto-ogs/project-phoenix/modules/devicefleet/internal/domain"
	"github.com/uptrace/bun"
)

// The history entry of a create or an edit is written by the same statement
// as the device (#2321): a data-modifying CTE in front of the device's
// INSERT or UPDATE adds it, so the entry commits or rolls back with the
// change and costs no statement of its own. The statement stays the
// device's INSERT or UPDATE and returns the device as before.

// lifecycleCreatedSQL records a new device with its starting master data.
// The CTE new_device reserves the device's ID, which the device INSERT then
// uses; (TABLE new_device) reads it.
const lifecycleCreatedSQL = `INSERT INTO audit.device_lifecycle_events
	(tenant_id, device_id, action, actor_kind, actor_account_id, actor_operator_id, changes, occurred_at)
	SELECT ?, (TABLE new_device), 'created', ?, ?, ?, jsonb_strip_nulls(jsonb_build_object(
		'device_id', jsonb_build_object('after', ?::text),
		'device_type', jsonb_build_object('after', ?::text),
		'name', CASE WHEN ?::text IS NOT NULL THEN jsonb_build_object('after', ?::text) END,
		'status', jsonb_build_object('after', ?::text))), ?`

// lifecycleEditedSQL records an edit with the fields it changes, compared
// with the row as the statement's snapshot holds it: every part of one
// statement sees the rows from before the UPDATE. A NULL new
// status keeps the stored one. A changed status names the entry: inactive
// blocks, active unblocks. An edit that changes nothing material records
// nothing; neither does one whose device the UPDATE will not find.
const lifecycleEditedSQL = `INSERT INTO audit.device_lifecycle_events
	(tenant_id, device_id, action, actor_kind, actor_account_id, actor_operator_id, changes, occurred_at)
	SELECT diff.tenant_id, diff.id,
		CASE WHEN ((diff.old_status IS NULL) <> (diff.new_status IS NULL) OR diff.old_status <> diff.new_status) THEN
			CASE diff.new_status WHEN 'inactive' THEN 'blocked' WHEN 'active' THEN 'unblocked' ELSE 'status_changed' END
		ELSE 'updated' END,
		?, ?, ?, diff.changes, ?
	FROM (
		SELECT v.tenant_id, v.id, v.old_status, v.new_status, jsonb_strip_nulls(jsonb_build_object(
			'device_id', CASE WHEN ((v.old_device_id IS NULL) <> (v.new_device_id IS NULL) OR v.old_device_id <> v.new_device_id) THEN jsonb_build_object('before', v.old_device_id, 'after', v.new_device_id) END,
			'device_type', CASE WHEN ((v.old_device_type IS NULL) <> (v.new_device_type IS NULL) OR v.old_device_type <> v.new_device_type) THEN jsonb_build_object('before', v.old_device_type, 'after', v.new_device_type) END,
			'name', CASE WHEN ((v.old_name IS NULL) <> (v.new_name IS NULL) OR v.old_name <> v.new_name) THEN jsonb_build_object('before', v.old_name, 'after', v.new_name) END,
			'status', CASE WHEN ((v.old_status IS NULL) <> (v.new_status IS NULL) OR v.old_status <> v.new_status) THEN jsonb_build_object('before', v.old_status, 'after', v.new_status) END
		)) AS changes
		FROM (
			SELECT p.tenant_id, p.id,
				p.device_id AS old_device_id, ?::text AS new_device_id,
				p.device_type AS old_device_type, ?::text AS new_device_type,
				p.name AS old_name, ?::text AS new_name,
				p.status::text AS old_status, COALESCE(?::text, p.status::text) AS new_status
			FROM iot.devices AS p
			WHERE p.id = ? AND p.archived_at IS NULL AND (? OR p.tenant_id = ?)
		) AS v
	) AS diff
	WHERE diff.changes <> '{}'::jsonb`

// recordCreation turns the device INSERT into one that also records the
// creation: the ID comes from the reserved sequence value.
func recordCreation(db bun.IDB, insert *bun.InsertQuery, row *deviceRow, record domain.LifecycleRecord) *bun.InsertQuery {
	reserve := db.NewSelect().ColumnExpr(`nextval(pg_get_serial_sequence('iot.devices', 'id')) AS id`)
	event := db.NewRaw(lifecycleCreatedSQL,
		row.TenantID, record.ActorKind, record.AccountID, record.OperatorID,
		row.DeviceID, row.DeviceType, row.Name, row.Name, row.Status, record.OccurredAt)
	return insert.
		With("new_device", reserve).
		With("event", event).
		Value("id", `(SELECT id FROM new_device)`)
}

// recordEdit turns the device UPDATE into one that also records the edit's
// material changes. The previous row is read with the UPDATE's own scope;
// the school's edit always names device ID, class and name, the status
// only when it changes it.
func recordEdit(db bun.IDB, update *bun.UpdateQuery, input domain.UpdateDevice, columns []string, scope TenantScope, record domain.LifecycleRecord) *bun.UpdateQuery {
	var status *string
	if slices.Contains(columns, "status") {
		status = &input.Status
	}
	event := db.NewRaw(lifecycleEditedSQL,
		record.ActorKind, record.AccountID, record.OperatorID, record.OccurredAt,
		input.DeviceID, input.DeviceType, input.Name, status,
		input.ID, scope.AcrossSchools, scope.TenantID)
	return update.With("event", event)
}

// lifecycleRecord is the stored form of the actor of a recorded write.
func lifecycleRecord(actor devicefleet.LifecycleActorRef, at time.Time) domain.LifecycleRecord {
	record := domain.LifecycleRecord{ActorKind: string(actor.Kind), OccurredAt: at}
	id := actor.ID
	if actor.Kind == devicefleet.LifecycleActorOperator {
		record.OperatorID = &id
	} else {
		record.AccountID = &id
	}
	return record
}
