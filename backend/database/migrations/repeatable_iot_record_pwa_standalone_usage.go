package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

func init() {
	RegisterRepeatable("iot.record_pwa_standalone_usage", func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, repeatableIotRecordPWAStandaloneUsageSQL)
		return err
	})
}

// repeatableIotRecordPWAStandaloneUsageSQL is the current definition of
// iot.record_pwa_standalone_usage(...) (ADR 0223), the only way the tenant
// role writes a PWA usage report (#2644). The caller passes the instant of the
// report (ADR 0277): the retention cutoff and the usage window that read
// last_seen_at come from the same clock as the Go service, so the database's
// NOW() may not stamp it. Migration 1.15.343 created the three-argument
// version without that instant; it is dropped here.
const repeatableIotRecordPWAStandaloneUsageSQL = `DROP FUNCTION IF EXISTS iot.record_pwa_standalone_usage(BIGINT, BIGINT, TEXT);

CREATE OR REPLACE FUNCTION iot.record_pwa_standalone_usage(
	p_tenant_id BIGINT,
	p_account_id BIGINT,
	p_portal TEXT,
	p_seen_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, iot
AS $$
BEGIN
	IF p_tenant_id IS DISTINCT FROM NULLIF(current_setting('app.current_tenant_id', true), '')::BIGINT THEN
		RAISE EXCEPTION 'PWA usage tenant does not match transaction tenant' USING ERRCODE = '42501';
	END IF;
	IF p_seen_at IS NULL THEN
		RAISE EXCEPTION 'PWA usage needs the instant of the report' USING ERRCODE = '22004';
	END IF;
	INSERT INTO iot.pwa_standalone_usage (tenant_id, account_id, portal, first_seen_at, last_seen_at)
	VALUES (p_tenant_id, p_account_id, p_portal, p_seen_at, p_seen_at)
	ON CONFLICT (tenant_id, account_id, portal) DO UPDATE
	SET last_seen_at = EXCLUDED.last_seen_at, updated_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION iot.record_pwa_standalone_usage(BIGINT, BIGINT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iot.record_pwa_standalone_usage(BIGINT, BIGINT, TEXT, TIMESTAMPTZ) TO phoenix_tenant;
`
