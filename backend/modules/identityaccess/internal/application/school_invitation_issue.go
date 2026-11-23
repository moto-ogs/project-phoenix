package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// issueInvitation spends the address's previous invitations, stores the new
// one and queues its mails in the caller's transaction, so a failed insert
// never burns the last usable link. The expiry counts from the database time
// (ADR 0285, Nachtrag): auth.account_is_unused judges it on that clock.
func (s *SchoolInvitation) issueInvitation(ctx context.Context, invitation domain.SchoolInvitation, request domain.SchoolInvitationRequest, roleName string, portal domain.InvitationPortal, rolePermissions []string) (domain.SchoolInvitation, error) {
	// Account retention takes the same row lock before its final check.
	// Re-checking after this lock makes one of the two writes happen first:
	// an invitation already committed keeps the account, while an invitation
	// created after erasure correctly targets a new account.
	if err := s.ensureTargetAllowed(ctx, invitation.Email, request); err != nil {
		return domain.SchoolInvitation{}, err
	}
	if err := s.checkFormerEmploymentRead(ctx, invitation.Email, request.ExpectedFormerEmployment); err != nil {
		return domain.SchoolInvitation{}, err
	}
	if _, _, err := s.store.RevokeSchoolInvitationsForEmail(ctx, invitation.Email); err != nil {
		return domain.SchoolInvitation{}, failed("invalidate invitations", err)
	}
	issuedAt, _, err := s.store.DatabaseTime(ctx)
	if err != nil {
		return domain.SchoolInvitation{}, failed(opCreateInvitation, err)
	}
	invitation.ExpiresAt = issuedAt.Add(s.expiry)
	stored, _, err := s.store.InsertSchoolInvitation(ctx, invitation)
	if err != nil {
		return domain.SchoolInvitation{}, failed(opCreateInvitation, err)
	}
	stored.RoleName = roleName
	if err := s.delivery.QueueSchoolWelcome(ctx, stored, request.SchoolName, portal, rolePermissions); err != nil {
		return domain.SchoolInvitation{}, failed("queue welcome email", err)
	}
	if err := s.delivery.DispatchSchoolInvitation(ctx, s.mailed(stored), request.SchoolName, portal, s.expiry); err != nil {
		return domain.SchoolInvitation{}, err
	}
	return stored, nil
}

// checkFormerEmploymentRead refuses an invitation whose Einladen dialog
// decided on a former-employment answer that is no longer true: one found
// since it read "none" would resume unasked with every reset off, one gone
// or replaced makes the choice void (ADR 0021, ADR 0311). Without a token no
// answer was read and the ADR 0021 default applies. It runs after the
// address's account row is locked, the lock acceptance writes under.
func (s *SchoolInvitation) checkFormerEmploymentRead(ctx context.Context, email, expected string) error {
	if expected == "" {
		return nil
	}
	former, found, err := s.findFormerEmployment(ctx, email)
	if err != nil {
		return err
	}
	if err := readstate.Check(expected, formerEmploymentVersion(former, found)); err != nil {
		return failed(opCreateInvitation, err)
	}
	return nil
}

// formerEmploymentVersion is the read-state token of a former-employment
// answer, "none" included. The lookup returns it and the invitation checks
// it with the same function over the same read.
func formerEmploymentVersion(former domain.FormerEmployment, found bool) string {
	if !found {
		former = domain.FormerEmployment{}
	}
	return readstate.Fingerprint(struct {
		Found     bool   `json:"found"`
		StaffID   int64  `json:"staff_id"`
		StartedOn string `json:"started_on"`
		EndedOn   string `json:"ended_on"`
	}{found, former.StaffID, former.StartedOn.String(), former.EndedOn.String()})
}

// mailed hands the delivery an invitation just issued for s.expiry with its
// expiry on the composition's clock, which the mail's renderer counts on.
// The stored expiry lies on the database clock (ADR 0285, Nachtrag).
func (s *SchoolInvitation) mailed(invitation domain.SchoolInvitation) domain.SchoolInvitation {
	invitation.ExpiresAt = s.now().Add(s.expiry)
	return invitation
}
