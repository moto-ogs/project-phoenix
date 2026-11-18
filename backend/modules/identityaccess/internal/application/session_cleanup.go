package application

import (
	"context"
	"log/slog"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/ports"
)

// CountExpiredTokens reports how many refresh sessions a cleanup would
// remove, across every school.
func (s *AccountAuthentication) CountExpiredTokens(ctx context.Context) (int, error) {
	return runFlow(ctx, s.flow(), func(ctx context.Context) (int, error) {
		count, err := s.sessions.CountExpiredAccountSessions(ctx)
		if err != nil {
			return 0, failed("count expired tokens", err)
		}
		return count, nil
	})
}

// CleanupExpiredTokens removes expired refresh sessions and then reconciles
// revocations whose after-commit follow-up did not complete.
func (s *AccountAuthentication) cleanupExpiredTokens(ctx context.Context) (int, error) {
	count, err := s.sessions.DeleteExpiredAccountSessions(ctx)
	if err != nil {
		return 0, failed("cleanup expired tokens", err)
	}
	if recErr := s.reconcileRevokedSessions(ctx); recErr != nil {
		s.logger.Warn("revocation follow-up reconciliation failed",
			slog.Any("error", recErr))
	}
	return count, nil
}

// reconcileRevokedSessions finishes account-wide wipes, then scans orphaned
// push subscriptions in bounded administrative transactions. The first
// transaction preserves the existing reconciliation of pending wipes.
func (s *AccountAuthentication) reconcileRevokedSessions(ctx context.Context) error {
	ctx = s.runtime.WithoutTransaction(ctx)
	var afterID int64
	for {
		var nextID int64
		err := s.runtime.WithAdminTx(ctx, func(adminCtx context.Context) error {
			if afterID == 0 {
				if err := s.reconcileAccountWideWipes(adminCtx); err != nil {
					return err
				}
			}
			var err error
			nextID, err = s.deleteOrphanedPush(adminCtx, afterID)
			return err
		})
		if err != nil || nextID == 0 {
			return err
		}
		afterID = nextID
	}
}

func (s *AccountAuthentication) reconcileAccountWideWipes(adminCtx context.Context) error {
	seen, err := s.reconcileInactiveSessions(adminCtx)
	if err != nil {
		return err
	}
	pending, err := s.audit.ListPendingAccountWideWipes(adminCtx)
	if err != nil {
		return err
	}
	for _, wipe := range pending {
		if _, already := seen[wipe.AccountID]; already {
			continue
		}
		reason := wipe.Reason
		if !domain.IsAccountWideRevocation(reason) {
			reason = "administrative_revoke"
		}
		if err := s.finishScheduledAccountWideWipe(adminCtx, wipe.AccountID, reason, "", "", true); err != nil {
			return err
		}
	}
	return nil
}

// deleteOrphanedPush sweeps one page inside the caller's admin transaction
// and returns the last subscription ID if another page may exist.
func (s *AccountAuthentication) deleteOrphanedPush(adminCtx context.Context, afterID int64) (int64, error) {
	const batchSize = 250
	links, err := s.push.ListLinks(adminCtx, afterID, batchSize)
	if err != nil || len(links) == 0 {
		return 0, err
	}
	if err := s.deleteOrphanedPushBatch(adminCtx, links); err != nil {
		return 0, err
	}
	if len(links) < batchSize {
		return 0, nil
	}
	return links[len(links)-1].SubscriptionID, nil
}

func (s *AccountAuthentication) deleteOrphanedPushBatch(adminCtx context.Context, links []identityaccess.PushSubscriptionLink) error {
	sessionLinks := make([]domain.PushSubscriptionLink, len(links))
	for i, link := range links {
		sessionLinks[i] = domain.PushSubscriptionLink(link)
	}
	protected, err := s.sessions.protectedPushSubscriptionLinks(adminCtx, sessionLinks)
	if err != nil {
		return err
	}
	orphaned := make([]identityaccess.PushSubscriptionLink, 0, len(links))
	for _, link := range links {
		if !protected[link.SubscriptionID] {
			orphaned = append(orphaned, link)
		}
	}
	return s.push.DeleteLinks(adminCtx, orphaned)
}

// ListActiveSessions returns the account's live refresh sessions in the
// caller's tenant scope.
func (s *AccountAuthentication) ListActiveSessions(ctx context.Context, accountID int64) ([]identityaccess.ActiveSession, error) {
	return runFlow(ctx, s.flow(), func(ctx context.Context) ([]identityaccess.ActiveSession, error) {
		sessions, err := s.sessions.ListAccountSessions(ctx, ports.AccountSessionFilter{AccountID: accountID, Liveness: ports.AccountSessionsLive})
		if err != nil {
			return nil, failed("get active tokens", err)
		}
		active := make([]identityaccess.ActiveSession, 0, len(sessions))
		for _, session := range sessions {
			active = append(active, identityaccess.ActiveSession{
				ID: session.ID, Expiry: session.Expiry, Mobile: session.Mobile, Identifier: session.Identifier, CreatedAt: session.CreatedAt,
			})
		}
		return active, nil
	})
}

// ListSessionIDs returns the identifiers of every session of the account in
// the caller's tenant scope, for revision fingerprints.
func (s *AccountAuthentication) ListSessionIDs(ctx context.Context, accountID int64) ([]int64, error) {
	return runFlow(ctx, s.flow(), func(ctx context.Context) ([]int64, error) {
		sessions, err := s.sessions.ListAccountSessions(ctx, ports.AccountSessionFilter{AccountID: accountID})
		if err != nil {
			return nil, err
		}
		ids := make([]int64, 0, len(sessions))
		for _, session := range sessions {
			ids = append(ids, session.ID)
		}
		return ids, nil
	})
}

func (s *AccountAuthentication) reconcileInactiveSessions(adminCtx context.Context) (map[int64]struct{}, error) {
	seen := map[int64]struct{}{}
	inactive, err := s.sessions.ListInactiveAccountIDsWithLiveSessions(adminCtx)
	if err != nil {
		return nil, err
	}
	for _, id := range inactive {
		if id > 0 {
			seen[id] = struct{}{}
		}
	}
	for accountID := range seen {
		if err := s.wipeAccountWideIndependently(adminCtx, accountID, "account_deactivated", "", ""); err != nil {
			return nil, err
		}
	}
	return seen, nil
}
