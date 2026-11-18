package contract

import "reflect"

// Options are the two legacy registers of ADR 0270. Both only shrink: an
// entry leaves when its route is migrated, and Build fails on an entry that
// no registration uses.
type Options struct {
	// NumericIDs lists the identifier fields that existing routes still send
	// as JSON numbers, as "package.Type.GoField". Every other int64 on a
	// registered type must be a common.ID. On a request type the entry is a
	// field Go reads only as a JSON number.
	NumericIDs []string
	// QueryVariants lists the routes whose response shape a query parameter
	// selects, as "METHOD /pattern".
	QueryVariants []string
	// Identifiers maps the Go identifier types to KindID or KindLaxID. The
	// root names them, so this package stays free of the HTTP packages.
	Identifiers map[reflect.Type]string
	// Readers says what the own UnmarshalJSON of a request type reads:
	// ReadsFields or ReadsLaxIDs. A request type with its own UnmarshalJSON
	// and no entry stops the generator; the root names them like the
	// identifier types.
	Readers map[reflect.Type]string
	// Dates names the day types beside calendar.Date that travel as
	// "YYYY-MM-DD" and render their zero value as null. The root names them.
	Dates []reflect.Type
}

const (
	// ReadsFields: the reader takes the fields as encoding/json would.
	ReadsFields = "fields"
	// ReadsLaxIDs: as ReadsFields, and every int64 field takes a JSON number
	// or a decimal string.
	ReadsLaxIDs = "lax_ids"
)

// Registration is one route as the root hands it over: the owner's
// common.RouteContract with its full pattern.
type Registration struct {
	Method           string
	Pattern          string
	Portals          []string
	Query            []QueryParam
	Request          any
	Response         any
	Paginated        bool
	NoData           bool
	Variants         *VariantSpec
	Enums            []EnumSpec
	Deprecated       bool
	DeprecatedFields []string
}

// VariantSpec is a response whose shape a query parameter selects.
type VariantSpec struct {
	QueryParam string
	Default    string
	ByValue    map[string]any
}

// EnumSpec names a closed set of string values by Go type or by field.
type EnumSpec struct {
	Name   string
	Type   any
	Fields []string
	Values []string
}

