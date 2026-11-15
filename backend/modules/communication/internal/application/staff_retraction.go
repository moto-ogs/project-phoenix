package application

import (
	"context"
	"fmt"
	"log/slog"
)

// What an unpublished announcement takes back with it: the delivery matrix
// of its mails and the letters of its children (#4813). A republication
// writes both again for the corrected text.

// dropDeliveryRows removes the recipient matrix of a retracted or deleted
// announcement. A republish resolves the audience live and writes a fresh set,
// so keeping the old rows would only show a matrix for a wording parents never
// saw — and would strand recipients who have since been unlinked.
func (s *service) dropDeliveryRows(ctx context.Context, tenantID, id int64) error {
	if s.deliveries == nil {
		return nil
	}
	dropped, err := s.deliveries.DeleteForEntity(ctx, tenantID, relatedEntityTypeAnnouncement, id)
	if err != nil {
		return fmt.Errorf("announcement: drop delivery rows: %w", err)
	}
	if dropped > 0 {
		s.logger.Info("parent announcement delivery rows dropped",
			slog.Int64("announcement_id", id),
			slog.Int64("dropped", dropped),
		)
	}
	return nil
}

// dropLetterCopies removes the letters of a retracted publication.
func (s *service) dropLetterCopies(ctx context.Context, tenantID, id int64) error {
	if s.letters.Copies == nil {
		return nil
	}
	if err := s.letters.Copies.ReplaceParentLetterCopies(ctx, tenantID, id, nil); err != nil {
		return fmt.Errorf("announcement: drop letter copies: %w", err)
	}
	return nil
}
