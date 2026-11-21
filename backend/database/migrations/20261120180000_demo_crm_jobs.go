package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

func init() {
	MigrationRegistry.Register(&Migration{Version: "20261120180000", Description: "Leased demo CRM outbox (#7677)", DependsOn: []string{"1.15.404"}})
	Migrations.MustRegister(demoCRMJobsUp, demoCRMJobsDown)
}

func demoCRMJobsUp(ctx context.Context, db *bun.DB) error {
	_, err := db.NewRaw(`CREATE TABLE auth.demo_crm_jobs (
		id BIGSERIAL PRIMARY KEY,
		access_id BIGINT NOT NULL REFERENCES auth.demo_accesses(id) ON DELETE CASCADE,
		email TEXT NOT NULL,
		kind TEXT NOT NULL CHECK (kind IN ('requested', 'started')),
		payload JSONB NOT NULL,
		available_at TIMESTAMPTZ NOT NULL,
		attempts INTEGER NOT NULL DEFAULT 0,
		lease TEXT,
		lease_until TIMESTAMPTZ,
		UNIQUE (access_id, kind)
	);
	CREATE INDEX demo_crm_jobs_address ON auth.demo_crm_jobs (email, id);
	REVOKE ALL ON auth.demo_crm_jobs FROM PUBLIC, phoenix_auth, phoenix_tenant;
	GRANT SELECT, INSERT, UPDATE, DELETE ON auth.demo_crm_jobs TO phoenix_admin;
	GRANT USAGE ON SEQUENCE auth.demo_crm_jobs_id_seq TO phoenix_admin;`).Exec(ctx)
	return err
}

func demoCRMJobsDown(ctx context.Context, db *bun.DB) error {
	_, err := db.NewRaw(`DROP TABLE auth.demo_crm_jobs`).Exec(ctx)
	return err
}
