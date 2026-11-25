package care

import (
	"context"
	"log/slog"

	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
	"github.com/moto-ogs/project-phoenix/modules/careplan/parentrequests"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ChildFeatures resolves the parent-portal feature toggles for the child's
// tenant after verifying ownership.
func (s *Service) ChildFeatures(ctx context.Context, accountID, studentID int64) (ChildFeatureFlags, error) {
	child, err := s.ResolveOwnedChild(ctx, accountID, studentID)
	if err != nil {
		return ChildFeatureFlags{}, err
	}
	settings, err := s.resolveChildFeatureSettings(ctx, child.TenantID, s.now())
	if err != nil {
		return ChildFeatureFlags{}, err
	}
	return s.featuresForSchool(ctx, accountID, child.TenantID, []schoolChild{{id: studentID, child: child}}, settings)[studentID], nil
}

// featuresForSchool applies the school's settings to each child's own
// relationship. The open change requests of all children of the school are
// read in one tenant transaction; whatever the number of children, its
// statement count stays the same.
func (s *Service) featuresForSchool(ctx context.Context, accountID, tenantID int64, children []schoolChild, settings childFeatureSettings) map[int64]ChildFeatureFlags {
	active := make([]int64, 0, len(children))
	for _, c := range children {
		if !c.child.CareEnded {
			active = append(active, c.id)
		}
	}
	open := s.openChangeRequests(ctx, tenantID, accountID, active)
	out := make(map[int64]ChildFeatureFlags, len(children))
	for _, c := range children {
		out[c.id] = featuresForChild(c.child, settings, open[c.id])
	}
	return out
}

func featuresForChild(child *Child, settings childFeatureSettings, hasOpenChangeRequest bool) ChildFeatureFlags {
	// The child has left the OGS (#2487). Every WRITE capability goes off in
	// this one place rather than in each screen: the portal builds its buttons
	// from these flags, so a family sees a read-only profile instead of
	// affordances that would all end in the same 403. CareEnded travels
	// alongside so the portal can say why, and the read flags (meal plan, news)
	// stay untouched — what happened stays readable.
	if child.CareEnded {
		return ChildFeatureFlags{
			CareEnded:               true,
			WithoutCarePlace:        child.WithoutCarePlace,
			SickRequiresApproval:    settings.sickApproval,
			ExcusedRequiresApproval: settings.excusedApproval,
			MealPlanEnabled:         settings.mealPlan && !child.WithoutCarePlace,
			MealRegistrationEnabled: false,
			NewsEnabled:             settings.news,
			CareFacilityTerm:        settings.careTerm,
		}
	}

	flags := settings.activeChildFlags(child, hasOpenChangeRequest)
	if child.WithoutCarePlace {
		return withoutCarePlaceFlags(flags)
	}
	return flags
}

// withoutCarePlaceFlags switches off every OGS function of a child without an
// OGS place (#4803, ADR 0282): pickup, meals and the chat with the OGS team.
// The care times, offerings and courses have no flag of their own; their
// routes refuse such a child and the portal hides them on WithoutCarePlace.
// The school's functions stay as the relationship grants them: sick and
// excused notes, the parent-teacher conference, master data, guardians and
// related accounts, letters and news. WithoutCarePlace travels along so the
// portal can say why the OGS blocks are missing.
func withoutCarePlaceFlags(flags ChildFeatureFlags) ChildFeatureFlags {
	flags.WithoutCarePlace = true
	flags.NotesEnabled = false
	flags.PickupChangeEnabled = false
	flags.PickupChangeModeEnabled = false
	flags.PickupChangeCutoffTime = ""
	flags.PickupChangeTodayClosed = false
	flags.PickupChangeCareDayEnded = false
	flags.PickupManageAllowed = false
	flags.MealPlanEnabled = false
	flags.MealRegistrationEnabled = false
	// Requests for offerings and the weekly plan go to the OGS.
	flags.RequestSubmitEnabled = false
	return flags
}

// activeChildFlags combines the tenant settings with the guardian's
// permissions for a child who is still in care.
func (f childFeatureSettings) activeChildFlags(child *Child, hasOpenChangeRequest bool) ChildFeatureFlags {
	canEditMasterData := f.masterEdit && child.HasPermission(GuardianPermissionMasterDataEdit)
	canManagePickup := child.HasPermission(GuardianPermissionPickupManage)
	canManageGuardianContacts := child.HasPermission(GuardianPermissionGuardianEdit)
	canManageRelatedAccounts := child.HasPermission(GuardianPermissionRelatedAccountsManage)
	return ChildFeatureFlags{
		ConferenceBookAllowed:         child.HasPermission(GuardianPermissionConferenceBook),
		HasOpenChangeRequest:          hasOpenChangeRequest,
		SickNoteEnabled:               f.sick && f.sickReports && child.HasPermission(GuardianPermissionSickNoteSubmit),
		ExcusedNoteEnabled:            f.sick && f.excusedReports && child.HasPermission(GuardianPermissionSickNoteSubmit),
		SickRequiresApproval:          f.sickApproval,
		ExcusedRequiresApproval:       f.excusedApproval,
		NotesEnabled:                  f.notes && child.HasPermission(GuardianPermissionNotesWrite),
		RequestSubmitEnabled:          f.notes && child.HasPermission(GuardianPermissionRequestSubmit),
		PickupChangeEnabled:           f.pickupChange && canManagePickup,
		PickupChangeModeEnabled:       f.pickupChangeMode && canManagePickup,
		PickupChangeCutoffTime:        f.pickupCutoff.Clock,
		PickupChangeTodayClosed:       f.pickupCutoff.Closed(calendar.DateFromTime(f.pickupCutoff.Now)),
		PickupChangeCareDayEnded:      carerequests.CareDayEnded(f.careDayEnd, f.pickupCutoff.Now),
		PickupManageAllowed:           f.guardianManagement && canManagePickup,
		EmergencyContactManageAllowed: f.guardianManagement && canManagePickup,
		GuardianContactManageAllowed:  f.guardianManagement && canManageGuardianContacts,
		AbsenceRequestEditEnabled:     child.HasPermission(GuardianPermissionSickNoteSubmit),
		RelatedAccountsInviteEnabled:  canManageRelatedAccounts && f.inviteMode != ParentInviteModeDisabled,
		RelatedAccountsRemoveEnabled:  canManageRelatedAccounts && f.canRemove && f.inviteMode != ParentInviteModeDisabled,
		MasterDataEditEnabled:         canEditMasterData,
		MasterDataContactEditEnabled:  canEditMasterData && f.guardianManagement,
		MasterDataRequestEnabled:      f.masterRequest && child.HasPermission(GuardianPermissionMasterDataRequest),
		MealPlanEnabled:               f.mealPlan,
		MealRegistrationEnabled:       f.mealRegistration && child.HasPermission(GuardianPermissionMealParticipationManage),
		NewsEnabled:                   f.news,
		ReasonRequired:                parentrequests.ReasonRequired(f.reasonPolicy, parentrequests.ReasonSideGuardian),
		CareFacilityTerm:              f.careTerm,
	}
}

// openChangeRequests reports, per child, whether a pending change request
// (care schedule OR master data) awaits an OGS decision and the account may
// see it under the family's sharing, so the parent overview can badge the
// Stammdaten entry. The lookups hit tenant-scoped/RLS tables, so they run
// inside the school's tenant transaction: shares and Familienschutz, the open
// weekly-plan requests and the open Stammdaten requests, each one read for
// all children. Best-effort: a query error logs and yields false so a
// transient failure never shows a phantom badge.
func (s *Service) openChangeRequests(ctx context.Context, tenantID, accountID int64, studentIDs []int64) map[int64]bool {
	open := make(map[int64]bool, len(studentIDs))
	if len(studentIDs) == 0 || s.ChangeRequestRepo == nil {
		return open
	}
	err := s.Runtime.WithinTenant(ctx, tenantID, func(txCtx context.Context) error {
		visibility, err := s.RequestSharing.LoadRequestShareVisibilities(txCtx, studentIDs)
		if err != nil {
			return err
		}
		s.markOpenCareRequests(txCtx, visibility, accountID, studentIDs, open)
		remaining := make([]int64, 0, len(studentIDs))
		for _, id := range studentIDs {
			if !open[id] {
				remaining = append(remaining, id)
			}
		}
		s.markOpenMasterDataRequests(txCtx, visibility, accountID, remaining, open)
		return nil
	})
	if err != nil {
		s.Logger.Warn("parent: open change-request check failed",
			slog.Int64("school_id", tenantID),
			slog.Any("student_ids", studentIDs),
			slog.String("error", err.Error()),
		)
		return map[int64]bool{}
	}
	return open
}

// markOpenCareRequests marks the children with a pending care-schedule
// request the account may see. A lookup error logs and marks none.
func (s *Service) markOpenCareRequests(txCtx context.Context, visibility map[int64]RequestShareVisibility, accountID int64, studentIDs []int64, open map[int64]bool) {
	pending, err := s.ChangeRequestRepo.ListPendingWeeklyCareRequests(txCtx, studentIDs)
	if err != nil {
		s.Logger.Warn("parent: pending care-request check failed",
			slog.Any("student_ids", studentIDs),
			slog.String("error", err.Error()),
		)
		return
	}
	for _, req := range pending {
		if allowsRequest(visibility[req.StudentID], RequestShareCareSchedule, req.ID, accountID, req.SubmittedBy) {
			open[req.StudentID] = true
		}
	}
}

// markOpenMasterDataRequests marks the children with a pending master-data
// request the account may see. A lookup error logs and marks none.
func (s *Service) markOpenMasterDataRequests(txCtx context.Context, visibility map[int64]RequestShareVisibility, accountID int64, studentIDs []int64, open map[int64]bool) {
	if len(studentIDs) == 0 {
		return
	}
	pending, err := s.ChangeRequestRepo.ListByStudents(txCtx, studentIDs, []string{DataChangeStatusPending}, 0)
	if err != nil {
		s.Logger.Warn("parent: pending master-data check failed",
			slog.Any("student_ids", studentIDs),
			slog.String("error", err.Error()),
		)
		return
	}
	for _, req := range pending {
		if req != nil && allowsRequest(visibility[req.StudentID], RequestShareMasterData, req.ID, accountID, req.SubmittedBy) {
			open[req.StudentID] = true
		}
	}
}

// allowsRequest is the child's own share visibility; a child the ledger did
// not answer for sees nothing.
func allowsRequest(visibility RequestShareVisibility, requestType string, requestID, accountID, submittedBy int64) bool {
	return visibility != nil && visibility.Allows(requestType, requestID, accountID, submittedBy)
}
