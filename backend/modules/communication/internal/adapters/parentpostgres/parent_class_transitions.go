package parentpostgres

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/uptrace/bun"
)

// ParentClassTransitions moves the class targets of the parent channels with
// a school-year change (#8214): the open class threads and the class targets
// of draft announcements. Every move is pushed onto the row's own stack
// (users.parent_group_threads.class_moves,
// users.parent_announcements.class_target_moves), so the revert of the
// transition pops exactly what it moved. Sent messages are never touched:
// their recipient rows stay as they were.
type ParentClassTransitions struct{ store }

// NewParentClassTransitions builds the store over the ambient transaction
// runtime.
func NewParentClassTransitions(database Database) *ParentClassTransitions {
	return &ParentClassTransitions{store: newStore(database)}
}

var _ communication.ParentClassTransitions = (*ParentClassTransitions)(nil)

// A class name matches a stored target trimmed and lower-cased
// (lower(btrim(...))), as the parent audience matches the children's class.

// parentClassTargetsSQL lists the open class threads and the draft
// announcements with a class target among the given classes.
//
// Bind order: school, classes, school, classes.
const parentClassTargetsSQL = `
SELECT kind, id, title, class FROM (
	SELECT 'group_thread' AS kind, gt.id, gt.title, gt.target_ref_text AS class
	FROM users.parent_group_threads AS gt
	WHERE gt.tenant_id = ? AND gt.target_type = 'class' AND gt.closed_at IS NULL
		AND lower(btrim(gt.target_ref_text)) IN (?)
	UNION
	SELECT 'announcement_draft', a.id, a.title, t.target_ref_text
	FROM users.parent_announcement_targets AS t
	JOIN users.parent_announcements AS a ON a.id = t.announcement_id AND a.tenant_id = t.tenant_id
	WHERE t.tenant_id = ? AND t.target_type = 'class' AND a.published_at IS NULL
		AND lower(btrim(t.target_ref_text)) IN (?)
) AS targets
ORDER BY kind DESC, lower(class), id`

type parentClassTargetRow struct {
	Kind  string `bun:"kind"`
	ID    int64  `bun:"id"`
	Title string `bun:"title"`
	Class string `bun:"class"`
}

// ListParentClassTargets returns the open class threads and the draft
// announcements that write to one of the classes.
func (s *ParentClassTransitions) ListParentClassTargets(ctx context.Context, classes []string) ([]communication.ParentClassTarget, error) {
	keys := classKeys(classes)
	if len(keys) == 0 {
		return []communication.ParentClassTarget{}, nil
	}
	db, tenantID, err := s.schoolDB(ctx, "list parent class targets")
	if err != nil {
		return nil, err
	}
	var rows []parentClassTargetRow
	if err := db.NewRaw(parentClassTargetsSQL, tenantID, bun.List(keys), tenantID, bun.List(keys)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("list parent class targets: %w", err)
	}
	out := make([]communication.ParentClassTarget, 0, len(rows))
	for _, row := range rows {
		out = append(out, communication.ParentClassTarget{Kind: row.Kind, ID: row.ID, Title: row.Title, Class: row.Class})
	}
	return out, nil
}

// followClassThreadsSQL moves every open class thread of a renamed class in
// one statement, so a chain (3a to 4a while 4a to 5a) reads the old classes
// only. A thread of a leaving class keeps its class and is closed.
//
// Bind order: renames, transition, closed at, closed by, school.
const followClassThreadsSQL = `
WITH renames AS (
	SELECT from_class, to_class FROM jsonb_to_recordset(?::jsonb) AS r(from_class TEXT, to_class TEXT)
)
UPDATE users.parent_group_threads AS gt SET
	target_ref_text = COALESCE(r.to_class, gt.target_ref_text),
	class_moves = gt.class_moves || jsonb_build_array(jsonb_build_object(
		'transition_id', ?::bigint, 'from_class', gt.target_ref_text, 'to_class', r.to_class)),
	closed_at = CASE WHEN r.to_class IS NULL THEN ?::timestamptz ELSE gt.closed_at END,
	closed_by_account_id = CASE WHEN r.to_class IS NULL THEN ?::bigint ELSE gt.closed_by_account_id END
FROM renames AS r
WHERE gt.tenant_id = ? AND gt.target_type = 'class' AND gt.closed_at IS NULL
	AND lower(btrim(gt.target_ref_text)) = lower(btrim(r.from_class))`

