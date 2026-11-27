package application

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/communication"
)

// Cancellation notice (#2601).
//
// When a care block is cancelled the families of the booked children get a
// regular parent announcement, authored by the system on behalf of the person
// cancelling. Reusing the announcement gives the notice everything a
// Leistungskatalog asks for without a second delivery system: a feed entry
// that stays, a read state per family, an e-mail through the shared outbox,
// and a push. The row is marked with SystemKind so the team list can badge it
// and the parent feed can show it even where the optional news feature is
// off.
//
// Whether the families hear about a cancellation is decided in the cancel
// dialog, not by school settings (#3731): the person cancelling ticks
// "Eltern per App und E-Mail informieren". Each family's own notification
// and e-mail choices still apply.

// The parents app serves the feed at /news; the portal adds its own prefix,
// so the deep link is the browser path. Lock-screen copy lives with the other
// parent copy in notifications.ParentAnnouncementCopy (no child name, no
// block title; the feed entry carries the details).
const careCancelledDeepLink = "/news"

// CareCancellationInput describes one cancelled block's notice.
type CareCancellationInput struct {
	// StudentIDs are the children booked into the cancelled block. Their
	// guardians with portal access form the audience.
	StudentIDs []int64
	// Title and Body are what the person cancelling wrote (or accepted from the
	// prefilled suggestion). The internal cancel reason never reaches here:
	// only text written for the families is sent to the families.
	Title string
	Body  string
	// CreatedBy is the account that cancelled the block; the announcement is
	// attributed to it like a hand-written one.
	CreatedBy int64
}

// CareCancellationResult reports what was sent.
type CareCancellationResult struct {
	Announcement *StaffParentAnnouncement
	// RecipientCount is the number of guardian accounts the notice reaches in
	// the feed, before push consent and e-mail opt-out narrow the channels.
	RecipientCount int
}

// CareCancellationReach is what the cancel dialog shows before anything is
// sent: how many families a notice for these children reaches.
type CareCancellationReach struct {
	FamilyCount int
}

// CareCancellationPublisher is the slice of the announcement service the
// schedule cancel path depends on.
type CareCancellationPublisher interface {
	// PublishCareCancellation creates and publishes the notice inside the
	// caller's tenant transaction. It fails with ErrValidation on empty text,
	// so the caller can refuse before the cancellation itself is written.
	PublishCareCancellation(ctx context.Context, in CareCancellationInput) (*CareCancellationResult, error)
	// CareCancellationReachFor resolves the dialog preview for the given
	// children. Runs inside the caller's tenant transaction.
	CareCancellationReachFor(ctx context.Context, studentIDs []int64) (*CareCancellationReach, error)
}

func (s *service) CareCancellationReachFor(ctx context.Context, studentIDs []int64) (*CareCancellationReach, error) {
	reach := &CareCancellationReach{}
	ids := uniquePositive(studentIDs)
	if len(ids) == 0 {
		return reach, nil
	}
	count, err := s.repo.CountReachableGuardiansForStudents(ctx, s.runtime.TenantID(ctx), ids)
	if err != nil {
		return nil, fmt.Errorf("announcement: count reachable guardians: %w", err)
	}
	reach.FamilyCount = count
	return reach, nil
}

func (s *service) PublishCareCancellation(ctx context.Context, in CareCancellationInput) (*CareCancellationResult, error) {
	title, body, err := ValidateCareCancellationText(in.Title, in.Body)
	if err != nil {
		return nil, err
	}
	if in.CreatedBy <= 0 {
		return nil, fmt.Errorf("%w: created_by is required", ErrValidation)
	}
	studentIDs := uniquePositive(in.StudentIDs)
	if len(studentIDs) == 0 {
		return nil, fmt.Errorf("%w: at least one student is required", ErrValidation)
	}
	// The dialog promises "per App und E-Mail"; the outbox still skips
	// families who opted out of these e-mails.
	const sendEmail = true

	kind := StaffParentAnnouncementSystemKindCareCancellation
	a := &StaffParentAnnouncement{
		Title:      title,
		Body:       body,
		Priority:   StaffParentAnnouncementPriorityImportant,
		SendEmail:  sendEmail,
		Active:     true,
		CreatedBy:  in.CreatedBy,
		SystemKind: &kind,
	}
	if err := s.repo.Create(ctx, a); err != nil {
		return nil, fmt.Errorf("announcement: create cancellation notice: %w", err)
	}
	if err := s.publishCancellationTargets(ctx, a, studentIDs); err != nil {
		return nil, err
	}
	recipients, err := s.repo.AudienceRecipients(ctx, a.GetTenantID(), a.ID)
	if err != nil {
		return nil, fmt.Errorf("announcement: resolve cancellation notice audience: %w", err)
	}
	s.logger.Info("care cancellation notice published",
		slog.Int64("announcement_id", a.ID),
		slog.Int64("created_by", in.CreatedBy),
		slog.Int("student_count", len(studentIDs)),
		slog.Int("recipient_count", len(recipients)),
	)
	if err := s.notifyCareCancellation(ctx, a, studentIDs); err != nil {
		return nil, fmt.Errorf("announcement: cancellation notice push: %w", err)
	}
	if err := s.enqueueAnnouncementEmails(ctx, a); err != nil {
		return nil, fmt.Errorf("announcement: cancellation notice e-mails: %w", err)
	}
	return &CareCancellationResult{Announcement: a, RecipientCount: len(recipients)}, nil
}

