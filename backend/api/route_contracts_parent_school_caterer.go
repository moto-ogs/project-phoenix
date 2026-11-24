package api

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/classday"
	classdayHTTP "github.com/moto-ogs/project-phoenix/modules/classday/http"
	messageAttachmentsHTTP "github.com/moto-ogs/project-phoenix/modules/communication/http/messageattachments"
	announcementAPI "github.com/moto-ogs/project-phoenix/modules/communication/http/parentannouncements"
	staffMessagingAPI "github.com/moto-ogs/project-phoenix/modules/communication/http/staffmessages"
	enrollmentHTTP "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	catererAuthHTTP "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/catererauth"
	parentAuthHTTP "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/parentauth"
	calendarAPI "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/http"
	schoolPortalHTTP "github.com/moto-ogs/project-phoenix/modules/schoolportal"
	timetableHTTP "github.com/moto-ogs/project-phoenix/modules/timetable/http"
	catererPortalHTTP "github.com/moto-ogs/project-phoenix/workflows/catererportal/http"
	parentAPI "github.com/moto-ogs/project-phoenix/workflows/parentportal/http"
)

func parentContractMounts() []contractMount {
	return []contractMount{
		{"/parent", parentAPI.MeRouteContracts()},
		{"/parent", parentPortalRouteContracts()},
		{"/parent", parentAuthHTTP.SecondFactorRouteContracts()},
		{"/parent", parentAuthHTTP.SessionRouteContracts()},
	}
}

// parentPortalRouteContracts registers the guardians' routes below /parent.
// Enrollment renders the form load and submission (parentEnrollmentForms
// binds it) and Care Contract the contract to sign
// (NewParentContractDocuments), so their types are named here.
func parentPortalRouteContracts() []common.RouteContract {
	return parentAPI.PortalRouteContracts(parentAPI.ForeignContractTypes{
		EnrollmentBootstrap:          enrollmentHTTP.PublicEnrollmentFormBootstrapResponse{},
		EnrollmentSubmitRequest:      enrollmentHTTP.SubmitEnrollmentRequest{},
		EnrollmentSubmit:             enrollmentHTTP.SubmitEnrollmentResponse{},
		ContractSigning:              carecontract.SigningView{},
		EnrollmentUpload:             enrollmentHTTP.UploadReceipt{},
		EnrollmentUploadMaxBodyBytes: enrollmentHTTP.MaxUploadBodyBytes,
		EnrollmentUploadTooLargeCode: common.CodeEnrollmentUploadInvalid,
	})
}

func schoolContractMounts() []contractMount {
	return []contractMount{
		{"/school/class-day", classdayHTTP.RouteContracts()},
		{"/school/notifications", notificationRouteContracts(common.PortalSchool)},
		{"/school/parent-letters", announcementAPI.RouteContracts(common.PortalSchool)},
		// The school portal’s chat files are mounted beside /school.
		{"/school-staff-messages", messageAttachmentsHTTP.RouteContracts(common.PortalSchool)},
		{"/school/calendar", calendarAPI.SchoolRouteContracts()},
		{"/school/staff-notices", timetableHTTP.SchoolStaffNoticeRouteContracts()},
		// Class Day owns the child sheet the supervision route answers with.
		{"/school/supervisions", timetableHTTP.SchoolSupervisionRouteContracts(classday.SupervisionStudentSheet{})},
		{"/school/staff-messages", staffMessagingAPI.RouteContracts(common.PortalSchool)},
		{"/school/auth", schoolPortalHTTP.AuthRouteContracts()},
		{"/school/auth", schoolPortalHTTP.SessionRouteContracts()},
	}
}

func catererContractMounts() []contractMount {
	return []contractMount{
		{"/caterer", catererPortalHTTP.RouteContracts()},
		{"/caterer/notifications", schoolFeedRouteContracts(common.PortalCaterer)},
		{"/caterer", catererAuthHTTP.SecondFactorRouteContracts()},
		{"/caterer", catererAuthHTTP.SessionRouteContracts()},
	}
}
