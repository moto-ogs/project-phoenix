package ports

import (
	"context"
	"encoding/json"
	"time"

	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/domain"
)

type Store interface {
	Enqueue(context.Context, domain.Intent) (domain.Enqueued, error)
	Claim(context.Context, domain.Transport, int, time.Time, time.Time) ([]domain.Intent, error)
	// StartDelivery atomically advances a claimed intent to its durable dispatch
	// fence. A cancellation that commits first prevents the provider call; once
	// the fence is committed, the provider call has logically begun.
	StartDelivery(context.Context, domain.Transport, int64, string, time.Time) (string, bool, error)
	// DeadLetterExpiredDispatches ends dispatch fences that expired without
	// finalization. Their provider outcome is unknown, so they are never retried.
	DeadLetterExpiredDispatches(context.Context, domain.Transport, time.Time) (int64, error)
	FinalizeSent(context.Context, domain.Transport, int64, string, json.RawMessage, time.Time) (bool, error)
	FinalizeCancelled(context.Context, domain.Transport, int64, string, string, time.Time) (bool, error)
	FinalizeDeferred(context.Context, domain.Transport, int64, string, string, time.Time) (bool, error)
	FinalizeFailure(context.Context, domain.Transport, int64, string, int, string, time.Time, int) (domain.FinalizeResult, error)
	Cancel(context.Context, int64, domain.Transport, string, int64, string, time.Time) (int64, error)
	Statuses(context.Context, int64, domain.Transport, string, int64) ([]domain.Intent, error)
	TraegerEmailStatuses(context.Context, int64, string, int64) ([]domain.Intent, error)
	TraegerEmailStatusesByKey(context.Context, int64, []string) ([]domain.Intent, error)
	TraegerEmailStatusesOf(context.Context, int64, string, []int64, []string) ([]domain.Intent, error)
	RetryFailedTraegerEmails(context.Context, int64, []string) (int64, error)
	UnresolvedHolidayClosureEmails(context.Context, int64) ([]domain.Intent, error)
	EmailStatus(context.Context, int64, int64) (domain.Intent, bool, error)
	Backlog(context.Context) (int, error)
	OldestPendingAge(context.Context, time.Time) (time.Duration, error)
	ReplaceEmailDeliveries(context.Context, int64, string, int64, []domain.EmailDelivery) error
	DeleteEmailDeliveries(context.Context, int64, string, int64) (int64, error)
	EmailDeliveryStatuses(context.Context, int64, string, int64) ([]deliveryContract.EmailDeliveryStatus, error)
	AttachEmailOutbox(context.Context, int64, int64, int64) error
	ClaimFailedEmailDelivery(context.Context, int64, int64) (bool, error)
}

type Provider interface {
	Send(context.Context, domain.Intent) (deliveryContract.ProviderResult, error)
}

type GuardianDirectory interface {
	ResolveGuardianDisplays(context.Context, []int64) ([]deliveryContract.GuardianDisplay, error)
}

type Observer func(domain.Observation)

// RetentionStore deletes the delivery data of one school whose retention
// window ended before the instant (#3955). Every statement runs on the
// school's tenant transaction.
type RetentionStore interface {
	// DeleteExpiredEmailDeliveryEvents removes the events of the mails that
	// ended before the instant, including those of cleared key-only mails.
	DeleteExpiredEmailDeliveryEvents(ctx context.Context, tenantID int64, before time.Time) (int, error)
	// DeleteUnheldEmailSuppressions removes marked addresses the school no
	// longer knows: no guardian with a child in care, no staff or other account
	// and no open application holds them (#5960). Every other mark stays until
	// the school checked it.
	DeleteUnheldEmailSuppressions(ctx context.Context, tenantID int64) (int, error)
	// DeleteExpiredEmailDeliveryLogs removes the delivery logs of the
	// expired mails and the logs without a mail written before the instant.
	DeleteExpiredEmailDeliveryLogs(ctx context.Context, tenantID int64, before time.Time) (int, error)
	// DeleteExpiredEmailIntents removes the expired mails except the
	// key-only templates.
	DeleteExpiredEmailIntents(ctx context.Context, tenantID int64, before time.Time, keyOnlyTemplates []string) (int, error)
	// ClearExpiredKeyOnlyEmailIntents empties relation, recipient, content and
	// provider answer of the expired key-only mails not cleared yet.
	ClearExpiredKeyOnlyEmailIntents(ctx context.Context, tenantID int64, before time.Time, keyOnlyTemplates []string) (int, error)
	DeleteExpiredPushIntents(ctx context.Context, tenantID int64, before time.Time) (int, error)
	// DeleteExpiredRealtimeNotifications removes the in-app notifications
	// stored for other API processes before the instant (#5504).
	DeleteExpiredRealtimeNotifications(ctx context.Context, tenantID int64, before time.Time) (int, error)
	// DeleteExpiredFeedEntries removes the feed entries last updated before
	// the instant (#7148).
	DeleteExpiredFeedEntries(ctx context.Context, tenantID int64, before time.Time) (int, error)
}

