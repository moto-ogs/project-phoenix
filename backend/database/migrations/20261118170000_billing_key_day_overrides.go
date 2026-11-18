package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

const billingKeyDayOverridesVersion = "20261118170000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     billingKeyDayOverridesVersion,
		Description: "Eigener Stichtag der Abrechnung je Träger und je Schule (#7301)",
		DependsOn: []string{
			billingCountSequenceGrantsVersion, // the billing tables and their runtime rights
		},
	})
	Migrations.MustRegister(billingKeyDayOverridesUp, billingKeyDayOverridesDown)
}

// billingKeyDayOverridesUpSQL keeps the operator's own key day of a Träger or
// of one school (#7301). The school's day wins over its Träger's, the
// Träger's over the day in platform.billing_settings. key_day NULL is a
// row reset to the next level: the row keeps when that reset happened, so
// the capture never invents a key date that passed before the change.
// Only the operator writes it, never the Träger or the school.
//
// No foreign key points at platform.schools or platform.organizations: the
// school erasure fingerprints every edge into its plan, and a row here holds
// no school data, only a day. The write checks that the Träger or school is
// live, the reads join it, so a row of a deleted one is never used.
const billingKeyDayOverridesUpSQL = `
CREATE TABLE platform.billing_key_day_overrides (
	id BIGSERIAL PRIMARY KEY,
	organization_id BIGINT,
	school_id BIGINT,
	key_day SMALLINT CHECK (key_day BETWEEN 1 AND 28),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_by_operator_id BIGINT,
	CONSTRAINT chk_billing_key_day_overrides_one_owner
		CHECK ((organization_id IS NULL) <> (school_id IS NULL)),
	CONSTRAINT uq_billing_key_day_overrides_organization UNIQUE (organization_id),
	CONSTRAINT uq_billing_key_day_overrides_school UNIQUE (school_id)
);
COMMENT ON TABLE platform.billing_key_day_overrides IS
	'Operator billing (#7301): the key day of one Träger or one school when its contract names another day than platform.billing_settings. The school wins over its Träger. key_day NULL means reset to the next level; updated_at keeps when.';

REVOKE ALL ON platform.billing_key_day_overrides FROM PUBLIC, phoenix_auth, phoenix_tenant, phoenix_admin;
REVOKE ALL ON SEQUENCE platform.billing_key_day_overrides_id_seq FROM PUBLIC, phoenix_auth, phoenix_tenant, phoenix_admin;
GRANT SELECT, INSERT, UPDATE ON platform.billing_key_day_overrides TO phoenix_admin;
GRANT USAGE ON SEQUENCE platform.billing_key_day_overrides_id_seq TO phoenix_admin;
`

const billingKeyDayOverridesDownSQL = `DROP TABLE IF EXISTS platform.billing_key_day_overrides;`

func billingKeyDayOverridesUp(ctx context.Context, db *bun.DB) error {
	_, err := db.ExecContext(ctx, billingKeyDayOverridesUpSQL)
	return err
}

func billingKeyDayOverridesDown(ctx context.Context, db *bun.DB) error {
	_, err := db.ExecContext(ctx, billingKeyDayOverridesDownSQL)
	return err
}
