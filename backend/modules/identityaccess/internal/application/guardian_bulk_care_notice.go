package application

import (
	"context"
	"fmt"
	"net/mail"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The parent step of the bulk invitation (#7760, ADR 0309 section 5). With
// NotifyActive, a guardian who already uses the parents portal gets one mail
// naming every selected child they may see whose care runs today: the care
// is now visible there. Everything it decides on is read after the profile
// locks, in a fixed number of statements: the access rows under a share lock
// (marker, stored parent_portal.access, the account and whether it already
// belongs to the school's parents portal), the children (OGS place, last
// care day) and their approved care periods. The access row remembers the
// queued mail (care_notice_sent_at), so a later run mails nobody twice for
// the same child. Mail and marker of one guardian are written in that
// guardian's savepoint and sent after the commit.

// bulkCareNotices is what the parent step read before the loop.
type bulkCareNotices struct {
	// states is the parent step per relationship of an account holder.
	states map[int64]domain.GuardianCareNoticeState
	// careRuns names the children whose care the parents portal shows as
	// running today.
	careRuns map[int64]bool
	// childNames are the first names of the children with running care,
	// read only for a run that mails.
	childNames map[int64]string
	schoolName string
	// withoutVisibleCare counts the selected children of account holders
	// whose care the parents portal does not show as running today.
	withoutVisibleCare int
}

// addresses are the login addresses of the accounts behind the access rows.
func (n bulkCareNotices) addresses() []string {
	addresses := make([]string, 0, len(n.states))
	for _, state := range n.states {
		if email := normalizedAddress(state.Email); email != "" {
			addresses = append(addresses, email)
		}
	}
	slices.Sort(addresses)
	return slices.Compact(addresses)
}

func normalizedAddress(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// loadBulkCareNotices reads the parent step for the account holders among
// the candidates: in a run that mails it first pins their accounts and their
// membership of the school's parents portal, then the access rows (locked
// unless the run is a preview), the children, their care periods and the
// bookings in force today, and for a run that mails the first names and the
// school name.
func (l *AccountLifecycle) loadBulkCareNotices(ctx context.Context, req identityaccess.BulkInviteRequest, candidates []bulkInviteCandidate, profiles map[int64]domain.GuardianProfile) (bulkCareNotices, error) {
	notices := bulkCareNotices{}
	if !req.NotifyActive {
		return notices, nil
	}
	relationshipIDs, studentIDs := bulkCareNoticeTargets(candidates, profiles)
	if len(relationshipIDs) == 0 {
		return notices, nil
	}
	if !req.DryRun {
		// The accounts are locked already (lockBulkInviteAccounts); next the
		// mapping and role rows, then the access rows: the order of the
		// operator's grant and revocation, which lock the account row before
		// its mappings. What the decision reads below can then not change
		// until the run commits.
		if err := l.invitations.LockGuardianNoticeMemberships(ctx, bulkCareNoticeAccounts(candidates, profiles)); err != nil {
			return notices, failed(opGuardianBulkInvite, err)
		}
	}
	states, err := l.invitations.ListGuardianCareNotices(ctx, relationshipIDs, !req.DryRun)
	if err != nil {
		return notices, failed(opGuardianBulkInvite, err)
	}
	notices.states = states
	students, err := l.guardians.FindStudents(ctx, studentIDs)
	if err != nil {
		return notices, failed(opGuardianBulkInvite, err)
	}
	if notices.careRuns, err = l.bookedCareToday(ctx, students, studentIDs); err != nil {
		return notices, err
	}
	notices.withoutVisibleCare = len(studentIDs) - len(notices.careRuns)
	if req.DryRun || len(notices.careRuns) == 0 {
		return notices, nil
	}
	if notices.childNames, err = l.bulkChildFirstNames(ctx, students, notices.careRuns); err != nil {
		return notices, err
	}
	notices.schoolName = l.delivery.SchoolName(ctx, l.runtime.TenantID(ctx))
	return notices, nil
}

// bookedCareToday names the children whose care the parents portal lists
// under „Betreuung & Wochenplan“ as booked today, in two statements for all
// children (the periods from Enrollment, the bookings from Care Plan).
func (l *AccountLifecycle) bookedCareToday(ctx context.Context, students map[int64]domain.Student, studentIDs []int64) (map[int64]bool, error) {
	periods, err := l.guardians.ApprovedCarePeriods(ctx, studentIDs)
	if err != nil {
		return nil, failed(opGuardianBulkInvite, err)
	}
	today := calendar.DateFromTime(l.sessions.now())
	current := currentCarePeriods(students, periods, today)
	if len(current) == 0 {
		return map[int64]bool{}, nil
	}
	requestChildIDs := make([]int64, 0, len(current))
	for _, requestChildID := range current {
		requestChildIDs = append(requestChildIDs, requestChildID)
	}
	slices.Sort(requestChildIDs)
	booked, err := l.guardians.CareBookingsInForce(ctx, requestChildIDs, today)
	if err != nil {
		return nil, failed(opGuardianBulkInvite, err)
	}
	inForce := make(map[int64]bool, len(booked))
	for _, requestChildID := range booked {
		inForce[requestChildID] = true
	}
	running := map[int64]bool{}
	for studentID, requestChildID := range current {
		if inForce[requestChildID] {
			running[studentID] = true
		}
	}
	return running, nil
}

// currentCarePeriods picks, per child, the approved care period the parents
// portal shows today (currentCarePeriod's first choice: the first period in
// Enrollment's order that covers today), for a child that is no alumnus
// (the portal lists none), has an OGS place (RequireCarePlace) and whose care
// has not ended (EnrolledUntil). A period that starts later or ended earlier
// is shown by the portal too, but it is no care that runs now. The result
// maps the child to the period's request child, whose bookings decide.
func currentCarePeriods(students map[int64]domain.Student, periods []identityaccess.ChildCarePeriod, today calendar.Date) map[int64]int64 {
	current := map[int64]int64{}
	for _, period := range periods {
		student, found := students[period.StudentID]
		if !found || current[period.StudentID] != 0 || period.Start.After(today) || period.End.Before(today) {
			continue
		}
		ended := student.EnrolledUntil != nil && today.After(*student.EnrolledUntil)
		if !student.Alumnus && !student.WithoutCarePlace && !ended {
			current[period.StudentID] = period.RequestChildID
		}
	}
	return current
}

// bulkCareNoticeAccounts lists the accounts of the candidates with an
// account, each once and in ascending order.
func bulkCareNoticeAccounts(candidates []bulkInviteCandidate, profiles map[int64]domain.GuardianProfile) []int64 {
	var accountIDs []int64
	for _, candidate := range candidates {
		if profile := profiles[candidate.profileID]; profile.HasAccount && profile.AccountID != nil {
			accountIDs = append(accountIDs, *profile.AccountID)
		}
	}
	slices.Sort(accountIDs)
	return slices.Compact(accountIDs)
}

// bulkCareNoticeTargets lists the relationships of the candidates with an
// account and their children, each once and in ascending order.
func bulkCareNoticeTargets(candidates []bulkInviteCandidate, profiles map[int64]domain.GuardianProfile) ([]int64, []int64) {
	var relationshipIDs, studentIDs []int64
	for _, candidate := range candidates {
		if !profiles[candidate.profileID].HasAccount {
			continue
		}
		for studentID, relationshipID := range candidate.relationships {
			relationshipIDs = append(relationshipIDs, relationshipID)
			studentIDs = append(studentIDs, studentID)
		}
	}
	slices.Sort(relationshipIDs)
	slices.Sort(studentIDs)
	return relationshipIDs, slices.Compact(studentIDs)
}

func (l *AccountLifecycle) bulkChildFirstNames(ctx context.Context, students map[int64]domain.Student, careRuns map[int64]bool) (map[int64]string, error) {
	personIDs := make([]int64, 0, len(careRuns))
	for id := range careRuns {
		personIDs = append(personIDs, students[id].PersonID)
	}
	slices.Sort(personIDs)
	names, err := l.guardians.FindPersonNamesByIDs(ctx, personIDs)
	if err != nil {
		return nil, failed(opGuardianBulkInvite, err)
	}
	firstNames := make(map[int64]string, len(careRuns))
	for id := range careRuns {
		firstNames[id] = strings.TrimSpace(names[students[id].PersonID].FirstName)
	}
	return firstNames, nil
}

// careNoticeAccount is the account behind a guardian's access rows. Every
// access row of one profile is bound to the profile's account.
func (n bulkCareNotices) careNoticeAccount(candidate bulkInviteCandidate) (domain.GuardianCareNoticeState, bool) {
	for _, studentID := range candidate.studentIDs {
		if state, found := n.states[candidate.relationships[studentID]]; found {
			return state, true
		}
	}
	return domain.GuardianCareNoticeState{}, false
}

// pendingCareNotices are the relationships of the children the guardian
// may see (stored parent_portal.access, read under the lock) whose care
// runs today and who have not had the mail, in child order. notifiedBefore
// reports whether one of them had it.
func (n bulkCareNotices) pendingCareNotices(candidate bulkInviteCandidate) (pending []int64, notifiedBefore bool) {
	for _, studentID := range candidate.studentIDs {
		state, found := n.states[candidate.relationships[studentID]]
		switch {
		case !found || !state.PortalAccess || !n.careRuns[studentID]:
			continue
		case state.Notified:
			notifiedBefore = true
		default:
			pending = append(pending, studentID)
		}
	}
	return pending, notifiedBefore
}

// careNoticeDecision is what the care notice decides for one guardian who
// already has an account. The run acts on it and the preview's fingerprint
// covers it, so both come from this one function.
type careNoticeDecision struct {
	// owed reports a mail is due: an active account that already belongs
	// to the school's parents portal and at least one pending child.
	owed bool
	// pending are the children the mail names, in child order.
	pending        []int64
	notifiedBefore bool
	// problem is why an owed mail would not arrive at the login address.
	problem string
	email   string
	locale  string
}

// decideCareNotice decides the care notice of one guardian. Nothing owed,
// an inactive account, or an account that this very run brings back to the
// school's parents portal: counted as before, and as already notified when
// the mail went out earlier. A login address the mail cannot reach is a
// problem like a missing invitation address; the contact address of the
// profile is never used.
func (n bulkCareNotices) decideCareNotice(candidate bulkInviteCandidate, mailBlocks map[string]string) careNoticeDecision {
	account, found := n.careNoticeAccount(candidate)
	pending, notifiedBefore := n.pendingCareNotices(candidate)
	decision := careNoticeDecision{pending: pending, notifiedBefore: notifiedBefore}
	if !found || !account.AccountActive || !account.PortalMember || len(pending) == 0 {
		return decision
	}
	decision.owed = true
	decision.email, decision.locale = normalizedAddress(account.Email), account.Locale
	decision.problem = careNoticeAddressProblem(decision.email, mailBlocks[decision.email])
	return decision
}

// notifyActiveBulkGuardian applies the care notice decision of one guardian
// who already has an account.
func (l *AccountLifecycle) notifyActiveBulkGuardian(ctx context.Context, run *bulkInviteRun, candidate bulkInviteCandidate, profile domain.GuardianProfile) error {
	decision := run.notices.decideCareNotice(candidate, run.mailBlocks)
	if !decision.owed {
		if decision.notifiedBefore {
			run.result.AlreadyNotified++
		}
		run.result.SkippedActive++
		return nil
	}
	if decision.problem != "" {
		run.problem(candidate, profile, decision.problem)
		return nil
	}
	if run.req.DryRun {
		run.result.Notified++
		return nil
	}
	if err := l.sendBulkCareNotice(ctx, run, candidate, profile, decision.email, decision.locale, decision.pending); err != nil {
		return err
	}
	run.result.Notified++
	return nil
}

// careNoticeAddressProblem names why a care notice to the address would not
// arrive: no or a malformed address, or a hold the invitation also respects.
func careNoticeAddressProblem(email, block string) string {
	if email == "" {
		return domain.BulkInviteProblemMissingEmail
	}
	if parsed, err := mail.ParseAddress(email); err != nil || parsed.Address != email {
		return domain.BulkInviteProblemInvalidEmail
	}
	if reason, blocked := bulkInviteMailBlock(block); blocked {
		return reason
	}
	return ""
}

// sendBulkCareNotice queues one mail naming every pending child and stamps
// their relationships in one statement. A mail the outbox does not take
// fails with ErrGuardianAccessMailNotQueued, so the guardian's savepoint
// rolls back mail and stamps together and the guardian is listed (#4602).
func (l *AccountLifecycle) sendBulkCareNotice(ctx context.Context, run *bulkInviteRun, candidate bulkInviteCandidate, profile domain.GuardianProfile, email, locale string, pending []int64) error {
	names := make([]string, 0, len(pending))
	relationshipIDs := make([]int64, 0, len(pending))
	for _, studentID := range pending {
		names = append(names, run.notices.childNames[studentID])
		relationshipIDs = append(relationshipIDs, candidate.relationships[studentID])
	}
	err := l.delivery.EnqueueCareVisibleEmail(ctx, identityaccess.GuardianCareNotice{
		GuardianProfileID: profile.ID, StudentIDs: pending,
		Recipient:       identityaccess.GuardianMailRecipient{FirstName: profile.FirstName, LastName: profile.LastName, Email: email},
		ChildFirstNames: names, SchoolName: run.notices.schoolName, Locale: locale,
	})
	if err != nil {
		return fmt.Errorf("%w: %w", domain.ErrGuardianAccessMailNotQueued, err)
	}
	if err := l.invitations.MarkGuardianCareNoticesSent(ctx, relationshipIDs); err != nil {
		return failed(opGuardianBulkInvite, err)
	}
	return nil
}
