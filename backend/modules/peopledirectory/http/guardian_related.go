package users

import (
	"context"
	"net/http"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// Related accounts: invite a further guardian to a child by e-mail (staff
// always allowed; resolves existing account, existing profile or new) plus
// the parent-initiated approval queue. The flows belong to identity access
// and reach the adapter through the runtime.

type inviteToStudentRequest struct {
	Email            string `json:"email"`
	FirstName        string `json:"first_name"`
	LastName         string `json:"last_name"`
	RelationshipType string `json:"relationship_type"`
	// ConfirmRoleUpgrade confirms upgrading an existing restrictive contact
	// link to full access (#2172).
	ConfirmRoleUpgrade bool `json:"confirm_role_upgrade"`
}

type inviteToStudentResponse struct {
	Outcome           string   `json:"outcome"`
	GuardianProfileID ident.ID `json:"guardian_profile_id"`
	InvitationID      ident.ID `json:"invitation_id,omitempty"`
	ExistingRole      string   `json:"existing_role,omitempty"`
	MailHeld          bool     `json:"mail_held,omitempty"`
}

type pendingApprovalResponse struct {
	ID                ident.ID  `json:"id"`
	GuardianProfileID ident.ID  `json:"guardian_profile_id"`
	GuardianName      string    `json:"guardian_name"`
	GuardianEmail     string    `json:"guardian_email,omitempty"`
	StudentID         ident.ID  `json:"student_id,omitempty"`
	StudentName       string    `json:"student_name,omitempty"`
	RequestedByEmail  string    `json:"requested_by_email,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
	ExpiresAt         time.Time `json:"expires_at"`
	RoleUpgrade       bool      `json:"role_upgrade"`
}

// inviteGuardianToStudent invites a further guardian by e-mail. Staff are
// always allowed (permission-gated by users:create); the resolve runs
// immediately, there is no approval queue for staff.
func (rs *GuardianResource) inviteGuardianToStudent(w http.ResponseWriter, r *http.Request) {
	studentID, ok := rs.parseIDParam(w, r, "studentId", "invalid studentId")
	if !ok {
		return
	}
	accountID, ok := rs.actingAccountID(w, r)
	if !ok {
		return
	}
	if canModify, err := rs.canModifyStudent(r, studentID); !canModify {
		rs.fail(w, r, FailureForbidden, err)
		return
	}
	var body inviteToStudentRequest
	if err := wire.Decode(r.Body, &body); err != nil {
		rs.failMessage(w, r, FailureInvalidRequest, "invalid request body")
		return
	}
	result, err := rs.runtime.InviteGuardianToStudent(r.Context(), GuardianInvite{
		StudentID: studentID, Email: body.Email, FirstName: body.FirstName, LastName: body.LastName,
		RelationshipType: body.RelationshipType, ActorAccountID: accountID, ConfirmRoleUpgrade: body.ConfirmRoleUpgrade,
	})
	if err != nil {
		rs.fail(w, r, rs.runtime.InviteFailureKind(err), err)
		return
	}
	response := inviteToStudentResponse{
		Outcome: result.Outcome, GuardianProfileID: ident.ID(result.GuardianProfileID), ExistingRole: result.ExistingRole, MailHeld: result.MailHeld,
	}
	if result.InvitationID != nil {
		response.InvitationID = ident.ID(*result.InvitationID)
	}
	rs.succeed(w, r, http.StatusCreated, response, "Guardian invited")
}

func (rs *GuardianResource) listPendingApprovals(w http.ResponseWriter, r *http.Request) {
	views, err := rs.runtime.ListPendingApprovals(r.Context())
	if err != nil {
		rs.fail(w, r, FailureInternal, err)
		return
	}
	out := make([]pendingApprovalResponse, 0, len(views))
	for _, view := range views {
		response := pendingApprovalResponse{
			ID: ident.ID(view.InvitationID), GuardianProfileID: ident.ID(view.GuardianProfileID),
			GuardianName: view.GuardianName, GuardianEmail: view.GuardianEmail, StudentName: view.StudentName,
			RequestedByEmail: view.RequestedByEmail, CreatedAt: view.CreatedAt, ExpiresAt: view.ExpiresAt, RoleUpgrade: view.RoleUpgrade,
		}
		if view.StudentID > 0 {
			response.StudentID = ident.ID(view.StudentID)
		}
		out = append(out, response)
	}
	rs.succeed(w, r, http.StatusOK, out, "Pending approvals")
}

// approveInvitation links the child and grants access (existing account) or
// dispatches the invitation e-mail; the per-student gate runs on top of the
// route permission.
func (rs *GuardianResource) approveInvitation(w http.ResponseWriter, r *http.Request) {
	rs.decideInvitation(w, r, rs.runtime.ApproveInvitation, true, "Invitation approved")
}

// rejectInvitation refuses a parent-initiated request; no access is granted.
func (rs *GuardianResource) rejectInvitation(w http.ResponseWriter, r *http.Request) {
	rs.decideInvitation(w, r, rs.runtime.RejectInvitation, false, "Invitation rejected")
}

func (rs *GuardianResource) decideInvitation(w http.ResponseWriter, r *http.Request, decide func(ctx context.Context, invitationID, actorAccountID int64) error, classify bool, message string) {
	invitationID, ok := rs.parseIDParam(w, r, "invitationId", "invalid invitationId")
	if !ok {
		return
	}
	accountID, ok := rs.actingAccountID(w, r)
	if !ok {
		return
	}
	studentID, err := rs.runtime.PendingInvitationStudentID(r.Context(), invitationID)
	if err != nil {
		rs.fail(w, r, FailureInvalidRequest, err)
		return
	}
	if canModify, err := rs.canModifyStudent(r, studentID); !canModify {
		rs.fail(w, r, FailureForbidden, err)
		return
	}
	if err := decide(r.Context(), invitationID, accountID); err != nil {
		kind := FailureInvalidRequest
		if classify {
			kind = rs.runtime.InviteFailureKind(err)
		}
		rs.fail(w, r, kind, err)
		return
	}
	rs.succeed(w, r, http.StatusOK, nil, message)
}
