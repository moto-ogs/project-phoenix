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
	"carecontract.CandidateKey.RequestChildID",
	"carecontract.CandidateKey.SchoolID",
	"carecontract.ChangeLine.CareOfferingID",
	"carecontract.ChangeRequest.ID",
	"carecontract.ContractSummary.ID",
	"carecontract.ContractSummary.SchoolID",
	"carecontract.ContractSummary.StudentID",
	"carecontract.ContractTemplate.ID",
	"carecontract.NoticeOptions.ContractID",
	"carecontract.OfferingTemplate.OfferingID",
	"carecontract.OfferingTemplate.SchoolID",
	"carecontract.OverrunChild.SchoolID",
	"carecontract.OverrunChild.StudentID",
	"carecontract.SchoolConclusion.SchoolID",
	"carecontract.SchoolOverruns.SchoolID",
	"carecontract.SendResult.Sent",
	"carecontract.SendSkip.ID",
	"carecontract.Service.CareOfferingID",
	"carecontract.Version.ID",
	"carecontracthttp.SendRequest.ContractIDs",
	"careplanhttp.StudentRequest.GroupID",
	"careplanhttp.UpdateStudentRequest.GroupID",
	"classday.AbsenceListChild.StudentID",
	"classday.DayRow.StudentID",
	"classday.SupervisionStudentSheet.StudentID",
	"classdayhttp.ClassHandoverRequest.AbsentStudentIDs",
	"classdayhttp.ClassHandoverRequest.PresentStudentIDs",
	"classdayhttp.ClassTripRequest.StudentIDs",
	"classdayhttp.MorningAttendanceMarkRequest.StudentID",
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
	"parentbilling.BillingCarriedCorrection.PositionID",
	"parentbilling.BillingChild.ChildID",
	"parentbilling.BillingCorrection.ChildID",
	"parentbilling.BillingCorrection.CreatedByAccountID",
	"parentbilling.BillingCorrection.ID",
	"parentbilling.BillingDocument.ID",
	"parentbilling.BillingDocument.ReferenceDocumentID",
	"parentbilling.BillingDocument.RegistrationChildID",
	"parentbilling.BillingDocument.RegistrationID",
	"parentbilling.BillingDocument.RunID",
	"parentbilling.BillingDocumentLink.ID",
	"parentbilling.BillingDocumentLink.RunID",
	"parentbilling.BillingFamily.ID",
	"parentbilling.BillingFamilyDocument.ID",
	"parentbilling.BillingFamilyDocument.ReferenceDocumentID",
	"parentbilling.BillingFamilyDocument.RunID",
	"parentbilling.BillingLetterMailing.DocumentID",
	"parentbilling.BillingLetters.CreatedByAccountID",
	"parentbilling.BillingPosition.CostBearerID",
	"parentbilling.BillingRun.HolidayPeriodID",
	"parentbilling.BillingRun.ID",
	"parentbilling.BookingOffering.CareOfferingID",
	"parentbilling.BookingOffering.SchoolID",
	"parentbilling.CareAmendment.AccountID",
	"parentbilling.CareAmendment.ID",
	"parentbilling.CareCostBearerTotal.CostBearerID",
	"parentbilling.CareCostShare.ContractID",
	"parentbilling.CareCostShare.CostBearerID",
	"parentbilling.CareCostShare.ID",
	"parentbilling.CareCostShareContract.ContractID",
	"parentbilling.CareCostShareContract.SchoolID",
	"parentbilling.CareCostShareInput.ContractID",
	"parentbilling.CareCostShareInput.CostBearerID",
	"parentbilling.CareDuplicateContract.ContractID",
	"parentbilling.CareDuplicateContract.SchoolID",
	"parentbilling.CareEvidence.ContractID",
	"parentbilling.CareEvidence.ID",
	"parentbilling.CareEvidence.RuleID",
	"parentbilling.CareEvidenceContract.ContractID",
	"parentbilling.CareEvidenceContract.SchoolID",
	"parentbilling.CareEvidenceInput.ContractID",
	"parentbilling.CareEvidenceInput.RuleID",
	"parentbilling.CareExclusion.AccountID",
	"parentbilling.CareFeeNoticeHold.ContractID",
	"parentbilling.CareFeeNoticeHold.SchoolID",
	"parentbilling.CareInvoice.ContractID",
	"parentbilling.CareInvoice.ID",
	"parentbilling.CareInvoice.SchoolID",
	"parentbilling.CareInvoiceCostShare.CostBearerID",
	"parentbilling.CareLetterMailing.InvoiceID",
	"parentbilling.CareMealChanged.SchoolID",
	"parentbilling.CareMealChanged.StudentID",
	"parentbilling.CareMealGap.SchoolID",
	"parentbilling.CareMealPosition.SchoolID",
	"parentbilling.CareMealPosition.StudentID",
	"parentbilling.CareMealTariff.ID",
	"parentbilling.CareMealTariff.SchoolID",
	"parentbilling.CareMealUnbilled.SchoolID",
	"parentbilling.CareMealUnbilled.StudentID",
	"parentbilling.CareModule.CareOfferingID",
	"parentbilling.CareModule.SchoolID",
	"parentbilling.CareNotice.ContractID",
	"parentbilling.CareNotice.ID",
	"parentbilling.CareNotice.SchoolID",
	"parentbilling.CareNoticeLine.CareOfferingID",
	"parentbilling.CareNoticeMailing.ContractID",
	"parentbilling.CareNoticeMailing.NoticeID",
	"parentbilling.CareNoticeReference.ID",
	"parentbilling.CareNoticeRun.ID",
	"parentbilling.CareNoticeRun.SchoolIDs",
	"parentbilling.CarePosition.CareOfferingID",
	"parentbilling.CarePriceListHead.SchoolID",
	"parentbilling.CareReduction.CareOfferingIDs",
	"parentbilling.CareReduction.RuleID",
	"parentbilling.CareRevocation.AccountID",
	"parentbilling.CareRuleInput.CareOfferingIDs",
	"parentbilling.CareRuleInput.CountSchoolIDs",
	"parentbilling.CareRuleInput.SchoolIDs",
	"parentbilling.CareRun.ID",
	"parentbilling.CareRunSchool.ID",
	"parentbilling.CareRunSchool.OpenRunID",
	"parentbilling.CareRunScope.SchoolIDs",
	"parentbilling.CareSchool.ID",
	"parentbilling.CareTariff.CareOfferingID",
	"parentbilling.CareTariff.ID",
	"parentbilling.CareTariff.SchoolID",
	"parentbilling.CareUncountedContract.ContractID",
	"parentbilling.CareUnpriced.CareOfferingID",
	"parentbilling.CareUnpriced.ContractID",
	"parentbilling.CareUnpriced.SchoolID",
	"parentbilling.ContributionRule.CareOfferingIDs",
	"parentbilling.ContributionRule.CountSchoolIDs",
	"parentbilling.ContributionRule.ID",
	"parentbilling.ContributionRule.SchoolIDs",
	"parentbilling.CostBearer.ID",
	"parentbilling.CostCenter.ID",
	"parentbilling.CostCenter.ScopeID",
	"parentbilling.DatevRunOverview.RunID",
	"parentbilling.ExportProtocolEntry.ExportedBy",
	"parentbilling.ExportProtocolEntry.ID",
	"parentbilling.ExportProtocolEntry.RunID",
	"parentbilling.ExportRun.RunID",
	"parentbilling.FamilyBilling.ContractID",
	"parentbilling.FamilyBilling.ID",
	"parentbilling.FamilyChildCount.ContractID",
	"parentbilling.FamilyChildCount.ID",
	"parentbilling.FamilyChildren.ContractID",
	"parentbilling.FamilyChildrenInput.ContractID",
	"parentbilling.FamilyContractChild.ContractID",
	"parentbilling.HolidayBillingPeriod.ID",
	"parentbilling.InvoiceHistory.ID",
	"parentbilling.InvoiceHistoryEntry.AccountID",
	"parentbilling.InvoiceMandate.MandateID",
	"parentbilling.RevenueAccount.ScopeID",
	"parentbilling.SEPADebit.ContractID",
	"parentbilling.SEPADebit.ID",
	"parentbilling.SEPADebit.MandateID",
	"parentbilling.SEPADebit.NoticeID",
	"parentbilling.SEPADebit.RunID",
	"parentbilling.SEPADebitRun.RunID",
	"parentbilling.SEPAMandate.ContractID",
	"parentbilling.SEPAMandate.ID",
	"parentbilling.SEPAMandateEvent.AccountID",
	"parentbilling.SEPAMandateEvent.ID",
	"parentbillinghttp.BillingCorrectionRequest.ChildID",
	"parentbillinghttp.BillingCorrectionRequest.RegistrationID",
	"parentbillinghttp.BillingCreditRequest.ChildID",
	"parentbillinghttp.BillingRunRequest.HolidayPeriodID",
	"parentbillinghttp.CareAmendmentRequest.ContractID",
	"parentbillinghttp.CareAmendmentRequest.RevokesID",
	"parentbillinghttp.CareExclusionRequest.ContractID",
	"parentbillinghttp.CareInclusionRequest.ContractID",
	"parentbillinghttp.CareMealPriceRequest.SchoolID",
	"parentbillinghttp.CareNoticeRunRequest.SchoolIDs",
	"parentbillinghttp.CarePriceListRequest.SchoolID",
	"parentbillinghttp.CarePriceRequest.CareOfferingID",
	"parentbillinghttp.CareRunRequest.SchoolIDs",
	"parentbillinghttp.CostCenterRequest.ScopeID",
	"parentbillinghttp.FamilyBillingRequest.ContractID",
	"parentbillinghttp.RevenueAccountRequest.ScopeID",
	"parentbillinghttp.SEPAMandateRequest.ContractID",
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