// notifyCareCancellation sends the one notice of a cancellation to the
// families (#7140): the push every announcement gets, and with it an entry in
// the notification feed of every reached guardian, so the bell of the parents
// portal shows it too. There is no second message. The entry is about the
// booked children: a guardian reads it only while holding parent_portal.access
// for one of them, and the push and its in-app hint re-check the same. The
// push keeps its lock-screen copy without child data; the entry carries what
// the person cancelling wrote, which the guardian reads only after login. The
// family's own switch decides only the push.
func (s *service) notifyCareCancellation(ctx context.Context, a *StaffParentAnnouncement, studentIDs []int64) error {
	if s.notifier == nil {
		return nil
	}
	shape := publishPushShape(a)
	accountIDs, localeByAccount, err := s.resolveAnnouncementPushAudience(ctx, a)
	if err != nil || len(accountIDs) == 0 {
		return err
	}
	push, err := s.filterAnnouncementPushAudience(ctx, a.ID, shape.notificationType, accountIDs)
	if err != nil {
		return err
	}
	priority := PriorityNormal
	if a.Priority == StaffParentAnnouncementPriorityImportant {
		priority = PriorityHigh
	}
	locales, groups := localeGroups(accountIDs, localeByAccount)
	for _, locale := range locales {
		title, body := s.deliveryPolicy.ParentAnnouncementCopy(locale, shape.copyKind)
		recipients := groups[locale]
		err := s.notifier.Notify(ctx, communication.NotificationEvent{
			Type:           shape.notificationType,
			IdempotencyKey: fmt.Sprintf("%s:%s", shape.idempotencyKey, locale),
			RelatedType:    shape.relatedType, RelatedID: a.ID,
			Title: title, Body: body, DeepLink: shape.deepLink, Priority: priority,
			Audience: communication.NotificationAudience{
				TenantID: a.GetTenantID(), Scope: ScopeGuardian,
				GuardianAccountIDs: recipients, StudentIDs: studentIDs,
			},
			Feed: &communication.NotificationFeed{
				PushAccountIDs: slices.DeleteFunc(slices.Clone(recipients), func(id int64) bool { return !slices.Contains(push, id) }),
				Title:          a.Title, Body: a.Body,
			},
		})
		if s.deliveryPolicy.IsNotificationsDisabled(err) {
			s.logger.Info("care cancellation notice suppressed by tenant notification gate",
				slog.Int64("announcement_id", a.ID),
				slog.Int("recipient_count", len(accountIDs)),
			)
			return nil
		}
		if err != nil {
			return fmt.Errorf("notify guardian audience: %w", err)
		}
	}
	return nil
}

// ValidateCareCancellationText applies the text contract shared by the
// cancellation preflight and the publisher. Returning the normalized values
// ensures the check before cancelling cannot disagree with the stored text.
func ValidateCareCancellationText(title, body string) (string, string, error) {
	title = strings.TrimSpace(title)
	body = strings.TrimSpace(body)
	if title == "" || len([]rune(title)) > maxTitleLen {
		return "", "", fmt.Errorf("%w: title is required and at most %d characters", ErrValidation, maxTitleLen)
	}
	if body == "" || len([]rune(body)) > maxBodyLen {
		return "", "", fmt.Errorf("%w: body is required and at most %d characters", ErrValidation, maxBodyLen)
	}
	return title, body, nil
}

// pushShapeFor picks the notification type, the locale-copy kind and the deep
// link for an announcement. Hand-written rows and polls keep their generic
// wording under the announcement consent; a system row rides its own type so a
// family can opt into cancellations separately from news.
func pushShapeFor(a *StaffParentAnnouncement) (notificationType, copyKind, deepLink string) {
	if a.IsSystem() && *a.SystemKind == StaffParentAnnouncementSystemKindCareCancellation {
		return TypeParentCareCancelled, ParentCareCancelled, careCancelledDeepLink
	}
	if a.IsPoll() {
		return parentAnnouncementNotificationType, ParentPollPublished, "/"
	}
	if a.IsSystem() && *a.SystemKind == StaffParentAnnouncementSystemKindSurvey {
		return parentAnnouncementNotificationType, ParentPollPublished, careCancelledDeepLink
	}
	return parentAnnouncementNotificationType, ParentAnnouncementPublished, "/"
}

func uniquePositive(ids []int64) []int64 {
	seen := make(map[int64]struct{}, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func (s *service) publishCancellationTargets(ctx context.Context, a *StaffParentAnnouncement, studentIDs []int64) error {
	targets := make([]*StaffParentAnnouncementTarget, 0, len(studentIDs))
	for _, studentID := range studentIDs {
		id := studentID
		targets = append(targets, &StaffParentAnnouncementTarget{
			TargetType:  StaffAnnouncementTargetStudent,
			TargetRefID: &id,
		})
	}
	// Targets can only be set on a draft, so the row is created unpublished
	// and flipped right after. PublishIfDraft is the same atomic flip the
	// hand-written path uses.
	if err := s.repo.ReplaceTargets(ctx, a.GetTenantID(), a.ID, targets); err != nil {
		return fmt.Errorf("announcement: set cancellation notice targets: %w", err)
	}
	now := s.now()
	published, err := s.repo.PublishIfDraft(ctx, a.ID, now)
	if err != nil {
		return fmt.Errorf("announcement: publish cancellation notice: %w", err)
	}
	if !published {
		return fmt.Errorf("announcement: publish cancellation notice: row %d was not a draft", a.ID)
	}
	a.PublishedAt = &now
	a.Targets = targets

	return nil
}
