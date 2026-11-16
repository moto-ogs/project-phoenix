package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

const billingCountSequenceGrantsVersion = "20261116091743"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     billingCountSequenceGrantsVersion,
		Description: "Sequenzen der Abrechnungszahlen und PWA-Nutzung ohne Rechte der Laufzeitrollen (#7210)",
		DependsOn: []string{
			schoolErasureVersion,           // the SECURITY DEFINER writer of the billing figures
			pwaUsageWriteCapabilityVersion, // the SECURITY DEFINER writer of the PWA usage
		},
	})
	Migrations.MustRegister(billingCountSequenceGrantsUp, billingCountSequenceGrantsDown)
}

// billingCountSequenceGrantsUpSQL takes every right on two sequences from
// the runtime roles (#7210, #4845). Their tables are written only by
// SECURITY DEFINER functions, which draw the IDs with their owner's rights:
// the billing figures by platform.capture_billing_key_date_counts(...)
// since 1.15.481, the PWA usage by iot.record_pwa_standalone_usage(...)
// since 1.15.343. No runtime role may insert into either table. The rights
// the 1.14.1 default privileges and the table migrations left (USAGE,
// SELECT, UPDATE) let a role move the sequence with setval, so the next
// write could collide with a kept row.
const billingCountSequenceGrantsUpSQL = `
REVOKE ALL ON SEQUENCE platform.billing_key_date_counts_id_seq, iot.pwa_standalone_usage_id_seq
	FROM phoenix_admin, phoenix_tenant, phoenix_auth, PUBLIC;
`

// billingCountSequenceGrantsDownSQL restores the rights the roles held.
const billingCountSequenceGrantsDownSQL = `
GRANT USAGE, SELECT, UPDATE ON SEQUENCE platform.billing_key_date_counts_id_seq, iot.pwa_standalone_usage_id_seq TO phoenix_admin;
GRANT USAGE ON SEQUENCE iot.pwa_standalone_usage_id_seq TO phoenix_tenant;
`

func billingCountSequenceGrantsUp(ctx context.Context, db *bun.DB) error {
	_, err := db.ExecContext(ctx, billingCountSequenceGrantsUpSQL)
	return err
}

func billingCountSequenceGrantsDown(ctx context.Context, db *bun.DB) error {
	_, err := db.ExecContext(ctx, billingCountSequenceGrantsDownSQL)
	return err
}
