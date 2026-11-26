package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const careContractAmendmentSignaturesVersion = "20261126114747"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     careContractAmendmentSignaturesVersion,
		Description: "Betreuungsvertrag: Eltern unterschreiben die geänderte Vertragsfassung (#4816)",
		DependsOn: []string{
			careContractAmendmentsVersion, // the timeline of the versions (#4681)
			careContractSignaturesVersion, // signatures, links and reminders (#4679)
			careContractFamiliesVersion,   // the newest care contract migration
		},
	})
	Migrations.MustRegister(careContractAmendmentSignaturesUp, careContractAmendmentSignaturesDown)
}

// careContractAmendmentSignaturesUpSQL lets a changed version of a contract
// wait for the parents' signature (#4816, ADR 0088 sections 2 and 3):
//
//   - A changed version the parents did not ask for themselves is stored as
//     beantragt and holds on no day. Their signature moves it into the
//     timeline: wirksam as the newest version, abgeloest before a planned
//     one, and the version starting on its day becomes ersetzt, the steps of
//     1.15.787. At most one version of a contract waits (the partial unique
//     index); the timeline trigger checks the step when the status changes.
//   - A waiting version that a newer one overtakes, or whose change the
//     school took back, becomes ueberholt: it stays in the history, holds on
//     no day and is never signed.
//   - The version of a contract that is not concluded yet follows the
//     approved bookings too: the sent version becomes ueberholt and a new
//     one waits. It is the first version the parents agree to, so it may
//     name a day in the past as the first version does. The timeline
//     trigger of 1.15.787 therefore no longer takes the version number for
//     "a later version": no version starts in the past once the contract
//     has had a version in force.
//   - agreed_from keeps the effective date the signed document names when
//     the signature came after that day. The version then holds from the day
//     of the signature (no version reaches into the past), and the checksum
//     of the signed version still counts the date the parents read. The
//     request role may write both dates only in that one step, the
//     signature of a waiting version (guard_version_dates): a date changed
//     in place would reorder signed periods past the timeline trigger.
//   - A signature of the method request records the parents' own request
//     for the change, approved by the school: the request is the proof, no
//     drawn or typed signature exists. change_request_id names Care Plan's
//     request in the contract's school; it is no foreign key, the request
//     lives in the school's tenant.
//   - enrollment.offering_change_requests.submitted_at is when the parents
//     last sent their request, its creation or their last edit: the instant
//     the request counts as their signature. created_at stays the first
//     submission, updated_at also moves with the school's decision.
//   - A reminder belongs to the version that waits, so a changed version is
//     reminded anew, up to the same limit. Every reminder so far reminded of
//     the first version: only a sent contract was reminded.
const careContractAmendmentSignaturesUpSQL = `
ALTER TABLE care_contract.contract_versions ADD COLUMN IF NOT EXISTS agreed_from DATE;
ALTER TABLE care_contract.contract_versions DROP CONSTRAINT IF EXISTS chk_contract_versions_agreed_from;
ALTER TABLE care_contract.contract_versions ADD CONSTRAINT chk_contract_versions_agreed_from
	CHECK (agreed_from IS NULL OR agreed_from < effective_from);
COMMENT ON COLUMN care_contract.contract_versions.agreed_from IS
	'Effective date the signed document names when the signature came later and the version holds from the day of the signature (#4816).';
GRANT UPDATE (effective_from, agreed_from) ON care_contract.contract_versions TO phoenix_tenant;
CREATE OR REPLACE FUNCTION care_contract.guard_version_dates() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF current_user = 'phoenix_tenant'
		AND (NEW.effective_from IS DISTINCT FROM OLD.effective_from OR NEW.agreed_from IS DISTINCT FROM OLD.agreed_from)
		AND NOT (OLD.status = 'beantragt' AND NEW.status IN ('wirksam', 'abgeloest')) THEN
		RAISE EXCEPTION 'care contract version % keeps its effective date', OLD.id
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_care_contract_version_dates ON care_contract.contract_versions;
CREATE TRIGGER guard_care_contract_version_dates
	BEFORE UPDATE OF effective_from, agreed_from ON care_contract.contract_versions
	FOR EACH ROW EXECUTE FUNCTION care_contract.guard_version_dates();

ALTER TABLE care_contract.contract_versions DROP CONSTRAINT chk_contract_versions_status;
ALTER TABLE care_contract.contract_versions ADD CONSTRAINT chk_contract_versions_status
	CHECK (status IN ('beantragt', 'wirksam', 'abgeloest', 'abgelehnt', 'ersetzt', 'ueberholt'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_versions_requested ON care_contract.contract_versions (contract_id)
	WHERE status = 'beantragt';

CREATE OR REPLACE FUNCTION care_contract.guard_version_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
		(OLD.status = 'beantragt' AND NEW.status IN ('wirksam', 'abgeloest', 'abgelehnt', 'ueberholt'))
		OR (OLD.status = 'wirksam' AND NEW.status IN ('abgeloest', 'ersetzt'))
		OR (OLD.status = 'abgeloest' AND NEW.status = 'ersetzt')) THEN
		RAISE EXCEPTION 'care contract version % cannot move from % to %', OLD.id, OLD.status, NEW.status
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION care_contract.guard_version_timeline() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.status IN ('wirksam', 'abgeloest')
		AND (TG_OP = 'INSERT' OR OLD.status NOT IN ('wirksam', 'abgeloest')) THEN
		IF NEW.status = 'wirksam' AND EXISTS (SELECT 1 FROM care_contract.contract_versions AS v
			WHERE v.organization_id = NEW.organization_id AND v.contract_id = NEW.contract_id AND v.id <> NEW.id
				AND v.status IN ('wirksam', 'abgeloest') AND v.effective_from >= NEW.effective_from) THEN
			RAISE EXCEPTION 'care contract version of contract % must start after every effective version', NEW.contract_id
				USING ERRCODE = 'check_violation';
		END IF;
		IF NEW.status = 'abgeloest' AND NOT EXISTS (SELECT 1 FROM care_contract.contract_versions AS v
			WHERE v.organization_id = NEW.organization_id AND v.contract_id = NEW.contract_id AND v.id <> NEW.id
				AND v.status IN ('wirksam', 'abgeloest') AND v.effective_from > NEW.effective_from) THEN
			RAISE EXCEPTION 'care contract version of contract % inserted as superseded needs a later effective version', NEW.contract_id
				USING ERRCODE = 'check_violation';
		END IF;
		IF EXISTS (SELECT 1 FROM care_contract.contract_versions AS v
			WHERE v.organization_id = NEW.organization_id AND v.contract_id = NEW.contract_id AND v.id <> NEW.id
				AND v.status IN ('wirksam', 'abgeloest', 'ersetzt')) AND NEW.effective_from < (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Berlin')::date THEN
			RAISE EXCEPTION 'care contract version of contract % cannot take effect in the past', NEW.contract_id
				USING ERRCODE = 'check_violation';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;

ALTER TABLE care_contract.contract_signatures ADD COLUMN IF NOT EXISTS change_request_id BIGINT;
COMMENT ON COLUMN care_contract.contract_signatures.change_request_id IS
	'Care Plan request of the parents that counts as the signature of the version (#4816); set for the method request only.';
ALTER TABLE care_contract.contract_signatures DROP CONSTRAINT chk_contract_signatures_method;
ALTER TABLE care_contract.contract_signatures ADD CONSTRAINT chk_contract_signatures_method
	CHECK (method IN ('drawn', 'typed', 'paper', 'request'));
ALTER TABLE care_contract.contract_signatures DROP CONSTRAINT chk_contract_signatures_proof;
ALTER TABLE care_contract.contract_signatures ADD CONSTRAINT chk_contract_signatures_proof CHECK (
	(method IN ('drawn', 'typed') AND channel IN ('parent_account', 'mail_link') AND audit_signature_id IS NOT NULL
		AND contract_document_id IS NOT NULL AND paper_pdf IS NULL AND withdrawal_notice_at IS NOT NULL
		AND change_request_id IS NULL)
	OR (method = 'paper' AND channel = 'office' AND audit_signature_id IS NULL AND paper_pdf IS NOT NULL
		AND paper_pdf_sha256 IS NOT NULL AND change_request_id IS NULL)
	OR (method = 'request' AND channel = 'parent_account' AND audit_signature_id IS NULL AND paper_pdf IS NULL
		AND contract_document_id IS NOT NULL AND change_request_id IS NOT NULL));

ALTER TABLE enrollment.offering_change_requests ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
UPDATE enrollment.offering_change_requests SET submitted_at = created_at WHERE submitted_at IS NULL;
ALTER TABLE enrollment.offering_change_requests ALTER COLUMN submitted_at SET DEFAULT NOW();
ALTER TABLE enrollment.offering_change_requests ALTER COLUMN submitted_at SET NOT NULL;
COMMENT ON COLUMN enrollment.offering_change_requests.submitted_at IS
	'When the parents last sent the request: its creation or their last edit (#4816). The instant their request counts as the signature of the contract version it made.';

ALTER TABLE care_contract.contract_reminders ADD COLUMN IF NOT EXISTS contract_version_id BIGINT;
UPDATE care_contract.contract_reminders AS r SET contract_version_id = (
	SELECT v.id FROM care_contract.contract_versions AS v
	WHERE v.organization_id = r.organization_id AND v.contract_id = r.contract_id
	ORDER BY v.version_number LIMIT 1)
	WHERE r.contract_version_id IS NULL;
ALTER TABLE care_contract.contract_reminders ALTER COLUMN contract_version_id SET NOT NULL;
ALTER TABLE care_contract.contract_reminders DROP CONSTRAINT IF EXISTS fk_contract_reminders_version;
ALTER TABLE care_contract.contract_reminders ADD CONSTRAINT fk_contract_reminders_version
	FOREIGN KEY (organization_id, contract_version_id)
	REFERENCES care_contract.contract_versions (organization_id, id) ON DELETE CASCADE;
ALTER TABLE care_contract.contract_reminders DROP CONSTRAINT IF EXISTS uq_contract_reminders_number;
ALTER TABLE care_contract.contract_reminders ADD CONSTRAINT uq_contract_reminders_number
	UNIQUE (contract_version_id, reminder_number);
CREATE INDEX IF NOT EXISTS idx_contract_reminders_contract ON care_contract.contract_reminders (organization_id, contract_id);
COMMENT ON COLUMN care_contract.contract_reminders.contract_version_id IS
	'Version the reminder asked a signature for (#4816): a changed version is reminded anew.';
`

