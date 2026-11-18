package enrollmenthttp

import (
	"context"
	"net/http"

	"github.com/go-chi/render"
	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// decideErrorRules maps the refusals of a decision to their wire codes.
func (rs *Resource) decideErrorRules(r *http.Request) []common.ErrorRule {
	return []common.ErrorRule{
		{Match: func(err error) bool { return rs.Failures.savepointControlFailed(r, err) }, Render: common.ErrorInternalServer},
		{Target: context.Canceled, Render: common.ErrorClientClosed},
		{Target: context.DeadlineExceeded, Render: common.ErrorRequestTimeout},
		{Target: capability.ErrDecisionChildNotFound, Render: renderRequestNotFound},
		{Target: capability.ErrDecisionRequestNotFound, Render: renderRequestNotFound},
		{Target: capability.ErrDecisionInvalidStatus, Render: common.ErrorInvalidRequest},
		{Target: capability.ErrDecisionAlreadyTerminal, Render: func(err error) render.Renderer {
			return common.ErrorInvalidRequestWithCode(err, common.CodeEnrollmentDecisionAlreadyFinal)
		}},
		{Target: capability.ErrDecisionInvalidData, Render: func(err error) render.Renderer {
			return common.ErrorInvalidRequestWithCode(err, common.CodeEnrollmentApprovalDataInvalid)
		}},
		{Target: capability.ErrDecisionReviewerStaffRequired, Render: func(err error) render.Renderer {
			return common.ErrorForbiddenWithCode(err, common.CodeEnrollmentApprovalStaffProfileRequired)
		}},
		{Target: capability.ErrWaitlistDisabled, Render: func(err error) render.Renderer {
			return common.ErrorConflictWithCode(err, common.CodeEnrollmentWaitlistDisabled)
		}},
		{Target: capability.ErrCareOfferingMissing, Render: func(err error) render.Renderer {
			return common.ErrorConflictWithCode(err, common.CodeEnrollmentApprovalCareOfferingMissing)
		}},
		{Target: capability.ErrCareOfferingExactlyOneRequired, Render: func(err error) render.Renderer {
			return common.ErrorConflictWithCode(err, common.CodeEnrollmentApprovalCareOfferingExactlyOne)
		}},
		{Target: capability.ErrCareOfferingDayConflict, Render: func(err error) render.Renderer {
			return common.ErrorConflictWithCode(err, common.CodeEnrollmentApprovalCareOfferingDayConflict)
		}},
		{Target: capability.ErrGuardianAccountMismatch, Render: func(err error) render.Renderer {
			return common.ErrorConflictWithCode(err, common.CodeEnrollmentGuardianAccountMismatch)
		}},
		{Target: capability.ErrChildPossiblyEnrolled, Render: func(err error) render.Renderer {
			// The refusal names the current candidates, so the detail page
			// asks the office again with them instead of a stale list (#6247).
			return common.ErrorConflictWithDetails(err, common.CodeEnrollmentChildPossiblyEnrolled, possiblyEnrolledDetails(err))
		}},
		{Target: capability.ErrExistingChildChoiceInvalid, Render: func(err error) render.Renderer {
			return common.ErrorConflictWithCode(err, common.CodeEnrollmentExistingChildChoiceInvalid)
		}},
		{Target: capability.ErrOfferingTermsChanged, Render: func(err error) render.Renderer {
			return common.ErrorConflictWithCode(err, common.CodeEnrollmentApprovalOfferingTermsChanged)
		}},
		{Target: capability.ErrExistingStudentAlreadyRequested, Render: func(err error) render.Renderer {
			return common.ErrorConflictWithCode(err, common.CodeEnrollmentChildAlreadyRequested)
		}},
		{Target: capability.ErrWithoutCarePlaceNeedsSchoolYear, Render: func(err error) render.Renderer {
			return common.ErrorConflictWithCode(err, common.CodeEnrollmentWithoutCarePlaceSchoolYearOnly)
		}},
		{Match: rs.Failures.Transient, Render: common.ErrorServiceUnavailable},
	}
}