// FeedStore keeps the notification feed of the accounts of a school
// (#7148). Every statement runs on the school's tenant transaction, so
// row-level security binds it to that school, and is scoped to one account
// except the publication, which writes one entry per recipient. Reads and
// read-state changes keep to the types and the reader role of a portal's
// view (#7139).
type FeedStore interface {
	// PublishFeedEntries updates the recipients' unread entry of the same
	// object last updated at or after bundleSince whose type is one of
	// bundleTypes, giving it the content's type, and adds an entry for every
	// other recipient. bundleTypes holds the content's type and the types it
	// takes back or that take it back (#7151).
	PublishFeedEntries(ctx context.Context, tenantID int64, content domain.FeedEntryContent, bundleTypes []string, accountIDs []int64, now, bundleSince time.Time) (domain.FeedWrite, error)
	// ListFeedEntries returns up to limit entries of the account after the
	// cursor, newest update first; a nil cursor starts at the newest.
	ListFeedEntries(ctx context.Context, tenantID, accountID int64, view domain.FeedView, after *domain.FeedCursor, limit int) ([]domain.FeedEntry, error)
	CountUnreadFeedEntries(ctx context.Context, tenantID, accountID int64, view domain.FeedView) (int, error)
	// MarkFeedEntryRead marks one entry of the account read; found is false
	// for an entry of another account or school. An entry read before stays
	// as it is.
	MarkFeedEntryRead(ctx context.Context, tenantID, accountID int64, view domain.FeedView, entryID int64, now time.Time) (found bool, err error)
	// MarkAllFeedEntriesRead marks every unread entry of the account read in
	// the portal's view.
	MarkAllFeedEntriesRead(ctx context.Context, tenantID, accountID int64, view domain.FeedView, now time.Time) (int, error)
	GuardianFeedStore
	TraegerFeedStore
	// SchoolAudience lists the active accounts of the school with a role of
	// the OGS portal or of moto schule, and its active guardians with the
	// children they hold parent_portal.access for (#7144), under the
	// predicates the feed readers, Web Push and SSE apply, and the active
	// members of the school's Träger (#7146).
	SchoolAudience(ctx context.Context, tenantID int64) ([]domain.SchoolAudienceMember, error)
}

// GuardianFeedStore reads the feed of a guardian account across its schools
// (#7140). Every statement runs on an administrative transaction and keeps
// only the entries the account may still read: an active membership with
// the guardian role in the entry's school and parent_portal.access for at
// least one of the entry's children. A staff entry never reaches it.
type GuardianFeedStore interface {
	ListGuardianFeedEntries(ctx context.Context, accountID int64, after *domain.FeedCursor, limit int) ([]domain.FeedEntry, error)
	CountUnreadGuardianFeedEntries(ctx context.Context, accountID int64) (int, error)
	// MarkGuardianFeedEntryRead marks one readable entry of the account read
	// and names its school; found is false for every other entry.
	MarkGuardianFeedEntryRead(ctx context.Context, accountID, entryID int64, now time.Time) (tenantID int64, found bool, err error)
	// MarkAllGuardianFeedEntriesRead marks every readable unread entry of
	// the account read and names the schools of the entries it changed.
	MarkAllGuardianFeedEntriesRead(ctx context.Context, accountID int64, now time.Time) (tenantIDs []int64, err error)
}

// TraegerFeedStore reads the bell of a Träger member across the schools of
// the session's Träger (#7146). Every statement runs on an administrative
// transaction and keeps only the entries of the given types in a school of
// that Träger while the account is an active member of it with an active
// account.
type TraegerFeedStore interface {
	ListTraegerFeedEntries(ctx context.Context, organizationID, accountID int64, types []string, after *domain.FeedCursor, limit int) ([]domain.TraegerFeedEntry, error)
	CountUnreadTraegerFeedEntries(ctx context.Context, organizationID, accountID int64, types []string) (int, error)
	// MarkTraegerFeedEntryRead marks one readable entry of the account read;
	// found is false for every other entry.
	MarkTraegerFeedEntryRead(ctx context.Context, organizationID, accountID int64, types []string, entryID int64, now time.Time) (found bool, err error)
	MarkAllTraegerFeedEntriesRead(ctx context.Context, organizationID, accountID int64, types []string, now time.Time) (int, error)
}

// RealtimeNotificationStore keeps the in-app notifications other API
// processes load by ID (#5504). Both statements run on the school's tenant
// transaction, so row-level security binds them to that school.
type RealtimeNotificationStore interface {
	SaveRealtimeNotification(ctx context.Context, notification domain.RealtimeNotification) (int64, error)
	// LoadRealtimeNotification returns the school's notification stored at
	// or after notBefore; found is false for every other ID.
	LoadRealtimeNotification(ctx context.Context, tenantID, id int64, notBefore time.Time) (notification domain.RealtimeNotification, found bool, err error)
	// CurrentRealtimeRecipients keeps the accounts that are still active
	// members of the school with the role of recipient (a domain
	// RealtimeRecipient value); guardians also keep parent_portal.access to
	// one of studentIDs when it is not empty.
	CurrentRealtimeRecipients(ctx context.Context, tenantID int64, recipient string, accountIDs, studentIDs []int64) ([]int64, error)
}
