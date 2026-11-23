package users

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Bulk invitation (#3378): a school whose children and contacts already
// exist invites the guardians of many children to the parents portal in one
// run. The same route serves the preview (dry_run) the confirmation dialog
// shows before anything is mailed.

// bulkInviteMaxStudents mirrors the application cap. It protects the
// tenant-wide student read before the request reaches the application layer.
const bulkInviteMaxStudents = 2000

type bulkInviteRequest struct {
	StudentIDs []ident.ID `json:"student_ids"`
	ResendOpen bool       `json:"resend_open"`
	DryRun     bool       `json:"dry_run"`
	// NotifyActive also mails guardians who already use the parents portal
	// that the child's care is visible there, once per child (#7760).
	NotifyActive bool `json:"notify_active"`
}

type bulkInviteProblemResponse struct {
	GuardianProfileID string   `json:"guardian_profile_id"`
	GuardianName      string   `json:"guardian_name"`
	StudentNames      []string `json:"student_names"`
	Reason            string   `json:"reason"`
}

type bulkInviteResponse struct {
	DryRun                bool `json:"dry_run"`
	Invited               int  `json:"invited"`
	LinkedExistingAccount int  `json:"linked_existing_account"`
	Resent                int  `json:"resent"`
	SkippedActive         int  `json:"skipped_active"`
	SkippedOpen           int  `json:"skipped_open"`
	SkippedRestricted     int  `json:"skipped_restricted"`
	// Notified counts the guardians with an account who get (in a preview:
	// would get) the care notice; AlreadyNotified those whose notice was
	// queued before for every child; WithoutVisibleCare the selected children
	// of account holders whose care the parents portal does not show as
	// running today, so no notice names them (#7760). All stay 0 without
	// notify_active.
	Notified           int                         `json:"notified"`
	AlreadyNotified    int                         `json:"already_notified"`
	WithoutVisibleCare int                         `json:"without_visible_care"`
	Problems           []bulkInviteProblemResponse `json:"problems"`
}

// bulkInviteGuardians applies the single invite's gate to the whole
// selection: only active children of the tenant count, and the caller must
// be an admin or a verified staff member (#2329).
func (rs *GuardianResource) bulkInviteGuardians(w http.ResponseWriter, r *http.Request) {
	accountID, ok := rs.actingAccountID(w, r)
	if !ok {
		return
	}
	var body bulkInviteRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		rs.failMessage(w, r, FailureInvalidRequest, "invalid request body")
		return
	}
	if !rs.runtime.IsAdmin(r) && !rs.runtime.IsVerifiedStaff(r.Context()) {
		rs.fail(w, r, FailureForbidden, errors.New("insufficient permissions to invite guardians"))
		return
	}
	if len(body.StudentIDs) == 0 {
		rs.failMessage(w, r, FailureInvalidRequest, "student_ids is required")
		return
	}
	if len(body.StudentIDs) > bulkInviteMaxStudents {
		rs.failMessage(w, r, FailureInvalidRequest, "too many student_ids")
		return
	}
	students, err := rs.directory.ListStudentsByID(r.Context(), ident.Int64s(body.StudentIDs))
	if err != nil {
		rs.moduleFailure(w, r, err)
		return
	}
	studentIDs := activeStudentIDs(students)
	if len(studentIDs) == 0 {
		rs.failMessage(w, r, FailureNotFound, msgStudentNotFound)
		return
	}
	result, err := rs.runtime.BulkInviteGuardians(r.Context(), GuardianBulkInvite{
		StudentIDs: studentIDs, ActorAccountID: accountID, ResendOpen: body.ResendOpen, DryRun: body.DryRun,
		NotifyActive: body.NotifyActive,
	})
	if err != nil {
		rs.fail(w, r, rs.runtime.InviteFailureKind(err), err)
		return
	}
	rs.succeed(w, r, http.StatusOK, newBulkInviteResponse(body.DryRun, result), "Guardians invited")
}

// activeStudentIDs keeps the children that have not graduated; a graduated
// child's guardian links stay immutable. Children of another school never
// reach this point: the directory read is tenant-scoped.
func activeStudentIDs(students []peopledirectory.Student) []int64 {
	active := make([]int64, 0, len(students))
	for _, student := range students {
		if !student.IsAlumnus() {
			active = append(active, student.ID)
		}
	}
	return active
}

func newBulkInviteResponse(dryRun bool, result GuardianBulkInviteResult) bulkInviteResponse {
	response := bulkInviteResponse{
		DryRun: dryRun, Invited: result.Invited, LinkedExistingAccount: result.LinkedExistingAccount,
		Resent: result.Resent, SkippedActive: result.SkippedActive, SkippedOpen: result.SkippedOpen,
		SkippedRestricted: result.SkippedRestricted, Notified: result.Notified, AlreadyNotified: result.AlreadyNotified,
		WithoutVisibleCare: result.WithoutVisibleCare, Problems: make([]bulkInviteProblemResponse, 0, len(result.Problems)),
	}
	for _, problem := range result.Problems {
		names := problem.StudentNames
		if names == nil {
			names = []string{}
		}
		response.Problems = append(response.Problems, bulkInviteProblemResponse{
			GuardianProfileID: strconv.FormatInt(problem.GuardianProfileID, 10),
			GuardianName:      problem.GuardianName, StudentNames: names, Reason: problem.Reason,
		})
	}
	return response
}
