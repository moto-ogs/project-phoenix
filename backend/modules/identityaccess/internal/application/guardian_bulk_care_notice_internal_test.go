package application

import (
	"errors"
	"slices"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The parent step of the bulk invitation (#7760, ADR 0309 section 5): with
// NotifyActive a guardian who already belongs to the parents portal gets
// one notice naming every child they may see whose care runs today, at the
// login address of the account, once per child; everybody else is treated
// as before.

// A period that always covers the day the fixture's clock reads, one that
// always starts later and one that always ended.
var (
	runningPeriod = [2]calendar.Date{calendar.NewDate(2000, 1, 1), calendar.NewDate(2999, 12, 31)}
	laterPeriod   = [2]calendar.Date{calendar.NewDate(2998, 8, 1), calendar.NewDate(2999, 7, 31)}
	endedPeriod   = [2]calendar.Date{calendar.NewDate(2000, 8, 1), calendar.NewDate(2001, 7, 31)}
)

// accountHolder plants a guardian whose profile is bound to an account with
// the login address login (the contact address on the profile differs) and
// a full role on the children; every access row grants parent_portal.access,
// is bound to that active account, which already belongs to the school's
// parents portal, in the portal language locale.
func (f *lifecycleFixture) accountHolder(login, locale string, studentIDs ...int64) domain.GuardianProfile {
	accountID := int64(4000) + f.guardians.nextID
	profile := f.guardians.addProfile(domain.GuardianProfile{
		TenantID: lifecycleTenant, FirstName: "Konto", LastName: login, Email: "kontakt-" + login,
		AccountID: &accountID, HasAccount: true,
	})
	for _, studentID := range studentIDs {
		link := f.guardians.addLink(domain.StudentGuardianLink{
			TenantID: lifecycleTenant, StudentID: studentID, GuardianProfileID: profile.ID, GuardianRole: roleLegal,
		})
		f.invitations.planCareNotice(domain.GuardianCareNoticeState{
			RelationshipID: link.ID, PortalAccess: true, AccountActive: true, PortalMember: true, Email: login, Locale: locale,
		})
	}
	return profile
}

// child plants a child with an OGS place and the given care period, whose
// request child (studentID + 1000) has a booking in force today.
func (f *lifecycleFixture) child(studentID int64, firstName string, period [2]calendar.Date) {
	f.childWithoutBooking(studentID, firstName, period)
	f.guardians.booked[studentID+1000] = true
}

// childWithoutBooking plants the child with an approved care period but no
// booking in force today: an optional phase approved without a booking, or
// a booking that ended before the phase.
func (f *lifecycleFixture) childWithoutBooking(studentID int64, firstName string, period [2]calendar.Date) {
	personID := studentID + 500
	f.guardians.students[studentID] = domain.Student{ID: studentID, PersonID: personID}
	f.guardians.names[personID] = domain.PersonName{FirstName: firstName, LastName: "Beispiel"}
	f.guardians.carePeriods = append(f.guardians.carePeriods, identityaccess.ChildCarePeriod{
		StudentID: studentID, RequestChildID: studentID + 1000, Start: period[0], End: period[1],
	})
}

// changeCareNotices rewrites the parent step of every relationship of a
// profile.
func (f *lifecycleFixture) changeCareNotices(profileID int64, change func(*domain.GuardianCareNoticeState)) {
	for id, link := range f.guardians.links {
		if link.GuardianProfileID != profileID {
			continue
		}
		state := f.invitations.careNotices[id]
		change(&state)
		f.invitations.planCareNotice(state)
	}
}

func notifyRequest(dryRun bool, studentIDs ...int64) identityaccess.BulkInviteRequest {
	req := bulkRequest(studentIDs...)
	req.NotifyActive, req.DryRun = true, dryRun
	return req
}

func TestBulkCareNotice_OneMailPerGuardianAtTheLoginAddress(t *testing.T) {
	t.Parallel()
	f := newLifecycleFixture(t)
	f.child(11, "Mia", runningPeriod)
	f.child(12, "Ben", runningPeriod)
	parent := f.accountHolder("login@example.test", "tr", 11, 12)
	invitee := f.bulkGuardian("ohne-konto@example.test", roleLegal, 11)

	preview, err := f.lifecycle.BulkInviteToStudents(tenantContext(), notifyRequest(true, 11, 12))
	require.NoError(t, err)
	assert.Equal(t, identityaccess.BulkInviteResult{DryRun: true, Invited: 1, Notified: 1, Problems: []identityaccess.BulkInviteProblem{}}, *preview)
	assert.Empty(t, f.delivery.careNotices, "a preview mails nobody")
	assert.Empty(t, f.invitations.marked, "a preview stamps nothing")
	assert.Equal(t, []bool{false}, f.invitations.careNoticeLocks, "a preview locks no access row")

	result, err := f.lifecycle.BulkInviteToStudents(tenantContext(), notifyRequest(false, 11, 12))
	require.NoError(t, err)
	assert.Equal(t, 1, result.Notified)
	assert.Equal(t, 1, result.Invited, "a guardian without an account still gets the invitation")
	require.Len(t, f.delivery.emails, 1)
	assert.Equal(t, invitee.ID, f.delivery.emails[0].GuardianProfileID)
	require.Len(t, f.delivery.careNotices, 1, "siblings share one mail")
	notice := f.delivery.careNotices[0]
	assert.Equal(t, parent.ID, notice.GuardianProfileID)
	assert.Equal(t, []string{"Mia", "Ben"}, notice.ChildFirstNames)
	assert.Equal(t, "login@example.test", notice.Recipient.Email, "the account's login address, never the contact address")
	assert.Equal(t, "tr", notice.Locale, "the guardian's portal language")
	assert.Equal(t, "OGS Musterschule", notice.SchoolName)
	require.Len(t, f.invitations.marked, 1, "both relationships are stamped in one write")
	assert.Len(t, f.invitations.marked[0], 2)
	assert.Equal(t, []bool{false, true}, f.invitations.careNoticeLocks, "the run reads the access rows under a share lock")

	again, err := f.lifecycle.BulkInviteToStudents(tenantContext(), notifyRequest(false, 11, 12))
	require.NoError(t, err)
	assert.Zero(t, again.Notified, "a second run mails nobody twice")
	assert.Equal(t, 1, again.AlreadyNotified)
	assert.Equal(t, 1, again.SkippedActive)
	assert.Len(t, f.delivery.careNotices, 1)
}

// Only a child whose care the parents portal shows as running is named: no
// OGS place, no approved period, a period that starts later or ended, or a
// care that ended keep the child out, without mail or marker. Once the care
// runs, a later run mails.
func TestBulkCareNotice_OnlyChildrenWithRunningCare(t *testing.T) {
	t.Parallel()
	f := newLifecycleFixture(t)
	f.child(11, "Mia", runningPeriod)
	f.child(12, "Ohneplatz", runningPeriod)
	f.guardians.students[12] = domain.Student{ID: 12, PersonID: 512, WithoutCarePlace: true}
	f.guardians.students[13] = domain.Student{ID: 13, PersonID: 513}
	f.guardians.names[513] = domain.PersonName{FirstName: "Ohnezeit"}
	f.child(14, "Spaeter", laterPeriod)
	f.child(15, "Vorbei", endedPeriod)
	f.child(16, "Beendet", runningPeriod)
	ended := calendar.NewDate(2001, 7, 31)
	f.guardians.students[16] = domain.Student{ID: 16, PersonID: 516, EnrolledUntil: &ended}
	f.child(17, "Abgegangen", runningPeriod)
	f.guardians.students[17] = domain.Student{ID: 17, PersonID: 517, Alumnus: true}
	f.childWithoutBooking(18, "Ohnebuchung", runningPeriod)
	sibling := f.accountHolder("geschwister@example.test", "de", 11, 12)
	waiting := f.accountHolder("wartet@example.test", "de", 13, 14, 15, 16, 17, 18)

	result, err := f.lifecycle.BulkInviteToStudents(tenantContext(), notifyRequest(false, 11, 12, 13, 14, 15, 16, 17, 18))

	require.NoError(t, err)
	assert.Equal(t, 1, result.Notified)
	assert.Equal(t, 1, result.SkippedActive, "a guardian with no child in running care is counted as before")
	assert.Equal(t, 7, result.WithoutVisibleCare)
	assert.Len(t, f.guardians.bookedDays, 1, "the bookings are read once, for today")
	require.Len(t, f.delivery.careNotices, 1)
	assert.Equal(t, sibling.ID, f.delivery.careNotices[0].GuardianProfileID)
	assert.Equal(t, []string{"Mia"}, f.delivery.careNotices[0].ChildFirstNames, "the sibling without OGS place is not named")
	assert.Equal(t, [][]int64{{f.relationshipOf(t, 11, sibling.ID)}}, f.invitations.marked, "only the named child is marked")

	f.guardians.carePeriods = append(f.guardians.carePeriods, identityaccess.ChildCarePeriod{StudentID: 13, RequestChildID: 1013, Start: runningPeriod[0], End: runningPeriod[1]})
	f.guardians.booked[1013] = true
	later, err := f.lifecycle.BulkInviteToStudents(tenantContext(), notifyRequest(false, 13))
	require.NoError(t, err)
	assert.Equal(t, 1, later.Notified, "once the care runs, a later run mails")
	require.Len(t, f.delivery.careNotices, 2)
	assert.Equal(t, waiting.ID, f.delivery.careNotices[1].GuardianProfileID)
	assert.Equal(t, []string{"Ohnezeit"}, f.delivery.careNotices[1].ChildFirstNames)
}

func (f *lifecycleFixture) relationshipOf(t *testing.T, studentID, profileID int64) int64 {
	t.Helper()
	link, found := f.guardians.linkOf(studentID, profileID)
	require.True(t, found)
	return link.ID
}

// The decision reads what the access rows say under the lock: a revoked
// parent_portal.access, an inactive account, and an account this very run
// brings back to the school's parents portal get nothing.
func TestBulkCareNotice_SkipsWhoMayNotSeeTheChildNow(t *testing.T) {
	t.Parallel()
	f := newLifecycleFixture(t)
	f.child(11, "Mia", runningPeriod)
	revoked := f.accountHolder("entzogen@example.test", "de", 11)
	f.changeCareNotices(revoked.ID, func(state *domain.GuardianCareNoticeState) { state.PortalAccess = false })
	inactive := f.accountHolder("inaktiv@example.test", "de", 11)
	f.changeCareNotices(inactive.ID, func(state *domain.GuardianCareNoticeState) { state.AccountActive = false })
	returning := f.accountHolder("zurueck@example.test", "de", 11)
	f.changeCareNotices(returning.ID, func(state *domain.GuardianCareNoticeState) { state.PortalMember = false })
	restricted := f.bulkGuardian("abholung@example.test", "pickup_only", 11)
	restrictedAccount := int64(77)
	restricted.AccountID, restricted.HasAccount = &restrictedAccount, true
	f.guardians.profiles[restricted.ID] = restricted

	result, err := f.lifecycle.BulkInviteToStudents(tenantContext(), notifyRequest(false, 11))

	require.NoError(t, err)
	assert.Equal(t, identityaccess.BulkInviteResult{SkippedActive: 3, SkippedRestricted: 1, Problems: []identityaccess.BulkInviteProblem{}}, *result)
	assert.Empty(t, f.delivery.careNotices, "no permission, no active account, no membership before the run, no full role: no mail")
	assert.Empty(t, f.invitations.marked)
	assert.Contains(t, f.store.granted, *returning.AccountID, "the run still restores the returning guardian's access")
}

func TestBulkCareNotice_ListsALoginAddressTheMailCannotReach(t *testing.T) {
	t.Parallel()
	f := newLifecycleFixture(t)
	f.child(11, "Mia", runningPeriod)
	blocked := f.accountHolder("gesperrt@example.test", "de", 11)
	f.delivery.mailBlocks = map[string]string{"gesperrt@example.test": domain.GuardianMailBlockAddress}
	malformed := f.accountHolder("kein-at-zeichen", "de", 11)

	result, err := f.lifecycle.BulkInviteToStudents(tenantContext(), notifyRequest(true, 11))

	require.NoError(t, err)
	assert.Zero(t, result.Notified)
	reasons := map[int64]string{}
	for _, problem := range result.Problems {
		reasons[problem.GuardianProfileID] = problem.Reason
		assert.Equal(t, []string{"Mia Beispiel"}, problem.StudentNames)
	}
	assert.Equal(t, map[int64]string{
		blocked.ID:   domain.BulkInviteProblemAddressBlocked,
		malformed.ID: domain.BulkInviteProblemInvalidEmail,
	}, reasons, "the hold of the login address counts, not the contact address")
}

func TestBulkCareNotice_WithoutTheOptionNothingChanges(t *testing.T) {
	t.Parallel()
	f := newLifecycleFixture(t)
	f.child(11, "Mia", runningPeriod)
	f.accountHolder("konto@example.test", "de", 11)

	result, err := f.lifecycle.BulkInviteToStudents(tenantContext(), bulkRequest(11))

	require.NoError(t, err)
	assert.Equal(t, identityaccess.BulkInviteResult{SkippedActive: 1, Problems: []identityaccess.BulkInviteProblem{}}, *result)
	assert.Empty(t, f.delivery.careNotices)
	assert.Empty(t, f.invitations.marked)
	assert.Empty(t, f.invitations.careNoticeLocks, "nothing of the parent step is read")
}

func TestBulkCareNotice_AnUnqueuedMailListsTheGuardianAndStampsNothing(t *testing.T) {
	t.Parallel()
	f := newLifecycleFixture(t)
	f.child(11, "Mia", runningPeriod)
	f.accountHolder("konto@example.test", "de", 11)
	f.delivery.careNoticeErr = errors.New("outbox down")

	result, err := f.lifecycle.BulkInviteToStudents(tenantContext(), notifyRequest(false, 11))

	require.NoError(t, err)
	assert.Zero(t, result.Notified)
	require.Len(t, result.Problems, 1)
	assert.Equal(t, domain.BulkInviteProblemEmailNotQueued, result.Problems[0].Reason)
	assert.Empty(t, f.invitations.marked, "the stamp waits for a queued mail")
}

// Every run that writes locks its accounts first, ascending, in the mode the
// grant's restoration takes, with or without the option, so two runs never
// upgrade a hold on a shared account; a run with the option then pins the
// memberships. A preview locks nothing.
func TestBulkCareNotice_PinsTheAccountsBeforeTheDecision(t *testing.T) {
	t.Parallel()
	f := newLifecycleFixture(t)
	f.child(11, "Mia", runningPeriod)
	f.child(12, "Ben", runningPeriod)
	// The later profile holds the smaller account: profile order is not
	// account order.
	later := f.accountHolder("spaeter@example.test", "de", 11)
	earlier := f.accountHolder("frueher@example.test", "de", 12)
	smaller := *earlier.AccountID - 100
	earlier.AccountID = &smaller
	f.guardians.profiles[earlier.ID] = earlier
	holders := [][]int64{{smaller, *later.AccountID}}
	// The sender's account is locked with them: each new invitation
	// references it, and a parent's own invitation locks both accounts.
	accounts := [][]int64{{relativeActor, smaller, *later.AccountID}}
	slices.Sort(accounts[0])

	_, err := f.lifecycle.BulkInviteToStudents(tenantContext(), notifyRequest(true, 11, 12))
	require.NoError(t, err)
	assert.Empty(t, f.invitations.lockedAccounts, "a preview locks nothing")
	assert.Empty(t, f.invitations.lockedMemberships)

	_, err = f.lifecycle.BulkInviteToStudents(tenantContext(), bulkRequest(11, 12))
	require.NoError(t, err)
	assert.Equal(t, accounts, f.invitations.lockedAccounts, "the plain invitation locks the sender and the accounts up front, ascending")
	assert.Empty(t, f.invitations.lockedMemberships, "without the option no membership is pinned")

	_, err = f.lifecycle.BulkInviteToStudents(tenantContext(), notifyRequest(false, 11, 12))
	require.NoError(t, err)
	assert.Equal(t, append(accounts, accounts...), f.invitations.lockedAccounts)
	assert.Equal(t, holders, f.invitations.lockedMemberships, "only account holders are members to pin")
	assert.Equal(t, []bool{false, true}, f.invitations.careNoticeLocks)
}
