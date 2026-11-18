package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

const requestRateLimitsVersion = "20261118104943"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     requestRateLimitsVersion,
		Description: "Shared request rate limits (#7225)",
		DependsOn:   []string{fixPhoenixAuthTokenGrantsVersion},
	})
	Migrations.MustRegister(requestRateLimitsUp, requestRateLimitsDown)
}

const requestRateLimitsSQL = `
CREATE TABLE auth.request_rate_limits (
	bucket_key text PRIMARY KEY,
	tokens double precision NOT NULL,
	updated_at timestamptz NOT NULL,
	expires_at timestamptz NOT NULL DEFAULT '-infinity',
	reservations jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX request_rate_limits_cleanup ON auth.request_rate_limits (expires_at);
REVOKE ALL ON auth.request_rate_limits FROM PUBLIC, phoenix_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.request_rate_limits TO phoenix_auth;

-- Admission spends a token. An auth request also reserves one burst slot
-- until it finishes. A successful outcome refunds the token. A lost or
-- expired settlement leaves the admission charged.
-- The row lock is held for the statement only, never for the handler.
CREATE FUNCTION auth.request_rate_limit(
	p_key text, p_rate bigint, p_burst bigint, p_reservation text,
	p_settle boolean, p_spend boolean
) RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
	bucket auth.request_rate_limits%ROWTYPE;
	at_time timestamptz;
	pending integer;
BEGIN
	LOOP
		SELECT * INTO bucket FROM auth.request_rate_limits
			WHERE bucket_key = p_key FOR UPDATE;
		EXIT WHEN FOUND;
		IF p_settle THEN RETURN ''; END IF;
		INSERT INTO auth.request_rate_limits (bucket_key, tokens, updated_at)
			VALUES (p_key, p_burst, clock_timestamp())
			ON CONFLICT (bucket_key) DO NOTHING;
	END LOOP;

	at_time := greatest(clock_timestamp(), bucket.updated_at);
	SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb), count(*)
		INTO bucket.reservations, pending
		FROM jsonb_each_text(bucket.reservations)
		WHERE value::timestamptz > at_time;
	bucket.tokens := least(greatest(0, p_burst - pending), bucket.tokens +
		extract(epoch FROM at_time - bucket.updated_at) * p_rate / 60);

	IF p_settle THEN
		IF NOT (bucket.reservations ? p_reservation) THEN RETURN ''; END IF;
		bucket.reservations := bucket.reservations - p_reservation;
		IF NOT p_spend THEN
			bucket.tokens := least(p_burst - pending + 1, bucket.tokens + 1);
		END IF;
	ELSE
		IF bucket.tokens < 1 THEN RETURN ''; END IF;
		bucket.tokens := bucket.tokens - 1;
		IF NOT p_spend THEN
			p_reservation := gen_random_uuid()::text;
			bucket.reservations := bucket.reservations ||
				jsonb_build_object(p_reservation, at_time + interval '3 minutes');
		ELSE
			p_reservation := 'charged';
		END IF;
	END IF;

	UPDATE auth.request_rate_limits SET tokens = bucket.tokens,
		updated_at = at_time, reservations = bucket.reservations,
		expires_at = at_time + greatest(interval '3 minutes',
			make_interval(secs => (p_burst - bucket.tokens) * 60 / p_rate))
		WHERE bucket_key = p_key;
	RETURN p_reservation;
END;
$$;

REVOKE ALL ON FUNCTION auth.request_rate_limit(text, bigint, bigint, text, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.request_rate_limit(text, bigint, bigint, text, boolean, boolean) TO phoenix_auth;

CREATE FUNCTION auth.prune_request_rate_limits() RETURNS void
LANGUAGE sql
SET search_path = pg_catalog
AS $$
	DELETE FROM auth.request_rate_limits
	WHERE bucket_key IN (
		SELECT bucket_key FROM auth.request_rate_limits
		WHERE expires_at < statement_timestamp()
		ORDER BY expires_at LIMIT 10000
		FOR UPDATE SKIP LOCKED
	)
$$;
REVOKE ALL ON FUNCTION auth.prune_request_rate_limits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.prune_request_rate_limits() TO phoenix_auth;
`

func requestRateLimitsUp(ctx context.Context, db *bun.DB) error {
	_, err := db.ExecContext(ctx, requestRateLimitsSQL)
	return err
}

func requestRateLimitsDown(ctx context.Context, db *bun.DB) error {
	_, err := db.ExecContext(ctx, `
		DROP FUNCTION auth.prune_request_rate_limits();
		DROP FUNCTION auth.request_rate_limit(text, bigint, bigint, text, boolean, boolean);
		DROP TABLE auth.request_rate_limits;
	`)
	return err
}
