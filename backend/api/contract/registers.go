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
	"platformannouncements.AnnouncementResponse.ID",
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
	"users.GuardianLinkResponse.GuardianProfileID",
	"users.GuardianLinkResponse.ID",
	"users.GuardianLinkResponse.StudentID",
	"users.GuardianLinkResponse.TenantID",
	"users.GuardianPickerResponse.ID",
	"users.GuardianResponse.AccountID",
	"users.GuardianResponse.ID",
	"users.GuardianWithRelationship.RelationshipID",
	"users.PhoneNumberResponse.ID",
	"users.StudentGuardianLinkRequest.GuardianProfileID",
	"users.bulkInviteRequest.StudentIDs",
	"users.guardianEmailStatusResponse.GuardianProfileID",
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
