package identityaccess

// Reasons a guardian with a full role could not be invited in a bulk run.
const (
	BulkInviteProblemMissingEmail   = "missing_email"
	BulkInviteProblemInvalidEmail   = "invalid_email"
	BulkInviteProblemDuplicateEmail = "duplicate_email"
	// BulkInviteProblemEmailNotQueued: the outbox did not take the mail, so
	// this guardian's writes rolled back and a later run can try again (#4602).
	BulkInviteProblemEmailNotQueued = "email_not_queued"
	// BulkInviteProblemAddressBlocked: the school's list would hold the mail back.
	BulkInviteProblemAddressBlocked = "address_blocked"
	// BulkInviteProblemMailDelayed: the mail server still tries the last mail.
	BulkInviteProblemMailDelayed = "mail_delayed"
	// BulkInviteProblemProviderBlocked: the mail provider withholds mail to the address now.
	BulkInviteProblemProviderBlocked = "provider_blocked"
	// BulkInviteProblemBlockUnreadable: the provider's state could not be read.
	BulkInviteProblemBlockUnreadable = "block_unreadable"
)

// BulkInviteRequest invites the guardians of the given children to the
// parents portal in one run (#3378). DryRun classifies without writing or
// mailing. ResendOpen mails guardians with an open invitation again and
// restarts its expiry window; without it they are skipped. NotifyActive
// mails guardians who already use the parents portal one notice that the
// care of the selected children they may see and whose care runs today is
// now visible there, once per guardian and child (#7760, ADR 0309 section
// 5); without it they are only counted. A run sends the Fingerprint of the
// preview it confirms as ExpectedFingerprint; a run that would decide on
// other guardians, addresses, invitations or notices than the preview
// counted is refused with readstate.ErrChanged (ADR 0311).
type BulkInviteRequest struct {
	StudentIDs          []int64
	CreatedBy           int64
	ResendOpen          bool
	DryRun              bool
	NotifyActive        bool
	ExpectedFingerprint string
}

// BulkInviteProblem names one guardian the run could not reach and why.
type BulkInviteProblem struct {
	GuardianProfileID int64
	GuardianName      string
	StudentNames      []string
	Reason            string
}

// BulkInviteResult counts guardians, never children. Only guardians with a
// full role on a selected child are invited; restrictive contacts are
// counted in SkippedRestricted and never upgraded. A dry run counts accounts
// that already own the address under Invited, because telling them apart
// needs the write. With NotifyActive, Notified counts the account holders
// who get the care notice (in a preview: who would get it); they are no
// longer counted in SkippedActive. AlreadyNotified counts the account
// holders with a notice queued before and no child left to be told now; they
// stay in SkippedActive, as does an account holder with nothing to be told.
// WithoutVisibleCare counts the selected children of account holders whose
// care the parents portal does not show as running today: no notice names
// them. An account holder the notice cannot reach is listed as a problem.
type BulkInviteResult struct {
	DryRun                bool
	Invited               int
	LinkedExistingAccount int
	Resent                int
	SkippedActive         int
	SkippedOpen           int
	SkippedRestricted     int
	Notified              int
	AlreadyNotified       int
	WithoutVisibleCare    int
	Problems              []BulkInviteProblem
	// Fingerprint is set on a preview: the token its run sends back.
	Fingerprint string
}
