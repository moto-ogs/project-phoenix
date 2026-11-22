//go:build testhooks

package httpadapter

// The pure response, update and error helpers of this adapter, named for the
// unit tests that pin them without a route fixture.
var (
	BuildBaseActivityResponseForTest = buildBaseActivityResponse
	AddCategoryToResponseForTest     = addCategoryToResponse
	AddSupervisorsToResponseForTest  = addSupervisorsToResponse
	AddSchedulesToResponseForTest    = addSchedulesToResponse
	UpdateGroupFieldsForTest         = updateGroupFields
	NewCategoryResponseForTest       = newCategoryResponse
	NewScheduleResponseForTest       = newScheduleResponse
	NewSupervisorResponseForTest     = newSupervisorResponse
	SystemActivityForbiddenForTest   = systemActivityForbidden
	TimetableTemplateConflictForTest = timetableTemplateConflict
)
