package presenceprojectionhttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	lists "github.com/moto-ogs/project-phoenix/modules/documentrendering/lists"
	peopleModule "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory/departure"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
)

// StudentRouteContracts registers the typed contract of the student reads
// (ADR 0270), with patterns relative to the resource's mount. A route listed
// here is decoded by the frontend against these types.
func StudentRouteContracts() []common.RouteContract {
	tenant := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{
			Method: "GET", Pattern: "/", Portals: tenant, Paginated: true,
			Query: studentListQuery(),
			Variants: &common.ResponseVariants{
				QueryParam: "view", Default: StudentListViewFull,
				ByValue: map[string]any{
					StudentListViewFull:  []StudentResponse{},
					StudentListViewSlim:  []SlimStudentResponse{},
					StudentListViewNames: []NameStudentResponse{},
				},
			},
			Enums: studentEnums(),
		},
		{
			Method: "GET", Pattern: "/{id}", Portals: tenant,
			Query:    []common.QueryParam{{Name: "include_privacy_consent", Kind: common.QueryBool}},
			Response: StudentDetailResponse{},
		},
		{
			Method: "GET", Pattern: "/{id}/attendance-history", Portals: tenant,
			// RFC 3339 instants.
			Query:    []common.QueryParam{{Name: "start", Kind: common.QueryString}, {Name: "end", Kind: common.QueryString}},
			Response: attendanceHistoryResponse{},
		},
		{
			Method: "GET", Pattern: "/{id}/attendance-history/export", Portals: tenant, File: true,
			Query: []common.QueryParam{
				{Name: "format", Kind: common.QueryString, Values: []string{string(lists.FormatPDF), string(lists.FormatDOCX), string(lists.FormatXLSX)}},
				{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate},
			},
		},
		// The filter and column choice of the export, bounded like the
		// former route file's body (1 MiB).
		{Method: "POST", Pattern: "/export", Portals: tenant, Request: studentExportRequest{}, MaxBodyBytes: 1 << 20, File: true},
		{
			Method: "GET", Pattern: "/day-log", Portals: tenant,
			Query:    []common.QueryParam{{Name: "date", Kind: common.QueryDate}, {Name: "group_id", Kind: common.QueryID}},
			Response: dayLogResponse{},
		},
		{Method: "GET", Pattern: "/{id}/status-days", Portals: tenant, Query: statusDayRangeQuery(), Response: []studentpresence.StudentStatusDayResponse{}},
		{
			Method: "GET", Pattern: "/status-days", Portals: tenant,
			Query: append(statusDayRangeQuery(),
				common.QueryParam{Name: "group_id", Kind: common.QueryID},
				common.QueryParam{Name: "page", Kind: common.QueryInt}, common.QueryParam{Name: "page_size", Kind: common.QueryInt},
				common.QueryParam{Name: "status", Kind: common.QueryString}, common.QueryParam{Name: "q", Kind: common.QueryString},
			),
			Response: statusDayOverviewResponse{},
		},
		// The filter options of the child list; their reshaping route files
		// left in #7563.
		{Method: "GET", Pattern: "/care-offerings", Portals: tenant, Response: []CareOfferingOptionResponse{}},
		{Method: "GET", Pattern: "/enrollment-answer-filters", Portals: tenant, Response: []EnrollmentAnswerFilterResponse{}},
	}
}

// statusDayRangeQuery is the day range both status-day reads take.
func statusDayRangeQuery() []common.QueryParam {
	return []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}}
}

