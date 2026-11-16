package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const photoConsentsAfterSwitchOffVersion = "20261116180000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     photoConsentsAfterSwitchOffVersion,
		Description: "Foto-Einwilligungen beenden, die ein früheres Ausschalten der Kinderfotos überlebt haben (#7250)",
		DependsOn: []string{
			configSettingValuesVersion,   // config.setting_audit names each switch-off (1.15.25)
			parentStudentConsentsVersion, // audit.student_consent_changes and its migration_snapshot source (1.15.363)
			photoCleanupOutboxVersion,    // documents.file_cleanup.object_kind 'student-photos' (1.15.462)
			"1.15.399",                   // users.student_profiles holds the photo columns
		},
	})
	Migrations.MustRegister(photoConsentsAfterSwitchOffUp, photoConsentsAfterSwitchOffDown)
}

// photoConsentsAfterSwitchOffUpSQL ends the photo consents that survived a
// switch-off of the school's photo feature before #7208 (#7250). Since #7208
// a switch-off ends every photo consent; before it, a consent outlived the
// switch-off and carried an upload after the next switch-on without a new
// confirmation.
//
// A switch-off is a setting change that leaves the school's own value true
// for anything else: a set to false and a reset to the default (false) alike.
// A consent given before the school's last switch-off survived at least that
// one, so it ends. A consent given later stays, including one from an
// enrollment while the photos were off: it was given knowingly and no
// switch-off has touched it.
//
// Each ended consent gets its withdrawal in the trail with the source
// migration_snapshot and no account. A photo attached to such a consent (the
// school switched photos on again) goes with it: the stored reference is
// cleared and its file is queued in the managed upload cleanup the worker
// drains, under the rules UploadCleanup.QueueAll applies at runtime. Running
// it again finds nothing more to end.
const photoConsentsAfterSwitchOffUpSQL = `
WITH last_switch_off AS (
	SELECT tenant_id, max(changed_at) AS switched_off_at
	FROM config.setting_audit
	WHERE setting_key = 'operations.student_photos_enabled'
		AND old_value = 'true'::jsonb
		AND new_value IS DISTINCT FROM 'true'::jsonb
	GROUP BY tenant_id
),
survivors AS (
	SELECT student.tenant_id, student.id, student.photo_path
	FROM users.student_profiles AS student
	JOIN last_switch_off ON last_switch_off.tenant_id = student.tenant_id
	WHERE student.photo_consent_given_at < last_switch_off.switched_off_at
	FOR UPDATE OF student
),
ended AS (
	UPDATE users.student_profiles AS student SET
		photo_path = NULL,
		photo_consent_given_at = NULL,
		photo_consent_given_by = NULL,
		updated_at = NOW()
	FROM survivors
	WHERE student.tenant_id = survivors.tenant_id AND student.id = survivors.id
	RETURNING survivors.tenant_id, survivors.id, survivors.photo_path
),
withdrawn AS (
	INSERT INTO audit.student_consent_changes
		(tenant_id, student_id, consent_key, action, source, actor_account_id, created_at, updated_at)
	SELECT tenant_id, id, 'photo', 'withdrawn', 'migration_snapshot', NULL, NOW(), NOW()
	FROM ended
	RETURNING 1
),
detached AS (
	SELECT DISTINCT tenant_id, substr(photo_path, length('/uploads/student-photos/') + 1) AS filename_stored
	FROM ended
	WHERE starts_with(photo_path, '/uploads/student-photos/')
),
queued AS (
	INSERT INTO documents.file_cleanup (tenant_id, object_kind, owner_id, filename_stored, retry_after)
	SELECT tenant_id, 'student-photos', tenant_id, filename_stored, NOW()
	FROM detached
	WHERE filename_stored <> ''
		AND strpos(filename_stored, '/') = 0
		AND strpos(filename_stored, '\') = 0
		AND strpos(filename_stored, '..') = 0
	ON CONFLICT (tenant_id, object_kind, filename_stored) DO UPDATE SET
		cleaned_at = NULL,
		retry_after = EXCLUDED.retry_after,
		owner_id = EXCLUDED.owner_id
	RETURNING 1
)
SELECT (SELECT count(*) FROM withdrawn) AS consents_ended, (SELECT count(*) FROM queued) AS photos_queued
`

func photoConsentsAfterSwitchOffUp(ctx context.Context, db *bun.DB) error {
	var result struct {
		ConsentsEnded int64 `bun:"consents_ended"`
		PhotosQueued  int64 `bun:"photos_queued"`
	}
	if err := db.NewRaw(photoConsentsAfterSwitchOffUpSQL).Scan(ctx, &result); err != nil {
		return fmt.Errorf("end photo consents that survived a switch-off: %w", err)
	}
	if result.ConsentsEnded > 0 {
		migrationLog().InfoContext(ctx, "photo consents from before a switch-off ended",
			"consents_ended", result.ConsentsEnded,
			"photos_queued", result.PhotosQueued,
		)
	}
	return nil
}

// photoConsentsAfterSwitchOffDown keeps the ended consents ended: a rollback
// must not bring back a consent the trail records as withdrawn, and the
// detached files may already be gone.
func photoConsentsAfterSwitchOffDown(context.Context, *bun.DB) error { return nil }
