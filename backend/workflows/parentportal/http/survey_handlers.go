package parent

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// Parent surveys (#4781): the form of a survey entry and its answers.

type parentSurveyOptionResponse struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type parentSurveyQuestionResponse struct {
	ID       string                       `json:"id"`
	Position int                          `json:"position"`
	Kind     string                       `json:"kind"`
	Prompt   string                       `json:"prompt"`
	Required bool                         `json:"required"`
	Options  []parentSurveyOptionResponse `json:"options"`
}

type parentSurveyFormSurvey struct {
	ID        string                         `json:"id"`
	Title     string                         `json:"title"`
	Intro     string                         `json:"intro"`
	Anonymous bool                           `json:"anonymous"`
	ClosesAt  time.Time                      `json:"closes_at"`
	Questions []parentSurveyQuestionResponse `json:"questions"`
}

// SurveyFormResponse is the survey a guardian answers.
type SurveyFormResponse struct {
	Survey       parentSurveyFormSurvey `json:"survey"`
	SchoolName   string                 `json:"school_name"`
	Participated bool                   `json:"participated"`
}

func toSurveyFormResponse(f *parentService.SurveyForm) SurveyFormResponse {
	questions := make([]parentSurveyQuestionResponse, 0, len(f.Questions))
	for _, q := range f.Questions {
		options := make([]parentSurveyOptionResponse, 0, len(q.Options))
		for _, o := range q.Options {
			options = append(options, parentSurveyOptionResponse{ID: strconv.FormatInt(o.ID, 10), Label: o.Label})
		}
		questions = append(questions, parentSurveyQuestionResponse{
			ID: strconv.FormatInt(q.ID, 10), Position: q.Position, Kind: q.Kind, Prompt: q.Prompt, Required: q.Required, Options: options,
		})
	}
	return SurveyFormResponse{
		Survey: parentSurveyFormSurvey{
			ID: strconv.FormatInt(f.SurveyID, 10), Title: f.Title, Intro: f.Intro, Anonymous: f.Anonymous, ClosesAt: f.ClosesAt, Questions: questions,
		},
		SchoolName: f.SchoolName, Participated: f.Participated,
	}
}

// SurveySubmittedResponse confirms that the answers were stored.
type SurveySubmittedResponse struct {
	Submitted bool `json:"submitted"`
}

type parentSurveyAnswerRequest struct {
	QuestionID string   `json:"question_id"`
	OptionIDs  []string `json:"option_ids,omitempty"`
	ScaleValue *int     `json:"scale_value,omitempty"`
	Text       *string  `json:"text,omitempty"`
}

type parentSurveyAnswersRequest struct {
	Answers []parentSurveyAnswerRequest `json:"answers"`
}

func decodeSurveyAnswers(r *http.Request) ([]parentService.SurveyAnswer, error) {
	var req parentSurveyAnswersRequest
	if err := wire.Decode(r.Body, &req); err != nil {
		return nil, errors.New("invalid request body")
	}
	out := make([]parentService.SurveyAnswer, 0, len(req.Answers))
	for _, a := range req.Answers {
		questionID, err := strconv.ParseInt(a.QuestionID, 10, 64)
		if err != nil || questionID <= 0 {
			return nil, errors.New("invalid question_id")
		}
		answer := parentService.SurveyAnswer{QuestionID: questionID, ScaleValue: a.ScaleValue, Text: a.Text}
		for _, raw := range a.OptionIDs {
			id, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || id <= 0 {
				return nil, errors.New("invalid option id")
			}
			answer.OptionIDs = append(answer.OptionIDs, id)
		}
		out = append(out, answer)
	}
	return out, nil
}

func (rs *Resource) getAnnouncementSurvey(w http.ResponseWriter, r *http.Request) {
	accountID, ok := rs.parentAccountID(w, r)
	if !ok {
		return
	}
	announcementID, ok := parseAnnouncementID(w, r)
	if !ok {
		return
	}
	form, err := rs.ParentService.GetAnnouncementSurvey(r.Context(), accountID, announcementID)
	if err != nil {
		renderParentWriteError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, toSurveyFormResponse(form), "Survey retrieved")
}

// submitAnnouncementSurvey stores the answers. The request body is never
// logged; the response says only that the answers were stored.
func (rs *Resource) submitAnnouncementSurvey(w http.ResponseWriter, r *http.Request) {
	accountID, ok := rs.parentAccountID(w, r)
	if !ok {
		return
	}
	announcementID, ok := parseAnnouncementID(w, r)
	if !ok {
		return
	}
	answers, err := decodeSurveyAnswers(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	if err := rs.ParentService.SubmitAnnouncementSurvey(r.Context(), accountID, announcementID, answers); err != nil {
		renderParentWriteError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, SurveySubmittedResponse{Submitted: true}, "Survey answered")
}
