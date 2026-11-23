package application

import (
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The preview of a bulk invitation and the run it confirms decide the
// guardians from the same facts. The fingerprint covers exactly those facts,
// so the run is refused when it would mail another set than the preview
// counted: invitations as well as care notices (#7760) (ADR 0311).

// bulkInviteState is the canonical form of what a bulk run decides on.
type bulkInviteState struct {
	ResendOpen   bool                      `json:"resend_open"`
	NotifyActive bool                      `json:"notify_active,omitempty"`
	Restricted   int                       `json:"restricted"`
	Guardians    []bulkInviteGuardianState `json:"guardians"`
}

// bulkInviteGuardianState is one candidate in profile order.
type bulkInviteGuardianState struct {
	ProfileID       int64                      `json:"profile_id"`
	StudentIDs      []int64                    `json:"student_ids"`
	Missing         bool                       `json:"missing,omitempty"`
	Email           string                     `json:"email,omitempty"`
	HasAccount      bool                       `json:"has_account,omitempty"`
	ExistingAccount bool                       `json:"existing_account,omitempty"`
	MailBlock       string                     `json:"mail_block,omitempty"`
	Open            []bulkInviteOpenInvitation `json:"open,omitempty"`
	Notice          *bulkInviteNoticeState     `json:"notice,omitempty"`
}

// bulkInviteNoticeState is the care notice decision of an account holder
// (decideCareNotice). The login address stays out: the school does not see
// it, and the token is an unkeyed hash it could test guesses against. What
// the address decides, a problem instead of a mail, is in.
type bulkInviteNoticeState struct {
	Owed           bool    `json:"owed,omitempty"`
	Pending        []int64 `json:"pending,omitempty"`
	NotifiedBefore bool    `json:"notified_before,omitempty"`
	Problem        string  `json:"problem,omitempty"`
}

// bulkInviteOpenInvitation is what a run reads of an open invitation.
type bulkInviteOpenInvitation struct {
	ID          int64 `json:"id"`
	Expired     bool  `json:"expired,omitempty"`
	Pending     bool  `json:"pending,omitempty"`
	AddressedTo bool  `json:"addressed_to,omitempty"`
}

// bulkInviteFingerprint is the token of the facts a run decides on. The
// candidates come in profile order; their students are sorted already.
func bulkInviteFingerprint(req identityaccess.BulkInviteRequest, restricted int, candidates []bulkInviteCandidate, profiles map[int64]domain.GuardianProfile, open map[int64][]domain.GuardianInvitation, run *bulkInviteRun) string {
	state := bulkInviteState{ResendOpen: req.ResendOpen, NotifyActive: req.NotifyActive, Restricted: restricted, Guardians: make([]bulkInviteGuardianState, 0, len(candidates))}
	for _, candidate := range candidates {
		guardian := bulkInviteGuardianState{ProfileID: candidate.profileID, StudentIDs: candidate.studentIDs}
		profile, found := profiles[candidate.profileID]
		if !found {
			guardian.Missing = true
			state.Guardians = append(state.Guardians, guardian)
			continue
		}
		email := strings.ToLower(strings.TrimSpace(profile.Email))
		guardian.Email, guardian.HasAccount = email, profile.HasAccount
		if run != nil {
			// The run decides on whether the address has an account, never on
			// which one. The token is an unkeyed hash the school can test
			// guesses against, so a global account ID stays out of it.
			_, guardian.ExistingAccount = run.existingAccounts[email]
			guardian.MailBlock = run.mailBlocks[email]
			if req.NotifyActive && profile.HasAccount {
				decision := run.notices.decideCareNotice(candidate, run.mailBlocks)
				guardian.Notice = &bulkInviteNoticeState{
					Owed: decision.owed, Pending: decision.pending,
					NotifiedBefore: decision.notifiedBefore, Problem: decision.problem,
				}
			}
		}
		for _, invitation := range open[profile.ID] {
			guardian.Open = append(guardian.Open, bulkInviteOpenInvitation{
				ID: invitation.ID, Expired: invitation.Expired, Pending: invitation.IsPendingApproval(),
				AddressedTo: identityaccess.GuardianInvitation(invitation).AddressedTo(profile.Email),
			})
		}
		slices.SortFunc(guardian.Open, func(a, b bulkInviteOpenInvitation) int {
			switch {
			case a.ID < b.ID:
				return -1
			case a.ID > b.ID:
				return 1
			default:
				return 0
			}
		})
		state.Guardians = append(state.Guardians, guardian)
	}
	return readstate.Fingerprint(state)
}

// confirmBulkInvite hands a preview its fingerprint and refuses a run whose
// facts differ from the preview it confirms.
func confirmBulkInvite(req identityaccess.BulkInviteRequest, result *identityaccess.BulkInviteResult, fingerprint string) error {
	if req.DryRun {
		result.Fingerprint = fingerprint
		return nil
	}
	if err := readstate.Check(req.ExpectedFingerprint, fingerprint); err != nil {
		return failed(opGuardianBulkInvite, err)
	}
	return nil
}
