package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/uptrace/bun"
)

const notificationFeedVersion = "20261115200000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     notificationFeedVersion,
		Description: "Benachrichtigungs-Feed im Staff-Portal (#7148)",
		DependsOn: []string{
			realtimeNotificationsVersion, // Delivery's other in-app notification table (#5504)
		},
	})
	Migrations.MustRegister(notificationFeedUp, notificationFeedDown)
}

// notificationFeedUpSQL adds the stored notification feed of an account in
// one school (#7148), Delivery's third channel next to Web Push and e-mail.
// The producer writes an entry in its own transaction:
//
//   - title, body and deep_link are the finished, display-safe text and the
//     app-relative link, written once; the entry stays readable when its
//     object changes or goes.
//   - related_type and related_id name the object the entry is about. An
//     unread entry of the same account, type and object updated in the last
//     ten minutes is updated instead of a second one (bundling).
//   - read_at is set by a click or by "Alle als gelesen markieren" only.
//
// An entry goes 30 days after its last update in the nightly Delivery
// retention, with its account and with its school.
const notificationFeedUpSQL = `
		CREATE TABLE platform.notification_feed_entries (
			id           BIGSERIAL PRIMARY KEY,
			tenant_id    BIGINT NOT NULL REFERENCES platform.schools(id) ON DELETE CASCADE,
			account_id   BIGINT NOT NULL REFERENCES auth.accounts(id) ON DELETE CASCADE,
			type         TEXT NOT NULL CHECK (type ~ '^[a-z][a-z0-9_]{0,63}$'),
			title        TEXT NOT NULL CHECK (BTRIM(title) <> '' AND char_length(title) <= 200),
			body         TEXT NOT NULL CHECK (char_length(body) <= 1000),
			deep_link    TEXT NOT NULL CHECK (deep_link ~ '^/[^/\\]' AND char_length(deep_link) <= 500),
			related_type TEXT NOT NULL CHECK (related_type ~ '^[a-z][a-z0-9_]{0,63}$'),
			related_id   BIGINT NOT NULL CHECK (related_id > 0),
			created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			read_at      TIMESTAMPTZ
		);
		CREATE INDEX idx_notification_feed_entries_account
			ON platform.notification_feed_entries (tenant_id, account_id, updated_at DESC, id DESC);
		CREATE INDEX idx_notification_feed_entries_unread
			ON platform.notification_feed_entries (tenant_id, account_id, type, related_type, related_id)
			WHERE read_at IS NULL;
		CREATE INDEX idx_notification_feed_entries_updated
			ON platform.notification_feed_entries (tenant_id, updated_at);
		CREATE INDEX idx_notification_feed_entries_account_id
			ON platform.notification_feed_entries (account_id);
		COMMENT ON TABLE platform.notification_feed_entries IS
			'Benachrichtigungs-Feed je Konto und Schule (#7148): fertiger Text, Link und Objekt, gelesen per Klick; 30 Tage nach der letzten Aktualisierung gelöscht.';

		REVOKE ALL ON platform.notification_feed_entries FROM PUBLIC, phoenix_tenant;
		GRANT SELECT, INSERT, DELETE ON platform.notification_feed_entries TO phoenix_tenant;
		GRANT UPDATE (title, body, deep_link, updated_at, read_at) ON platform.notification_feed_entries TO phoenix_tenant;
		GRANT USAGE ON SEQUENCE platform.notification_feed_entries_id_seq TO phoenix_tenant;
`

func notificationFeedUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, notificationFeedUpSQL); err != nil {
			return fmt.Errorf("create the notification feed: %w", err)
		}
		return provisionTenantRLS(ctx, tx, "platform.notification_feed_entries")
	})
}

// notificationFeedFingerprint is the incoming-FK fingerprint of the school
// erasure plan with the feed; the repeatable preflight checks it.
// notificationFeedBaseFingerprint is the one before (rooms archive).
const (
	notificationFeedFingerprint     = "4d95d2a69e04f79b26e2b68b6c05abe0ea3716be64c82390346143dd132b1ddc"
	notificationFeedBaseFingerprint = roomsArchiveFingerprint
	notificationFeedTable           = "platform.notification_feed_entries"
)

// notificationFeedErasureFunctions are the erasure functions that name the
// feed, with the statements the repeatable definitions add for it.
var notificationFeedErasureFunctions = []struct {
	signature string
	lines     []string
}{
	{"platform.school_erasure_plan()", []string{`  {"name": "` + notificationFeedTable + `","predicate": "r.tenant_id = $1"},` + "\n"}},
	{"platform.school_erasure_preflight(bigint,bigint)", []string{"    " + notificationFeedTable + ",\n"}},
	{"platform.school_erasure_delete(bigint)", []string{"   SELECT count(*) INTO v_count FROM " + notificationFeedTable + " AS r WHERE r.tenant_id = p_school_id; DELETE FROM " + notificationFeedTable + " AS r WHERE r.tenant_id = p_school_id; v_counts := v_counts || jsonb_build_object('" + notificationFeedTable + "', v_count);\n"}},
	{"platform.school_erasure_preview(bigint,bigint)", []string{" v_counts := v_counts || jsonb_build_object('" + notificationFeedTable + "',(SELECT count(*) FROM " + notificationFeedTable + " AS r WHERE r.tenant_id = p_school));\n"}},
	{"platform.school_erasure_assert_empty(bigint,jsonb)", []string{"    SELECT 1 FROM " + notificationFeedTable + " AS r WHERE r.tenant_id = p_school_id\n    UNION ALL\n"}},
	{"platform.erase_closed_demo_visitors()", []string{"\t\t\t\t\t-- A feed entry of the school (#7148) can name the visitor in its\n\t\t\t\t\t-- title or text; the school is the visitor's alone, so all of\n\t\t\t\t\t-- them go.\n\t\t\t\t\tDELETE FROM " + notificationFeedTable + "\n\t\t\t\t\tWHERE tenant_id = ANY (hidden_schools);\n"}},
}

// notificationFeedDown takes the feed out of the installed erasure functions,
// points the preflight back at the fingerprint before the feed, and drops the
// table, so an erasure after the rollback still passes its signature check.
// The account erasure deletes the feed by its account; the table cascades
// with the account, so its statement is dropped as well.
func notificationFeedDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		functions := make([]string, 0, len(notificationFeedErasureFunctions)+1)
		for _, function := range append(notificationFeedErasureFunctions, struct {
			signature string
			lines     []string
		}{"auth.erase_unused_accounts()", []string{"\t\t\t\t\tDELETE FROM " + notificationFeedTable + " AS target WHERE target.account_id = candidate;\n"}}) {
			var definition string
			if err := tx.NewRaw(`SELECT pg_get_functiondef(to_regprocedure(?))`, function.signature).Scan(ctx, &definition); err != nil {
				return fmt.Errorf("read %s: %w", function.signature, err)
			}
			for _, line := range function.lines {
				definition = strings.Replace(definition, line, "", 1)
			}
			definition = strings.Replace(definition, "'"+notificationFeedFingerprint+"'", "'"+notificationFeedBaseFingerprint+"'", 1)
			functions = append(functions, definition)
		}
		if err := installDerivedSchoolErasureFunctions(ctx, tx, functions); err != nil {
			return fmt.Errorf("take the notification feed out of the erasure: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS `+notificationFeedTable); err != nil {
			return fmt.Errorf("drop the notification feed: %w", err)
		}
		return nil
	})
}