// followDraftTargetsSQL moves the class targets of draft announcements and
// removes those of a leaving class, recording both on the announcement.
//
// Bind order: renames, school, transition.
const followDraftTargetsSQL = `
WITH renames AS (
	SELECT from_class, to_class FROM jsonb_to_recordset(?::jsonb) AS r(from_class TEXT, to_class TEXT)
), hits AS (
	SELECT t.id, t.tenant_id, t.announcement_id, t.target_ref_text AS from_class, r.to_class
	FROM users.parent_announcement_targets AS t
	JOIN users.parent_announcements AS a ON a.id = t.announcement_id AND a.tenant_id = t.tenant_id
	JOIN renames AS r ON lower(btrim(t.target_ref_text)) = lower(btrim(r.from_class))
	WHERE t.tenant_id = ? AND t.target_type = 'class' AND a.published_at IS NULL
	FOR UPDATE OF t, a
), moved AS (
	UPDATE users.parent_announcement_targets AS t SET target_ref_text = h.to_class
	FROM hits AS h WHERE t.id = h.id AND t.tenant_id = h.tenant_id AND h.to_class IS NOT NULL
), removed AS (
	DELETE FROM users.parent_announcement_targets AS t
	USING hits AS h WHERE t.id = h.id AND t.tenant_id = h.tenant_id AND h.to_class IS NULL
)
UPDATE users.parent_announcements AS a SET
	class_target_moves = a.class_target_moves || jsonb_build_array(jsonb_build_object(
		'transition_id', ?::bigint, 'targets', per.targets))
FROM (
	SELECT announcement_id, tenant_id, jsonb_agg(jsonb_build_object(
		'target_id', id, 'from_class', from_class, 'to_class', to_class) ORDER BY id) AS targets
	FROM hits GROUP BY announcement_id, tenant_id
) AS per
WHERE a.id = per.announcement_id AND a.tenant_id = per.tenant_id`

type classRenameJSON struct {
	FromClass string  `json:"from_class"`
	ToClass   *string `json:"to_class"`
}

// FollowParentClassRenames moves the open class threads and the draft class
// targets of the renamed classes.
func (s *ParentClassTransitions) FollowParentClassRenames(ctx context.Context, transitionID, closedBy int64, closedAt time.Time, renames []communication.ParentClassRename) error {
	if len(renames) == 0 {
		return nil
	}
	db, tenantID, err := s.schoolDB(ctx, "follow parent class renames")
	if err != nil {
		return err
	}
	payload := make([]classRenameJSON, 0, len(renames))
	for _, rename := range renames {
		payload = append(payload, classRenameJSON{FromClass: rename.FromClass, ToClass: rename.ToClass})
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("follow parent class renames: %w", err)
	}
	var closer *int64
	if closedBy > 0 {
		closer = &closedBy
	}
	if _, err := db.NewRaw(followClassThreadsSQL, string(encoded), transitionID, closedAt, closer, tenantID).Exec(ctx); err != nil {
		return fmt.Errorf("follow class renames on group threads: %w", err)
	}
	if _, err := db.NewRaw(followDraftTargetsSQL, string(encoded), tenantID, transitionID).Exec(ctx); err != nil {
		return fmt.Errorf("follow class renames on draft announcements: %w", err)
	}
	return nil
}

// revertClassThreadsSQL pops the transition's entry from every class thread
// it moved: the class comes back, and a thread it closed opens again.
//
// Bind order: school, transition.
const revertClassThreadsSQL = `
UPDATE users.parent_group_threads AS gt SET
	target_ref_text = gt.class_moves -> -1 ->> 'from_class',
	closed_at = CASE WHEN gt.class_moves -> -1 -> 'to_class' = 'null'::jsonb THEN NULL ELSE gt.closed_at END,
	closed_by_account_id = CASE WHEN gt.class_moves -> -1 -> 'to_class' = 'null'::jsonb THEN NULL ELSE gt.closed_by_account_id END,
	class_moves = gt.class_moves - -1
WHERE gt.tenant_id = ? AND jsonb_array_length(gt.class_moves) > 0
	AND (gt.class_moves -> -1 ->> 'transition_id')::bigint = ?`

