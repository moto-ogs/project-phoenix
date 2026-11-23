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
	if err := s.requireEmploymentChoice(ctx, invitation.Email, request); err != nil {
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

// requireEmploymentChoice refuses an invitation from the Einladen dialog
// without a choice while the address has a former employment at the school.
// The dialog asks only when its read found one, so the person decided on a
// state that is no longer true; resuming by default would continue the
// employment with every reset off, unasked (ADR 0021, ADR 0311). It runs
// after the address's account row is locked.
func (s *SchoolInvitation) requireEmploymentChoice(ctx context.Context, email string, request domain.SchoolInvitationRequest) error {
	if !request.FormerEmploymentAsked || request.EmploymentAction != "" {
		return nil
	}
	_, found, err := s.findFormerEmployment(ctx, email)
	if err != nil {
		return err
	}
	if found {
		return failed(opCreateInvitation, readstate.ErrChanged)
	}
	return nil
}

// mailed hands the delivery an invitation just issued for s.expiry with its
// expiry on the composition's clock, which the mail's renderer counts on.
// The stored expiry lies on the database clock (ADR 0285, Nachtrag).
func (s *SchoolInvitation) mailed(invitation domain.SchoolInvitation) domain.SchoolInvitation {
	invitation.ExpiresAt = s.now().Add(s.expiry)
	return invitation
}
