package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// Proofs of benefits of the public holiday registration (#5238). Every
// statement but the retention runs in the Träger transaction of the Träger
// it names and names it once more in its filter. Only the read of one opened
// proof selects the bytes.

const (
	insertHolidayProofQuery = `INSERT INTO enrollment.holiday_registration_proofs
			(organization_id, holiday_period_id, token_hash, filename, content_type, size_bytes, content, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	// claimHolidayProofsQuery binds only unclaimed proofs of the same period
	// that are younger than the unclaimed lifetime on the owner clock that
	// stamps them. Two submissions with the same token serialize on the row
	// lock; the second binds nothing.
	claimHolidayProofsQuery = `UPDATE enrollment.holiday_registration_proofs
		SET holiday_registration_id = ?, token_hash = NULL, claimed_at = ?
		WHERE organization_id = ? AND holiday_period_id = ? AND holiday_registration_id IS NULL
			AND token_hash IN (?)
			AND created_at > ?`
	readHolidayProofsQuery = `SELECT id, filename, size_bytes, content_type, created_at
		FROM enrollment.holiday_registration_proofs
		WHERE organization_id = ? AND holiday_registration_id = ?
		ORDER BY created_at, id`
	readHolidayProofQuery = `SELECT filename, content_type, content
		FROM enrollment.holiday_registration_proofs
		WHERE organization_id = ? AND holiday_period_id = ? AND holiday_registration_id = ? AND id = ?`
	// insertClaimedHolidayProofQuery stores a proof the Träger-Büro uploads
	// as claimed by the registration at once; it never had a token.
	insertClaimedHolidayProofQuery = `INSERT INTO enrollment.holiday_registration_proofs
			(organization_id, holiday_period_id, holiday_registration_id, claimed_at, filename, content_type, size_bytes, content, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		RETURNING id`
	// deleteUnclaimedHolidayProofsQuery ages the proofs on the clock that
	// stamps and claims them, the owner's (ADR 0239, ADR 0281).
	deleteUnclaimedHolidayProofsQuery = `DELETE FROM enrollment.holiday_registration_proofs
		WHERE holiday_registration_id IS NULL AND created_at < ?`
)

// InsertHolidayProof stores an unclaimed proof of the period.
func (s *HolidayRegistrationStore) InsertHolidayProof(ctx context.Context, organizationID, periodID int64, proof enrollment.HolidayProofUpload, tokenHash string) error {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return err
	}
	if _, err := db.NewRaw(insertHolidayProofQuery, organizationID, periodID, tokenHash, proof.Filename,
		proof.ContentType, proof.SizeBytes, proof.Content, holidayNow(s.now)).Exec(ctx); err != nil {
		return fmt.Errorf("enrollment postgres: insert holiday proof: %w", err)
	}
	return nil
}

// ClaimHolidayProofs binds the listed unclaimed proofs of the period to the
// registration and reports how many it bound.
func (s *HolidayRegistrationStore) ClaimHolidayProofs(ctx context.Context, organizationID, periodID, registrationID int64, tokenHashes []string) (int, error) {
	if len(tokenHashes) == 0 {
		return 0, nil
	}
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return 0, err
	}
	now := holidayNow(s.now)
	claimed, err := affectedRows(db.NewRaw(claimHolidayProofsQuery, registrationID, now, organizationID, periodID,
		bun.List(tokenHashes), now.Add(-enrollment.UnclaimedUploadLifetime)).Exec(ctx))
	if err != nil {
		return 0, fmt.Errorf("enrollment postgres: claim holiday proofs: %w", err)
	}
	return claimed, nil
}

// InsertClaimedHolidayProof stores a proof the Träger-Büro uploads for a
// registration of the period (#5627).
func (s *HolidayRegistrationStore) InsertClaimedHolidayProof(ctx context.Context, organizationID, periodID, registrationID int64, proof enrollment.HolidayProofUpload) (int64, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return 0, err
	}
	var id int64
	now := holidayNow(s.now)
	if err := db.NewRaw(insertClaimedHolidayProofQuery, organizationID, periodID, registrationID, now, proof.Filename,
		proof.ContentType, proof.SizeBytes, proof.Content, now).Scan(ctx, &id); err != nil {
		return 0, fmt.Errorf("enrollment postgres: insert claimed holiday proof: %w", err)
	}
	return id, nil
}

// ReadHolidayProofs reads the claimed proofs of a registration without
// their bytes.
func (s *HolidayRegistrationStore) ReadHolidayProofs(ctx context.Context, organizationID, registrationID int64) ([]enrollment.HolidayRegistrationProof, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		ID          int64     `bun:"id"`
		Filename    string    `bun:"filename"`
		SizeBytes   int64     `bun:"size_bytes"`
		ContentType string    `bun:"content_type"`
		CreatedAt   time.Time `bun:"created_at"`
	}
	if err := db.NewRaw(readHolidayProofsQuery, organizationID, registrationID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("enrollment postgres: read holiday proofs: %w", err)
	}
	proofs := make([]enrollment.HolidayRegistrationProof, len(rows))
	for i, row := range rows {
		proofs[i] = enrollment.HolidayRegistrationProof{
			ID: row.ID, Filename: row.Filename, SizeBytes: row.SizeBytes, ContentType: row.ContentType, UploadedAt: row.CreatedAt,
		}
	}
	return proofs, nil
}

// ReadHolidayProof reads one claimed proof of a registration of the period
// with its bytes.
func (s *HolidayRegistrationStore) ReadHolidayProof(ctx context.Context, organizationID, periodID, registrationID, proofID int64) (enrollment.HolidayProofFile, bool, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return enrollment.HolidayProofFile{}, false, err
	}
	var rows []struct {
		Filename    string `bun:"filename"`
		ContentType string `bun:"content_type"`
		Content     []byte `bun:"content"`
	}
	if err := db.NewRaw(readHolidayProofQuery, organizationID, periodID, registrationID, proofID).Scan(ctx, &rows); err != nil {
		return enrollment.HolidayProofFile{}, false, fmt.Errorf("enrollment postgres: read holiday proof: %w", err)
	}
	if len(rows) == 0 {
		return enrollment.HolidayProofFile{}, false, nil
	}
	return enrollment.HolidayProofFile(rows[0]), true, nil
}

// DeleteUnclaimedHolidayProofs deletes, across every Träger, the proofs no
// registration claimed that are older than lifetime. Only the
// administrative transaction of the hourly cleanup may delete across Träger.
func (s *HolidayRegistrationStore) DeleteUnclaimedHolidayProofs(ctx context.Context, lifetime time.Duration) (int, error) {
	if !tenant.IsAdminTx(ctx) {
		return 0, errors.New("enrollment postgres: the holiday proof retention requires the administrative transaction")
	}
	db, err := NewDatabase()(ctx)
	if err != nil {
		return 0, err
	}
	deleted, err := affectedRows(db.NewRaw(deleteUnclaimedHolidayProofsQuery, holidayNow(s.now).Add(-lifetime)).Exec(ctx))
	if err != nil {
		return 0, fmt.Errorf("enrollment postgres: delete unclaimed holiday proofs: %w", err)
	}
	return deleted, nil
}
