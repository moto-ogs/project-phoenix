package announcement

import "github.com/moto-ogs/project-phoenix/api/common"

// SurveyRouteContracts registers the typed contract of the staff surveys
// (ADR 0270), with patterns relative to /api/surveys. The PDF export answers
// a file and keeps its route file.
func SurveyRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Response: []surveyResponse{}},
		{Method: "POST", Pattern: "/", Portals: portals, Request: surveyRequest{}, Response: surveyResponse{}},
		{Method: "GET", Pattern: "/to-answer", Portals: portals, Response: []surveyToAnswerResponse{}},
		{Method: "GET", Pattern: "/{surveyId}", Portals: portals, Response: surveyResponse{}},
		{Method: "PUT", Pattern: "/{surveyId}", Portals: portals, Request: surveyRequest{}, Response: surveyResponse{}},
		{Method: "DELETE", Pattern: "/{surveyId}", Portals: portals, Response: deletedResponse{}},
		{Method: "GET", Pattern: "/{surveyId}/form", Portals: portals, Response: surveyFormResponse{}},
		{Method: "POST", Pattern: "/{surveyId}/answers", Portals: portals, Request: surveyAnswersRequest{}, Response: surveySubmittedResponse{}},
		{Method: "POST", Pattern: "/{surveyId}/publish", Portals: portals, Response: surveyResponse{}},
		{Method: "POST", Pattern: "/{surveyId}/close", Portals: portals, Response: surveyResponse{}},
		{Method: "POST", Pattern: "/{surveyId}/remind", Portals: portals, Response: surveyRemindedResponse{}},
		{Method: "GET", Pattern: "/{surveyId}/results", Portals: portals, Response: surveyResultsResponse{}},
		{Method: "GET", Pattern: "/{surveyId}/respondents", Portals: portals, Response: []surveyRespondentResponse{}},
	}
}

// surveyRemindedResponse and surveySubmittedResponse are the small answers
// of a survey write that returns no survey.
type surveyRemindedResponse struct {
	Reminded int `json:"reminded"`
}

type surveySubmittedResponse struct {
	Submitted bool `json:"submitted"`
}