// studentListQuery names every parameter the list handler reads;
// TestStudentListContractNamesEveryQueryParameterTheHandlerReads keeps it so.
func studentListQuery() []common.QueryParam {
	flag := func(name string) common.QueryParam { return common.QueryParam{Name: name, Kind: common.QueryBool} }
	text := func(name string) common.QueryParam {
		return common.QueryParam{Name: name, Kind: common.QueryString}
	}
	return []common.QueryParam{
		{Name: "view", Kind: common.QueryString, Values: []string{StudentListViewFull, StudentListViewSlim, StudentListViewNames}},
		{Name: "page", Kind: common.QueryInt},
		{Name: "page_size", Kind: common.QueryInt},
		text("search"), text("first_name"), text("last_name"),
		{Name: "school_class", Kind: common.QueryString, Repeated: true},
		{Name: "grade_level", Kind: common.QueryInt, Repeated: true},
		{Name: "group_id", Kind: common.QueryID, Repeated: true},
		{Name: "room_id", Kind: common.QueryID},
		text("location"), text("location_state"),
		{Name: "date", Kind: common.QueryDate},
		{Name: "day_status", Kind: common.QueryString, Values: []string{DayPlanningStatusAll, DayPlanningStatusComesToday, DayPlanningStatusNotComingToday}},
		{Name: "care_status", Kind: common.QueryString, Values: []string{CareStatusRunning, CareStatusEnded, CareStatusAll}},
		{Name: "care_offering_id", Kind: common.QueryID},
		text("enrollment_answer"), text("bus"), text("photo_consent"), text("pickup_status"),
		flag("include_pickup_times"), flag("include_arrival_times"), flag("include_companions"), flag("include_pending_withdrawals"),
	}
}

// studentEnums states the closed value sets reflection cannot see.
func studentEnums() []common.EnumContract {
	return []common.EnumContract{
		{
			Type:   departure.DepartureMode(""),
			Values: []string{string(departure.DepartureAlone), string(departure.DepartureBus), string(departure.DeparturePickup), string(departure.DepartureAccompanied)},
		},
		{
			Name:   "DayPlanningStatus",
			Fields: []string{"StudentResponse.day_planning_status", "SlimStudentResponse.day_planning_status"},
			Values: []string{DayPlanningStatusComesToday, DayPlanningStatusNotComingToday},
		},
		{
			Name:   "DayPlanningReason",
			Fields: []string{"StudentResponse.day_planning_reason", "SlimStudentResponse.day_planning_reason"},
			Values: []string{
				careplan.DayPlanningReasonSick, careplan.DayPlanningReasonExcused, careplan.DayPlanningReasonClassTrip,
				careplan.DayPlanningReasonArrivalException, careplan.DayPlanningReasonPickupException,
				careplan.DayPlanningReasonArrivalSchedule, careplan.DayPlanningReasonPickupSchedule,
				careplan.DayPlanningReasonTimetable, careplan.DayPlanningReasonUnplanned, careplan.DayPlanningReasonNoPlan,
			},
		},
		{
			// A stored free text from before the departure plan still travels here.
			Name:   "PickupStatus",
			Fields: []string{"StudentResponse.pickup_status"},
			Values: []string{departure.PickupStatusPickedUp, departure.PickupStatusGoesAlone, departure.PickupStatusAccompanied},
		},
		{
			Name:   "SupervisorRole",
			Fields: []string{"SupervisorContact.role"},
			Values: []string{SupervisorRoleTeacher},
		},
		{
			Name:   "StudentConsentKey",
			Fields: []string{"StudentConsentResponse.key"},
			Values: []string{
				peopleModule.StudentConsentAGB, peopleModule.StudentConsentDataProcessing,
				peopleModule.StudentConsentEmailContact, peopleModule.StudentConsentPhoto,
			},
		},
		{
			Name:   "AttendanceActorKind",
			Fields: []string{"AttendanceActorResponse.kind"},
			Values: []string{
				string(studentpresence.AttendanceActorStaff), string(studentpresence.AttendanceActorDevice),
				string(studentpresence.AttendanceActorFormerStaff), string(studentpresence.AttendanceActorAutomatic),
			},
		},
		{
			Name:   "StudentConsentState",
			Fields: []string{"StudentConsentResponse.state"},
			Values: []string{peopleModule.StudentConsentStateGranted, peopleModule.StudentConsentStateWithdrawn, peopleModule.StudentConsentStateNotRecorded},
		},
	}
}
