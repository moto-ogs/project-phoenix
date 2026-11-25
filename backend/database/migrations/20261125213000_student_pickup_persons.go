package migrations

import (
	"context"
	"fmt"
	"strings"

	"github.com/uptrace/bun"
)

const studentPickupPersonsVersion = "20261125213000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     studentPickupPersonsVersion,
		Description: "Abholperson für einen einzelnen Tag (#7655)",
		DependsOn: []string{
			studentDepartureExceptionsVersion,            // the sibling day value of the Heimweg
			"1.15.895",                                   // the deletion log kinds this one extends
			holidayRegistrationConsentWithdrawalsVersion, // the last migration before this one
		},
	})
	Migrations.MustRegister(studentPickupPersonsUp, studentPickupPersonsDown)
}

// studentPickupPersonsUpSQL creates schedule.student_pickup_persons: who
// collects one child on one day (#7655). It is a day value of its own next
// to the Gehzeit (student_pickup_exceptions) and the Abholart
// (student_departure_exceptions); the free-text pickup note stays.
//
//   - person_name is the name staff check at the pickup. For a contact with a
//     standing pickup permission it is the name the contact had when the day
//     was set, and guardian_profile_id names the contact; a removed contact
//     takes the day value with it. A one-time person has only the name:
//     the staff check the ID card at the pickup and nothing about it is
//     stored.
//   - Data minimisation: the nightly retention step pickup_person_retention
//     deletes every row of a day that has passed, so the name lives no
//     longer than the day it is for.
//   - created_by is the staff membership that set the value.
const studentPickupPersonsUpSQL = `
CREATE TABLE IF NOT EXISTS schedule.student_pickup_persons (
	id                  BIGSERIAL PRIMARY KEY,
	tenant_id           BIGINT NOT NULL REFERENCES platform.schools(id) ON DELETE CASCADE,
	student_id          BIGINT NOT NULL,
	exception_date      DATE NOT NULL,
	person_name         VARCHAR(120) NOT NULL,
	guardian_profile_id BIGINT,
	created_by          BIGINT,
	created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	CONSTRAINT chk_student_pickup_persons_name CHECK (btrim(person_name) <> ''),
	CONSTRAINT uq_student_pickup_persons_day UNIQUE (tenant_id, student_id, exception_date),
	CONSTRAINT uq_student_pickup_persons_tenant_id_id UNIQUE (tenant_id, id),
	CONSTRAINT fk_student_pickup_persons_student FOREIGN KEY (tenant_id, student_id)
		REFERENCES users.student_profiles(tenant_id, id) ON DELETE CASCADE,
	CONSTRAINT fk_student_pickup_persons_guardian FOREIGN KEY (tenant_id, guardian_profile_id)
		REFERENCES users.guardian_profiles(tenant_id, id) ON DELETE CASCADE,
	CONSTRAINT fk_student_pickup_persons_created_by FOREIGN KEY (tenant_id, created_by)
		REFERENCES users.staff_school_memberships(tenant_id, id) ON DELETE SET NULL (created_by)
);

COMMENT ON TABLE schedule.student_pickup_persons IS 'Wer ein Kind an einem einzelnen Tag abholt (#7655); wird nach Ablauf des Tages gelöscht.';

-- Every day view (Heute anders, group view) reads one date for many
-- children, and the retention step deletes by date.
CREATE INDEX IF NOT EXISTS idx_student_pickup_persons_date
	ON schedule.student_pickup_persons (tenant_id, exception_date);
CREATE INDEX IF NOT EXISTS idx_student_pickup_persons_guardian
	ON schedule.student_pickup_persons (tenant_id, guardian_profile_id) WHERE guardian_profile_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_student_pickup_persons_updated_at ON schedule.student_pickup_persons;
CREATE TRIGGER update_student_pickup_persons_updated_at
BEFORE UPDATE ON schedule.student_pickup_persons
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON schedule.student_pickup_persons TO phoenix_tenant;
GRANT USAGE ON SEQUENCE schedule.student_pickup_persons_id_seq TO phoenix_tenant;

ALTER TABLE audit.data_deletions
			DROP CONSTRAINT IF EXISTS chk_data_deletions_subject;
		ALTER TABLE audit.data_deletions
			ADD CONSTRAINT chk_data_deletions_subject CHECK (
				(student_id IS NULL OR staff_id IS NULL)
				AND (
					student_id IS NOT NULL
					OR staff_id IS NOT NULL
					OR deletion_type IN (
						'unregistered_tag_scan_retention',
						'status_day_retention',
						'attendance_retention',
						'morning_attendance_retention',
						'homework_retention',
						'guardian_retention',
						'parent_message_retention',
						'parent_announcement_retention',
						'staff_notice_retention',
						'appointment_retention',
						'appointment_tombstone_retention',
						'grade_transition_retention',
						'removed_file_retention',
						'auth_event_retention',
						'data_access_log_retention',
						'deletion_log_retention',
						'delivery_retention',
						'file_cleanup_retention',
						'staff_cleanup_retention',
						'student_document_cleanup_retention',
						'care_withdrawal_retention',
						'submission_rate_limit_retention',
						'settled_enrollment_retention',
						'staff_sick_note_retention',
						'student_deletion_log_retention',
						'enrollment_deletion_log_retention',
						'enrollment_restoration_log_retention',
						'time_tracking_deletion_log_retention',
						'staff_master_data_change_retention',
						'personnel_number_change_retention',
						'guardian_financial_change_retention',
						'class_list_change_retention',
						'substitution_change_retention',
						'file_event_retention',
						'export_transfer_retention',
						'setting_audit_retention',
						'enrollment_upload_retention',
						'parent_survey_retention',
						'staff_survey_retention',
						'week_protocol_retention',
						'parent_conference_retention',
 'feedback_retention', 'pwa_usage_retention', 'staff_message_retention',
						'pickup_person_retention'
					)
				)
			);
`

func studentPickupPersonsUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, studentPickupPersonsUpSQL); err != nil {
			return fmt.Errorf("create schedule.student_pickup_persons: %w", err)
		}
		return provisionTenantRLS(ctx, tx, "schedule.student_pickup_persons")
	})
}

// studentPickupPersonsFingerprint is the incoming-FK fingerprint of the
// school erasure plan with the pickup persons; the repeatable preflight
// checks it.
const studentPickupPersonsFingerprint = "3968ba9e7719974ac0b637f089c5b482e8ef39757251faa4db47b5b7cc959b22"

// studentPickupPersonsErasureLines are the lines the repeatable school and
// demo erasures carry for the pickup persons, per function. The down takes
// them out of the installed functions again, so an erasure after the
// rollback still runs.
var studentPickupPersonsErasureLines = map[string]string{
	"platform.school_erasure_plan()":                     `  {"name": "schedule.student_pickup_persons","predicate": "r.tenant_id = $1"},` + "\n",
	"platform.school_erasure_preflight(bigint,bigint)":   "    schedule.student_pickup_persons,\n",
	"platform.school_erasure_assert_empty(bigint,jsonb)": "    SELECT 1 FROM schedule.student_pickup_persons AS r WHERE r.tenant_id = p_school_id\n    UNION ALL\n",
	"platform.school_erasure_delete(bigint)": "   SELECT count(*) INTO v_count FROM schedule.student_pickup_persons AS r WHERE r.tenant_id = p_school_id; " +
		"DELETE FROM schedule.student_pickup_persons AS r WHERE r.tenant_id = p_school_id; " +
		"v_counts := v_counts || jsonb_build_object('schedule.student_pickup_persons', v_count);\n",
	"platform.erase_closed_demo_visitors()": " DELETE FROM schedule.student_pickup_persons WHERE tenant_id = ANY (hidden_schools);",
}

// studentPickupPersonsDown takes the table out of the installed school and
// demo erasures, pointing the preflight back at the fingerprint before it,
// and drops it. Deletion log entries are append-only, so the additive
// deletion kind stays, as in 1.15.895.
func studentPickupPersonsDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		restored := make([]string, 0, len(studentPickupPersonsErasureLines))
		for function, line := range studentPickupPersonsErasureLines {
			var definition string
			if err := tx.NewRaw(`SELECT pg_get_functiondef(?::regprocedure)`, function).Scan(ctx, &definition); err != nil {
				return fmt.Errorf("read %s: %w", function, err)
			}
			if strings.Count(definition, line) != 1 {
				continue
			}
			definition = strings.Replace(definition, line, "", 1)
			definition = strings.Replace(definition, "'"+studentPickupPersonsFingerprint+"'", "'"+roomHistoryStopsFingerprint+"'", 1)
			restored = append(restored, definition)
		}
		if err := installDerivedSchoolErasureFunctions(ctx, tx, restored); err != nil {
			return fmt.Errorf("take the pickup persons out of the school erasure: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS schedule.student_pickup_persons`); err != nil {
			return fmt.Errorf("drop schedule.student_pickup_persons: %w", err)
		}
		return nil
	})
}
