package postgres

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
)

func (s *Store) QueueDemoCRM(ctx context.Context, access domain.DemoAccess, at time.Time, started bool) error {
	db, err := s.database(ctx)
	if err != nil {
		return err
	}
	if !access.ContactOptIn {
		if started {
			return nil
		}
		_, err = db.NewRaw(`DELETE FROM auth.demo_crm_jobs WHERE email = ?`, access.Email).Exec(ctx)
		return err
	}
	contact := domain.DemoCRMContact{Email: access.Email, FirstName: access.FirstName, LastName: access.LastName,
		SchoolName: access.SchoolName, Source: access.Source, AccessID: strconv.FormatInt(access.ID, 10),
		ContactOptIn: true, RequestedAt: access.CreatedAt, Phone: access.Phone}
	kind := "requested"
	if started {
		kind = "started"
		contact.StartedAt = at
		contact.Phone = ""
	}
	payload, err := json.Marshal(contact)
	if err != nil {
		return err
	}
	_, err = db.NewRaw(`INSERT INTO auth.demo_crm_jobs (access_id, email, kind, payload, available_at)
		VALUES (?, ?, ?, ?::jsonb, ?) ON CONFLICT (access_id, kind) DO NOTHING`, access.ID, access.Email, kind, string(payload), at).Exec(ctx)
	return err
}

func (s *Store) ClaimDemoCRM(ctx context.Context, at time.Time) (domain.DemoCRMJob, bool, error) {
	db, err := s.database(ctx)
	if err != nil {
		return domain.DemoCRMJob{}, false, err
	}
	var rows []struct {
		ID       int64
		Lease    string
		Attempts int
		Payload  json.RawMessage
	}
	err = db.NewRaw(`WITH candidate AS (
		SELECT j.id FROM auth.demo_crm_jobs j
		WHERE j.available_at <= ? AND (j.lease_until IS NULL OR j.lease_until <= ?)
		AND NOT EXISTS (SELECT 1 FROM auth.demo_crm_jobs earlier WHERE earlier.email = j.email AND earlier.id < j.id)
		ORDER BY j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1
	) UPDATE auth.demo_crm_jobs j SET lease = gen_random_uuid()::text, lease_until = ?, attempts = attempts + 1
	FROM candidate WHERE j.id = candidate.id RETURNING j.id, j.lease, j.attempts, j.payload`, at, at, at.Add(time.Minute)).Scan(ctx, &rows)
	if err != nil || len(rows) == 0 {
		return domain.DemoCRMJob{}, false, err
	}
	row := rows[0]
	job := domain.DemoCRMJob{ID: row.ID, Lease: row.Lease, Attempts: row.Attempts}
	err = json.Unmarshal(row.Payload, &job.Contact)
	return job, true, err
}

func (s *Store) DemoCRMAuthorized(ctx context.Context, job domain.DemoCRMJob, at time.Time) (bool, error) {
	db, err := s.database(ctx)
	if err != nil {
		return false, err
	}
	var allowed bool
	err = db.NewRaw(`SELECT EXISTS (SELECT 1 FROM auth.demo_crm_jobs j
		WHERE j.id = ? AND j.lease = ? AND j.lease_until > ?
		AND EXISTS (SELECT 1 FROM auth.demo_accesses source WHERE source.id = j.access_id AND source.expires_at > ?)
		AND COALESCE((SELECT a.contact_opt_in FROM auth.demo_accesses a WHERE a.email = j.email AND a.expires_at > ? ORDER BY a.id DESC LIMIT 1), false))`,
		job.ID, job.Lease, at, at, at).Scan(ctx, &allowed)
	return allowed, err
}

func (s *Store) FinishDemoCRM(ctx context.Context, job domain.DemoCRMJob, next time.Time, terminal bool) error {
	db, err := s.database(ctx)
	if err != nil {
		return err
	}
	if terminal {
		_, err = db.NewRaw(`DELETE FROM auth.demo_crm_jobs WHERE id = ? AND lease = ?`, job.ID, job.Lease).Exec(ctx)
	} else {
		_, err = db.NewRaw(`UPDATE auth.demo_crm_jobs SET available_at = ?, lease = NULL, lease_until = NULL WHERE id = ? AND lease = ?`, next, job.ID, job.Lease).Exec(ctx)
	}
	return err
}