// careContractAmendmentSignaturesDownSQL takes the waiting changes back: a
// changed version that never took effect goes, with the proofs of the
// parents' requests, and the reminders count per contract again. A version
// signed late keeps the day it holds from. The status guard is paused for
// the repair, as in 1.15.787.
const careContractAmendmentSignaturesDownSQL = `
DELETE FROM care_contract.contract_reminders AS r USING care_contract.contract_versions AS v
	WHERE v.organization_id = r.organization_id AND v.id = r.contract_version_id AND v.version_number > 1;
DROP INDEX IF EXISTS care_contract.idx_contract_reminders_contract;
ALTER TABLE care_contract.contract_reminders DROP CONSTRAINT IF EXISTS uq_contract_reminders_number;
ALTER TABLE care_contract.contract_reminders DROP CONSTRAINT IF EXISTS fk_contract_reminders_version;
ALTER TABLE care_contract.contract_reminders DROP COLUMN IF EXISTS contract_version_id;
ALTER TABLE care_contract.contract_reminders ADD CONSTRAINT uq_contract_reminders_number UNIQUE (contract_id, reminder_number);

ALTER TABLE enrollment.offering_change_requests DROP COLUMN IF EXISTS submitted_at;
DELETE FROM care_contract.contract_signatures WHERE method = 'request';
ALTER TABLE care_contract.contract_signatures DROP CONSTRAINT chk_contract_signatures_proof;
ALTER TABLE care_contract.contract_signatures DROP CONSTRAINT chk_contract_signatures_method;
ALTER TABLE care_contract.contract_signatures DROP COLUMN IF EXISTS change_request_id;
ALTER TABLE care_contract.contract_signatures ADD CONSTRAINT chk_contract_signatures_method
	CHECK (method IN ('drawn', 'typed', 'paper'));
ALTER TABLE care_contract.contract_signatures ADD CONSTRAINT chk_contract_signatures_proof CHECK (
	(method IN ('drawn', 'typed') AND channel IN ('parent_account', 'mail_link') AND audit_signature_id IS NOT NULL
		AND contract_document_id IS NOT NULL AND paper_pdf IS NULL AND withdrawal_notice_at IS NOT NULL)
	OR (method = 'paper' AND channel = 'office' AND audit_signature_id IS NULL AND paper_pdf IS NOT NULL
		AND paper_pdf_sha256 IS NOT NULL));

DELETE FROM care_contract.contract_versions AS v USING care_contract.contracts AS c
	WHERE c.organization_id = v.organization_id AND c.id = v.contract_id
		AND (v.status = 'ueberholt' OR (v.status = 'beantragt' AND c.status = 'aktiv'));
DROP INDEX IF EXISTS care_contract.uq_contract_versions_requested;
CREATE OR REPLACE FUNCTION care_contract.guard_version_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
		(OLD.status = 'beantragt' AND NEW.status IN ('wirksam', 'abgelehnt'))
		OR (OLD.status = 'wirksam' AND NEW.status IN ('abgeloest', 'ersetzt'))
		OR (OLD.status = 'abgeloest' AND NEW.status = 'ersetzt')) THEN
		RAISE EXCEPTION 'care contract version % cannot move from % to %', OLD.id, OLD.status, NEW.status
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION care_contract.guard_version_timeline() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.status IN ('wirksam', 'abgeloest')
		AND (TG_OP = 'INSERT' OR OLD.status NOT IN ('wirksam', 'abgeloest')) THEN
		IF NEW.status = 'wirksam' AND EXISTS (SELECT 1 FROM care_contract.contract_versions AS v
			WHERE v.organization_id = NEW.organization_id AND v.contract_id = NEW.contract_id AND v.id <> NEW.id
				AND v.status IN ('wirksam', 'abgeloest') AND v.effective_from >= NEW.effective_from) THEN
			RAISE EXCEPTION 'care contract version of contract % must start after every effective version', NEW.contract_id
				USING ERRCODE = 'check_violation';
		END IF;
		IF NEW.status = 'abgeloest' AND NOT EXISTS (SELECT 1 FROM care_contract.contract_versions AS v
			WHERE v.organization_id = NEW.organization_id AND v.contract_id = NEW.contract_id AND v.id <> NEW.id
				AND v.status IN ('wirksam', 'abgeloest') AND v.effective_from > NEW.effective_from) THEN
			RAISE EXCEPTION 'care contract version of contract % inserted as superseded needs a later effective version', NEW.contract_id
				USING ERRCODE = 'check_violation';
		END IF;
		IF NEW.version_number > 1 AND NEW.effective_from < (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Berlin')::date THEN
			RAISE EXCEPTION 'care contract version of contract % cannot take effect in the past', NEW.contract_id
				USING ERRCODE = 'check_violation';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;
ALTER TABLE care_contract.contract_versions DROP CONSTRAINT chk_contract_versions_status;
ALTER TABLE care_contract.contract_versions ADD CONSTRAINT chk_contract_versions_status
	CHECK (status IN ('beantragt', 'wirksam', 'abgeloest', 'abgelehnt', 'ersetzt'));
DROP TRIGGER IF EXISTS guard_care_contract_version_dates ON care_contract.contract_versions;
DROP FUNCTION IF EXISTS care_contract.guard_version_dates();
REVOKE UPDATE (effective_from, agreed_from) ON care_contract.contract_versions FROM phoenix_tenant;
ALTER TABLE care_contract.contract_versions DROP CONSTRAINT IF EXISTS chk_contract_versions_agreed_from;
ALTER TABLE care_contract.contract_versions DROP COLUMN IF EXISTS agreed_from;
`

func careContractAmendmentSignaturesUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractAmendmentSignaturesUpSQL); err != nil {
		return fmt.Errorf("add care contract amendment signatures: %w", err)
	}
	return nil
}

func careContractAmendmentSignaturesDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractAmendmentSignaturesDownSQL); err != nil {
		return fmt.Errorf("drop care contract amendment signatures: %w", err)
	}
	return nil
}