// revertDraftTargetsSQL pops the transition's entry from every announcement
// it touched. While the announcement is still a draft, a moved target gets
// its class back (unless it was edited since) and a removed one is added
// again; a published announcement keeps the targets it went out with.
//
// Bind order: school, transition.
const revertDraftTargetsSQL = `
WITH popped AS (
	SELECT a.id, a.tenant_id, a.published_at IS NULL AS draft, a.class_target_moves -> -1 -> 'targets' AS targets
	FROM users.parent_announcements AS a
	WHERE a.tenant_id = ? AND jsonb_array_length(a.class_target_moves) > 0
		AND (a.class_target_moves -> -1 ->> 'transition_id')::bigint = ?
	FOR UPDATE
), items AS (
	SELECT p.id AS announcement_id, p.tenant_id, (e ->> 'target_id')::bigint AS target_id,
		e ->> 'from_class' AS from_class, e ->> 'to_class' AS to_class
	FROM popped AS p, jsonb_array_elements(p.targets) AS e
	WHERE p.draft
), restored AS (
	UPDATE users.parent_announcement_targets AS t SET target_ref_text = i.from_class
	FROM items AS i
	WHERE t.id = i.target_id AND t.tenant_id = i.tenant_id AND i.to_class IS NOT NULL
		AND t.target_type = 'class' AND t.target_ref_text = i.to_class
), readded AS (
	INSERT INTO users.parent_announcement_targets (tenant_id, announcement_id, target_type, target_ref_text)
	SELECT i.tenant_id, i.announcement_id, 'class', i.from_class FROM items AS i WHERE i.to_class IS NULL
)
UPDATE users.parent_announcements AS a SET class_target_moves = a.class_target_moves - -1
FROM popped AS p WHERE a.id = p.id AND a.tenant_id = p.tenant_id`

// RevertParentClassRenames undoes what the transition moved.
func (s *ParentClassTransitions) RevertParentClassRenames(ctx context.Context, transitionID int64) error {
	db, tenantID, err := s.schoolDB(ctx, "revert parent class renames")
	if err != nil {
		return err
	}
	if _, err := db.NewRaw(revertClassThreadsSQL, tenantID, transitionID).Exec(ctx); err != nil {
		return fmt.Errorf("revert class renames on group threads: %w", err)
	}
	if _, err := db.NewRaw(revertDraftTargetsSQL, tenantID, transitionID).Exec(ctx); err != nil {
		return fmt.Errorf("revert class renames on draft announcements: %w", err)
	}
	return nil
}

// latestClassMove decodes the newest entry of a thread's class_moves stack.
// An unreadable stack reads as no move: the note is informational.
func latestClassMove(raw json.RawMessage) *communication.ParentGroupClassMove {
	if len(raw) == 0 {
		return nil
	}
	var moves []communication.ParentGroupClassMove
	if err := json.Unmarshal(raw, &moves); err != nil || len(moves) == 0 {
		return nil
	}
	latest := moves[len(moves)-1]
	return &latest
}

// schoolDB is the caller's school transaction; the moves never run across
// schools.
func (s *ParentClassTransitions) schoolDB(ctx context.Context, operation string) (bun.IDB, int64, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return nil, 0, err
	}
	if scope.AcrossSchools || scope.TenantID <= 0 {
		return nil, 0, fmt.Errorf("%s: school transaction is required", operation)
	}
	return db, scope.TenantID, nil
}

func classKeys(classes []string) []string {
	seen := make(map[string]bool, len(classes))
	keys := make([]string, 0, len(classes))
	for _, class := range classes {
		key := strings.ToLower(strings.TrimSpace(class))
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		keys = append(keys, key)
	}
	return keys
}
