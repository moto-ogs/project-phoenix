package application

import (
	"context"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

const (
	minPrivacyConsentRetentionDays = 1
	maxPrivacyConsentRetentionDays = 31
)

func (s *Service) ListPrivacyConsents(ctx context.Context, studentID int64) (rows []studentpresence.PrivacyConsent, err error) {
	err = s.runWrite(ctx, "list_privacy_consents", func(ctx context.Context) (ports.Stats, error) {
		if studentID <= 0 {
			return ports.Stats{}, studentpresence.ErrInvalidPrivacyConsent
		}
		var stats ports.Stats
		rows, stats, err = s.store.ListPrivacyConsents(ctx, studentID)
		return stats, err
	})
	return listResult(rows, err)
}

// RecordPrivacyConsent appends one consent row inside the caller's tenant
// transaction. The retention window and the acceptance/expiry pairing are
// validated here, the same rules the retained model enforces. The store
// assigns the identity and timestamps of the new row.
func (s *Service) RecordPrivacyConsent(ctx context.Context, value studentpresence.PrivacyConsent) (studentpresence.PrivacyConsent, error) {
	row := studentpresence.PrivacyConsent{
		StudentID: value.StudentID, PolicyVersion: value.PolicyVersion, Accepted: value.Accepted,
		AcceptedAt: value.AcceptedAt, ExpiresAt: value.ExpiresAt, DurationDays: value.DurationDays,
		RenewalRequired: value.RenewalRequired, DataRetentionDays: value.DataRetentionDays, Details: value.Details,
	}
	err := s.run("record_privacy_consent", func() (ports.Stats, error) {
		if !validPrivacyConsent(&row) {
			return ports.Stats{}, studentpresence.ErrInvalidPrivacyConsent
		}
		if err := s.tx.Require(ctx); err != nil {
			return ports.Stats{}, err
		}
		return s.store.RecordPrivacyConsent(ctx, &row)
	})
	if err != nil {
		return studentpresence.PrivacyConsent{}, err
	}
	return row, nil
}

// The data import binds the consent batch slice outside Owner (#5552).
var _ studentpresence.PrivacyConsentBatches = (*Service)(nil)

// RecordPrivacyConsents is RecordPrivacyConsent for many consents in one
// statement: each value is validated like a single record, then all are
// written or none. A batch command joins its caller's transaction and never
// opens one (ADR 0067 addendum of 2026-11-08, point 3); the data import
// observes it (record_privacy_consents), as with People Directory's
// CreatePersons.
func (s *Service) RecordPrivacyConsents(ctx context.Context, values []studentpresence.PrivacyConsent) error {
	if len(values) == 0 {
		return nil
	}
	rows := make([]studentpresence.PrivacyConsent, len(values))
	for i, value := range values {
		rows[i] = studentpresence.PrivacyConsent{
			StudentID: value.StudentID, PolicyVersion: value.PolicyVersion, Accepted: value.Accepted,
			AcceptedAt: value.AcceptedAt, ExpiresAt: value.ExpiresAt, DurationDays: value.DurationDays,
			RenewalRequired: value.RenewalRequired, DataRetentionDays: value.DataRetentionDays, Details: value.Details,
		}
		if !validPrivacyConsent(&rows[i]) {
			return studentpresence.ErrInvalidPrivacyConsent
		}
	}
	if err := s.tx.Require(ctx); err != nil {
		return err
	}
	_, err := s.store.RecordPrivacyConsents(ctx, rows)
	return err
}

func (s *Service) ListAcceptedRetentionSettings(ctx context.Context) (rows []studentpresence.StudentRetentionSetting, err error) {
	err = s.runWrite(ctx, "list_accepted_retention_settings", func(ctx context.Context) (ports.Stats, error) {
		var stats ports.Stats
		rows, stats, err = s.store.ListAcceptedRetentionSettings(ctx)
		return stats, err
	})
	return listResult(rows, err)
}

func validPrivacyConsent(row *studentpresence.PrivacyConsent) bool {
	return row != nil && row.StudentID > 0 && strings.TrimSpace(row.PolicyVersion) != "" &&
		row.DataRetentionDays >= minPrivacyConsentRetentionDays && row.DataRetentionDays <= maxPrivacyConsentRetentionDays &&
		(row.ExpiresAt == nil || row.AcceptedAt == nil || !row.ExpiresAt.Before(*row.AcceptedAt))
}

// RevisePrivacyConsent is the staff edit of a child's consent: it records or
// revises the consent of the saved policy version inside the caller's tenant
// transaction, under the student's consent lock. It is refused with
// readstate.ErrChanged when the student's consents differ from the version
// the editor read: the form always sends the accepted flag and the retention
// together, so a stale save would put back what a colleague changed.
func (s *Service) RevisePrivacyConsent(ctx context.Context, revision studentpresence.PrivacyConsentRevision) (studentpresence.RevisedPrivacyConsent, error) {
	var revised studentpresence.RevisedPrivacyConsent
	err := s.run("revise_privacy_consent", func() (stats ports.Stats, err error) {
		if revision.StudentID <= 0 {
			return ports.Stats{}, studentpresence.ErrInvalidPrivacyConsent
		}
		if err := s.tx.Require(ctx); err != nil {
			return ports.Stats{}, err
		}
		revised, stats, err = s.reviseUnderLock(ctx, revision)
		return stats, err
	})
	if err != nil {
		return studentpresence.RevisedPrivacyConsent{}, err
	}
	return revised, nil
}

// reviseUnderLock takes the student's consent lock, compares the stored
// consents with the version read, and records or revises the one consent.
func (s *Service) reviseUnderLock(ctx context.Context, revision studentpresence.PrivacyConsentRevision) (studentpresence.RevisedPrivacyConsent, ports.Stats, error) {
	stats, err := s.store.LockPrivacyConsents(ctx, revision.StudentID)
	if err != nil {
		return studentpresence.RevisedPrivacyConsent{}, stats, err
	}
	consents, listStats, err := s.store.ListPrivacyConsents(ctx, revision.StudentID)
	addStats(&stats, listStats)
	if err != nil {
		return studentpresence.RevisedPrivacyConsent{}, stats, err
	}
	if err := readstate.Check(revision.ExpectedVersion, studentpresence.PrivacyConsentVersion(consents)); err != nil {
		return studentpresence.RevisedPrivacyConsent{}, stats, err
	}
	row := revisedPolicyConsent(consents, revision, s.now())
	if !validPrivacyConsent(&row) {
		return studentpresence.RevisedPrivacyConsent{}, stats, studentpresence.ErrInvalidPrivacyConsent
	}
	writeStats, err := s.writeConsent(ctx, &row)
	addStats(&stats, writeStats)
	if err != nil {
		return studentpresence.RevisedPrivacyConsent{}, stats, err
	}
	consents = upsertConsent(consents, row)
	return studentpresence.RevisedPrivacyConsent{Consent: row, Version: studentpresence.PrivacyConsentVersion(consents)}, stats, nil
}

// writeConsent records a consent that has no row yet and revises the others.
func (s *Service) writeConsent(ctx context.Context, row *studentpresence.PrivacyConsent) (ports.Stats, error) {
	if row.ID == 0 {
		return s.store.RecordPrivacyConsent(ctx, row)
	}
	return s.store.RevisePrivacyConsent(ctx, row)
}

// revisedPolicyConsent is the newest consent of the saved policy version
// with the edit applied, or a new one. Acceptance stamping and expiry derivation
// are the owner's consent lifecycle (issue #586, Rule 12).
func revisedPolicyConsent(consents []studentpresence.PrivacyConsent, save studentpresence.PrivacyConsentRevision, now time.Time) studentpresence.PrivacyConsent {
	consent := studentpresence.PrivacyConsent{StudentID: save.StudentID}
	var newest *studentpresence.PrivacyConsent
	for i, c := range consents {
		if c.PolicyVersion == save.PolicyVersion && (newest == nil || c.CreatedAt.After(newest.CreatedAt)) {
			newest = &consents[i]
		}
	}
	if newest != nil {
		consent = *newest
	}
	consent.PolicyVersion = save.PolicyVersion
	consent.Accepted = save.Accepted
	consent.DurationDays = save.DurationDays
	consent.DataRetentionDays = save.DataRetentionDays
	consent.Details = save.Details
	if save.Accepted && consent.AcceptedAt == nil {
		return studentpresence.AcceptPrivacyConsent(consent, now)
	}
	return studentpresence.DerivePrivacyConsentExpiry(consent)
}

// upsertConsent is the list with row in place of the stored row of its ID,
// or added when it is new.
func upsertConsent(consents []studentpresence.PrivacyConsent, row studentpresence.PrivacyConsent) []studentpresence.PrivacyConsent {
	for i := range consents {
		if consents[i].ID == row.ID {
			consents[i] = row
			return consents
		}
	}
	return append(consents, row)
}
