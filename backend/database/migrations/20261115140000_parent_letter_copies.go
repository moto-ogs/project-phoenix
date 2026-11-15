package migrations

import (
	"context"
	"fmt"
	"strings"

	"github.com/uptrace/bun"
)

const parentLetterCopiesVersion = "20261115140000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     parentLetterCopiesVersion,
		Description: "Elternbriefe: Brief je Kind beim Veröffentlichen festhalten (#4813)",
		DependsOn: []string{
			parentLetterDeliveryVersion,         // users.parent_announcements.delivery_mode
			"1.15.399",                          // users.student_profiles is the child's owner row
			parentAnnouncementRecipientsVersion, // the reached children a copy is written for
			roomsArchiveVersion,                 // the erasure fingerprint this one follows
		},
	})
	Migrations.MustRegister(parentLetterCopiesUp, parentLetterCopiesDown)
}

// parentLetterCopiesUpSQL keeps the letter each child got (#4813).
//
//   - One row per reached child of a published Elternbrief: the text with
//     the child's values filled in, and the name and class it was
//     addressed with. The parent portal, the mail and the printed letters
//     read this row, so a letter does not change when the child's data
//     change later, like the frozen version of a declaration.
//   - Unpublishing deletes the rows; publishing again writes new ones for
//     the corrected text.
//   - The rows go with the announcement (retention, deletion, school
//     erasure) and with the child.
const parentLetterCopiesUpSQL = `
CREATE TABLE users.parent_announcement_letter_copies (
	id              BIGSERIAL PRIMARY KEY,
	tenant_id       BIGINT NOT NULL REFERENCES platform.schools(id) ON DELETE CASCADE,
	announcement_id BIGINT NOT NULL,
	student_id      BIGINT NOT NULL,
	first_name      TEXT NOT NULL DEFAULT '',
	last_name       TEXT NOT NULL DEFAULT '',
	school_class    TEXT NOT NULL DEFAULT '',
	body            TEXT NOT NULL,
	published_at    TIMESTAMPTZ NOT NULL,
	created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	CONSTRAINT uq_parent_letter_copies_child UNIQUE (announcement_id, student_id),
	CONSTRAINT fk_parent_letter_copies_announcement FOREIGN KEY (tenant_id, announcement_id)
		REFERENCES users.parent_announcements(tenant_id, id) ON DELETE CASCADE,
	CONSTRAINT fk_parent_letter_copies_student FOREIGN KEY (tenant_id, student_id)
		REFERENCES users.student_profiles(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_parent_letter_copies_student
	ON users.parent_announcement_letter_copies (tenant_id, student_id);
COMMENT ON TABLE users.parent_announcement_letter_copies IS
	'The letter each reached child got when an Elternbrief was published (#4813).';

GRANT SELECT, INSERT, DELETE ON users.parent_announcement_letter_copies TO phoenix_tenant, phoenix_admin;
REVOKE UPDATE, TRUNCATE ON users.parent_announcement_letter_copies FROM phoenix_tenant, phoenix_admin;
GRANT USAGE ON SEQUENCE users.parent_announcement_letter_copies_id_seq TO phoenix_tenant, phoenix_admin;
`

const parentLetterCopiesDownSQL = `DROP TABLE IF EXISTS users.parent_announcement_letter_copies;`

func parentLetterCopiesUp(ctx context.Context, db *bun.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin parent letter copies: %w", err)
	}
	defer func() {
		if err := tx.Rollback(); err != nil && err.Error() != "sql: transaction has already been committed or rolled back" {
			logRollbackFailure(ctx, err)
		}
	}()
	if _, err := tx.ExecContext(ctx, parentLetterCopiesUpSQL); err != nil {
		return fmt.Errorf("create parent letter copies: %w", err)
	}
	if err := provisionTenantRLS(ctx, tx, "users.parent_announcement_letter_copies"); err != nil {
		return err
	}
	return tx.Commit()
}

// parentLetterCopiesFingerprint is the incoming-FK fingerprint of the school
// erasure plan with the letter copies; the repeatable preflight checks it.
const parentLetterCopiesFingerprint = "f603cf6dfc91488b5edb2f07de529d081f8635b29656c2589a46d3f973dbd1f3"

// parentLetterCopiesErasureLines are the lines the repeatable school
// erasure carries for the copies, per function. The down takes them out of
// the installed functions again, so a school erasure after the rollback
// still runs.
var parentLetterCopiesErasureLines = map[string]string{
	"platform.school_erasure_plan()":                     `  {"name": "users.parent_announcement_letter_copies","predicate": "r.tenant_id = $1"},` + "\n",
	"platform.school_erasure_preflight(bigint,bigint)":   "    users.parent_announcement_letter_copies,\n",
	"platform.school_erasure_assert_empty(bigint,jsonb)": "    SELECT 1 FROM users.parent_announcement_letter_copies AS r WHERE r.tenant_id = p_school_id\n    UNION ALL\n",
	"platform.school_erasure_delete(bigint)": "   SELECT count(*) INTO v_count FROM users.parent_announcement_letter_copies AS r WHERE r.tenant_id = p_school_id; " +
		"DELETE FROM users.parent_announcement_letter_copies AS r WHERE r.tenant_id = p_school_id; " +
		"v_counts := v_counts || jsonb_build_object('users.parent_announcement_letter_copies', v_count);\n",
	"platform.school_erasure_preview(bigint,bigint)": " v_counts := v_counts || jsonb_build_object('users.parent_announcement_letter_copies'," +
		"(SELECT count(*) FROM users.parent_announcement_letter_copies AS r WHERE r.tenant_id = p_school));\n",
}

// parentLetterCopiesDown drops the copies and takes them out of the installed
// school erasure, pointing its preflight back at the fingerprint before them.
func parentLetterCopiesDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		restored := make([]string, 0, len(parentLetterCopiesErasureLines))
		for function, line := range parentLetterCopiesErasureLines {
			var definition string
			if err := tx.NewRaw(`SELECT pg_get_functiondef(?::regprocedure)`, function).Scan(ctx, &definition); err != nil {
				return fmt.Errorf("read %s: %w", function, err)
			}
			if strings.Count(definition, line) != 1 {
				continue // an older erasure is installed; it never knew the copies
			}
			definition = strings.Replace(definition, line, "", 1)
			definition = strings.Replace(definition, "'"+parentLetterCopiesFingerprint+"'", "'"+roomsArchiveFingerprint+"'", 1)
			restored = append(restored, definition)
		}
		if err := installDerivedSchoolErasureFunctions(ctx, tx, restored); err != nil {
			return fmt.Errorf("take the letter copies out of the school erasure: %w", err)
		}
		if _, err := tx.ExecContext(ctx, parentLetterCopiesDownSQL); err != nil {
			return fmt.Errorf("drop parent letter copies: %w", err)
		}
		return nil
	})
}