// legacyNumericIDs names the fields that still travel as numbers on the
// wire, as "package.Type.GoField".
var legacyNumericIDs = []string{
	"appointments.Appointment.ID",
	"appointments.Appointment.OrganizerStaffID",
	"appointments.Appointment.TenantID",
	"appointments.AppointmentRecipient.AppointmentID",
	"appointments.AppointmentRecipient.GuardianProfileID",
	"appointments.AppointmentRecipient.ID",
	"appointments.AppointmentRecipient.StaffID",
	"appointments.AppointmentRecipient.TenantID",
	"appointments.AppointmentTarget.AppointmentID",
	"appointments.AppointmentTarget.ID",
	"appointments.AppointmentTarget.TargetID",
	"appointments.AppointmentTarget.TenantID",
	"appointments.RecurrenceRule.AppointmentID",
	"appointments.RecurrenceRule.ID",
	"appointments.RecurrenceRule.TenantID",
	"careplan.TraegerOffering.ID",
	"careplan.TraegerOffering.OrganizationID",
	"careplan.TraegerOffering.TraegerPhaseID",
	"careplan.TraegerOfferingSchool.SchoolID",
	"careplanhttp.StudentRequest.GroupID",
	"careplanhttp.UpdateStudentRequest.GroupID",
	"classday.AbsenceListChild.StudentID",
	"classday.DayRow.StudentID",
	"classday.SupervisionStudentSheet.StudentID",
	"classdayhttp.ClassHandoverRequest.AbsentStudentIDs",
	"classdayhttp.ClassHandoverRequest.PresentStudentIDs",
	"classdayhttp.ClassTripRequest.StudentIDs",
	"classdayhttp.MorningAttendanceMarkRequest.StudentID",
	"enrollment.HolidayAllocationCandidate.BookingID",
	"enrollment.HolidayAllocationCandidate.ChildID",
	"enrollment.HolidayAllocationCandidate.RegistrationID",
	"enrollment.HolidayAllocationDecision.ChildID",
	"enrollment.HolidayAllocationDecision.DecidedByAccountID",
	"enrollment.HolidayAllocationDecision.ID",
	"enrollment.HolidayAllocationDecision.RegistrationID",
	"enrollment.HolidayAllocationDecision.WeekID",
	"enrollment.HolidayAllocationWeek.HostSchoolID",
	"enrollment.HolidayAllocationWeek.WeekID",
	"enrollment.HolidayBookingChange.TimeModelID",
	"enrollment.HolidayBookingChange.WeekID",
	"enrollment.HolidayChildAnswers.ChildID",
	"enrollment.HolidayClosureSpan.SchoolIDs",
	"enrollment.HolidayClosureWeek.HostSchoolID",
	"enrollment.HolidayClosureWeek.PeriodID",
	"enrollment.HolidayClosureWeek.WeekID",
	"enrollment.HolidayCriterion.ID",
	"enrollment.HolidayCriterionCheck.ChildID",
	"enrollment.HolidayCriterionCheck.CriterionID",
	"enrollment.HolidayCriterionPeriod.ID",
	"enrollment.HolidayCriterionRef.ID",
	"enrollment.HolidayCriterionValue.CriterionID",
	"enrollment.HolidayKnownChild.ChildID",
	"enrollment.HolidayKnownChild.RegistrationID",
	"enrollment.HolidayKnownChild.SchoolID",
	"enrollment.HolidayPeriod.ID",
	"enrollment.HolidayPromotion.ChildID",
	"enrollment.HolidayPromotion.RegistrationID",
	"enrollment.HolidayPromotion.WeekID",
	"enrollment.HolidayRegistrationBooking.HostSchoolID",
	"enrollment.HolidayRegistrationBooking.TimeModelID",
	"enrollment.HolidayRegistrationBooking.WeekID",
	"enrollment.HolidayRegistrationChild.DuplicateRegistrationIDs",
	"enrollment.HolidayRegistrationChild.HomeSchoolID",
	"enrollment.HolidayRegistrationChild.ID",
	"enrollment.HolidayRegistrationCriterion.ChildID",
	"enrollment.HolidayRegistrationCriterion.CriterionID",
	"enrollment.HolidayRegistrationEvent.ActorAccountID",
	"enrollment.HolidayRegistrationEventDetails.ChildID",
	"enrollment.HolidayRegistrationEventDetails.Siblings",
	"enrollment.HolidayRegistrationEventDetails.WeekIDs",
	"enrollment.HolidayRegistrationHealth.ChildID",
	"enrollment.HolidayRegistrationMails.RegistrationID",
	"enrollment.HolidayRegistrationProof.ID",
	"enrollment.HolidayRegistrationSummary.ID",
	"enrollment.HolidayTimeModel.ID",
	"enrollment.HolidayWaitlistEntry.ChildID",
	"enrollment.HolidayWaitlistEntry.RegistrationID",
	"enrollment.HolidayWeek.HostSchoolID",
	"enrollment.HolidayWeek.ID",
	"enrollment.HolidayWeekPlaces.HostSchoolID",
	"enrollment.HolidayWeekPlaces.WeekID",
	"enrollment.TraegerCatalogSchool.SchoolID",
	"enrollment.TraegerPhase.ID",
	"enrollment.TraegerPhase.OrganizationID",
	"enrollmenthttp.HolidayClosurePreviewRequest.ClosingDayID",
	"enrollmenthttp.HolidayClosurePreviewRequest.SchoolIDs",
	"enrollmenthttp.HolidayCriterionCheckRequest.ChildID",
	"enrollmenthttp.HolidayCriterionCheckRequest.CriterionID",
	"enrollmenthttp.HolidayTimeModelRequest.ID",
	"enrollmenthttp.HolidayWeekRequest.HostSchoolID",
	"enrollmenthttp.HolidayWeekRequest.ID",
	"enrollmenthttp.holidayAllocationChoiceRequest.BookingID",
	"enrollmenthttp.holidayChildEditRequest.HomeSchoolID",
	"enrollmenthttp.holidayChildEditRequest.ID",
	"enrollmenthttp.holidayCriterionRequest.ID",
	"exporttransfer.TraegerAssignment.RecipientID",
	"exporttransfer.TraegerRecipient.ID",
	"exporttransfer.TraegerTransferEntry.ID",
	"exporttransfer.TraegerTransferEntry.RecipientID",
	"exporttransferhttp.AssignmentRequest.RecipientID",
	"holidayclosurenotification.Notice.ClosingDayID",
	"holidayclosurenotification.Notice.ID",
	"holidayclosurenotification.Notice.SchoolID",
	"notifications.feedEntryResponse.ID",
	"organizationtenancy.TraegerBankAccount.ID",
	"organizationtenancy.TraegerDocumentGroup.ID",
	"organizationtenancy.TraegerDocumentRelease.GroupID",
	"organizationtenancy.TraegerDocumentRelease.ID",
	"organizationtenancy.TraegerDocumentRelease.SchoolID",
	"organizationtenancy.TraegerDocumentReleaseInput.GroupID",
	"organizationtenancy.TraegerDocumentReleaseInput.SchoolID",
	"organizationtenancy.TraegerDocumentSchool.ID",
	"organizationtenancy.TraegerReportDistrict.SchoolID",
	"organizationtenancy.TraegerReportTemplate.ID",
	"parentbilling.CostBearerChoice.ID",
	"parentbilling.HolidayBookingChoice.TimeModelID",
	"parentbilling.HolidayBookingChoice.WeekID",
	"parentbilling.HolidayCancellation.MovedUp",
	"parentbilling.HolidayCancellation.RegistrationID",
	"parentbilling.HolidayChildDebtorNumber.ChildID",
	"parentbilling.HolidayChildDebtorNumberInput.ChildID",
	"parentbilling.HolidayDebtorNumber.RegistrationID",
	"parentbilling.HolidayPlaceChange.MovedUp",
	"parentbilling.HolidayPlaceChange.RegistrationID",
	"parentbilling.HolidayPlaceChange.WeekID",
	"parentbilling.HolidaySibling.RegistrationID",
	"parentbilling.HolidaySiblingChild.ID",
	"parentbilling.HolidaySiblingGroup.ID",
	"parentbilling.HolidaySiblingGroup.RegistrationIDs",
	"parentbillinghttp.HolidayChildContributionResponse.ChildID",
	"parentbillinghttp.HolidayConfirmRequest.CostBearerID",
	"parentbillinghttp.HolidayConfirmationResponse.RegistrationID",
	"parentbillinghttp.HolidayContributionLineResponse.CostBearerID",
	"parentbillinghttp.HolidayContributionResponse.CostBearerID",
	"parentbillinghttp.HolidaySiblingMergeRequest.RegistrationIDs",
	"peopledirectory.NewStudentGuardian.GuardianProfileID",
	"presenceprojectionhttp.NameStudentResponse.ID",
	"presenceprojectionhttp.SlimStudentResponse.CompanionStudentIDs",
	"presenceprojectionhttp.SlimStudentResponse.GroupID",
	"presenceprojectionhttp.SlimStudentResponse.ID",
	"presenceprojectionhttp.StudentResponse.CompanionStudentIDs",
	"presenceprojectionhttp.StudentResponse.GroupID",
	"presenceprojectionhttp.StudentResponse.ID",
	"presenceprojectionhttp.StudentResponse.PersonID",
	"presenceprojectionhttp.StudentResponse.PhotoConsentGivenBy",
	"presenceprojectionhttp.SupervisorContact.ID",
	"staffcalendarhttp.TraegerClosingDayRequest.SchoolIDs",
	"timetable.InstanceConflictWarning.ConflictingInstanceID",
	"timetable.InstanceConflictWarning.ResourceID",
	"timetable.OperationParallelPresence.InstanceID",
	"timetable.OperationPlannedInstance.ActiveGroupID",
	"timetable.OperationPlannedInstance.AssignedStaffIDs",
	"timetable.OperationPlannedInstance.ID",
	"timetable.OperationPlannedInstance.RoomID",
	"timetable.OperationRosterInstance.ActiveGroupID",
	"timetable.OperationRosterInstance.ID",
	"timetable.OperationRosterInstance.RoomID",
	"timetable.OperationRosterRow.StudentID",
	"timetable.OperationRosterRow.VisitID",
	"timetable.OperationRosterWarning.CurrentEducationGroup",
	"timetable.OperationRosterWarning.ExpectedGroupID",
	"timetable.OperationStaffName.StaffID",
	"timetable.ScheduledInstance.ActiveGroupID",
	"timetable.ScheduledInstance.ActivityGroupID",
	"timetable.ScheduledInstance.CalendarPeriodID",
	"timetable.ScheduledInstance.CompletedBy",
	"timetable.ScheduledInstance.CreatedBy",
	"timetable.ScheduledInstance.ID",
	"timetable.ScheduledInstance.RoomID",
	"timetable.ScheduledInstance.StartedBy",
	"timetable.ScheduledInstance.TenantID",
	"timetablehttp.CompleteOperationRequest.ConfirmedPresentStudentIDs",
	"timetablehttp.HomeworkFeedbackResponse.StudentID",
	"timetablehttp.startOperationResponse.ActiveGroupID",
	"timetablehttp.startOperationResponse.InstanceID",
	"traeger.ReportDistrictRequest.SchoolID",
	"traegercalendar.CalendarSchool.ID",
	"traegercalendar.ClosingDay.ID",
	"traegercalendar.ClosingDay.SchoolIDs",
	"traegercatalog.OfferingPlan.TraegerOfferingID",
	"traegercatalog.Preview.TraegerPhaseID",
	"traegercatalog.Rollout.TraegerPhaseID",
	"traegercatalog.SchoolPlan.SchoolID",
	"traegercatalog.SchoolResult.SchoolID",
	"traegercataloghttp.PhaseRequest.SchoolIDs",
	"traegerportal.SchoolSessionRequest.SchoolID",
	"traegerportal.TraegerHistoryEntryResponse.ID",
	"traegerportal.TraegerInvitationResponse.ID",
	"traegerportal.TraegerMemberResponse.AccountID",
	"traegerportal.TraegerProfileResponse.AccountID",
	"traegerstaff.IDResponse.ID",
	"traegerstaff.ProofMappingRequest.ProofTypeID",
	"traegerstaff.ProofMappingRequest.SchoolID",
	"traegerstaff.ProofMappingRequest.SchoolTypeID",
	"traegerstaff.StaffLinkRequest.StaffRecordID",
	"traegerview.AccessLogEntry.AccountID",
	"traegerview.AccessLogEntry.SchoolID",
	"traegerview.AccessLogPerson.AccountID",
	"traegerview.ChildAttendance.StudentID",
	"traegerview.KeyDateReportTemplate.ID",
	"traegerview.KeyDateSchool.ID",
	"traegerview.OccupancyCareForm.ID",
	"traegerview.OccupancyGroup.ID",
	"traegerview.School.ID",
	"traegerview.Traeger.ID",
	"traegerview.UtilizationOffering.ID",
	"traegerview.UtilizationRoom.ID",
	"workforce.PoolBlock.ID",
	"workforce.PoolBlock.SchoolID",
	"workforce.PoolSpringer.RecordID",
	"workforce.TraegerAbsenceAccount.AbsenceTypeID",
	"workforce.TraegerAbsenceSchoolUse.SchoolID",
	"workforce.TraegerAbsenceType.ID",
	"workforce.TraegerAbsenceTypeSchool.SchoolID",
	"workforce.TraegerContractSite.SchoolID",
	"workforce.TraegerContractSite.StaffID",
	"workforce.TraegerFutureShifts.SchoolID",
	"workforce.TraegerPlanningAbsentDay.SchoolID",
	"workforce.TraegerPlanningPerson.RecordID",
	"workforce.TraegerPlanningShift.ID",
	"workforce.TraegerPlanningShift.SchoolID",
	"workforce.TraegerPlanningShift.StaffID",
	"workforce.TraegerPlanningSite.SchoolID",
	"workforce.TraegerPlanningSite.StaffID",
	"workforce.TraegerPlanningSollDay.SchoolID",
	"workforce.TraegerSchoolProofKind.ProofTypeID",
	"workforce.TraegerSchoolProofKind.SchoolTypeID",
	"workforce.TraegerSchoolProofKinds.SchoolID",
	"workforce.TraegerStaffCandidate.SchoolID",
	"workforce.TraegerStaffCandidate.StaffID",
	"workforce.TraegerStaffChange.SchoolID",
	"workforce.TraegerStaffContract.ID",
	"workforce.TraegerStaffEmployment.SchoolID",
	"workforce.TraegerStaffEmployment.StaffID",
	"workforce.TraegerStaffMemberRef.SchoolID",
	"workforce.TraegerStaffMemberRef.StaffID",
	"workforce.TraegerStaffProof.TypeID",
	"workforce.TraegerStaffProofEntry.RecordID",
	"workforce.TraegerStaffProofEntry.TypeID",
	"workforce.TraegerStaffProofType.ID",
	"workforce.TraegerStaffRecordSummary.ID",
	"workforce.TraegerStaffSchool.ID",
	"workforce.TraegerStaffSuggestion.RecordID",
	"workforce.TraegerTimeAccountSchool.SchoolID",
	"worktimemodels.AssignRequest.StaffIDs",
	"worktimemodels.AssignResponse.AssignedStaffIDs",
	"worktimemodels.AssignResponse.UnchangedStaffIDs",
	"worktimemodels.DeletedResponse.ID",
	"worktimemodels.ModelResponse.ID",
	"worktimemodels.StaffFactResponse.StaffID",
	"worktimemodels.StaffFactResponse.WorkTimeModelID",
}

// Legacy returns the registers of the routes registered today, with the
// identifier types the root names.
func Legacy(identifiers map[reflect.Type]string) Options {
	return Options{
		Identifiers:   identifiers,
		NumericIDs:    legacyNumericIDs,
		QueryVariants: []string{"GET /api/students/"},
	}
}
