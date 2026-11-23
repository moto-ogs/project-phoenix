package feedback_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api/testutil/routetest"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	feedbackModule "github.com/moto-ogs/project-phoenix/modules/feedback"
	feedbackHTTP "github.com/moto-ogs/project-phoenix/modules/feedback/http"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type engine struct {
	available    bool
	availableErr error
	entries      []feedbackModule.Entry
	err          error
}

func (e engine) Available(context.Context) (bool, error) { return e.available, e.availableErr }
func (e engine) Submit(_ context.Context, input feedbackModule.CreateEntry) (feedbackModule.Entry, error) {
	return feedbackModule.Entry{ID: 7, Value: input.Value, Day: input.Day, Time: input.Time, StudentID: input.StudentID}, e.err
}
func (e engine) FindEntries(context.Context, feedbackModule.Filter) ([]feedbackModule.Entry, error) {
	return e.entries, e.err
}
func (e engine) DeleteExpired(context.Context) (int, error)          { return 0, e.err }
func (e engine) CountForStudent(context.Context, int64) (int, error) { return 0, e.err }
func (e engine) ObserveRejection(string, time.Duration, error)       {}

type response struct {
	Status  string `json:"status"`
	Data    any    `json:"data,omitempty"`
	Message string `json:"message,omitempty"`
}

func (response) Render(http.ResponseWriter, *http.Request) error { return nil }

type errorResponse struct {
	StatusCode int    `json:"-"`
	Status     int    `json:"status"`
	Detail     string `json:"detail"`
	Code       string `json:"code"`
}

func (e *errorResponse) Render(http.ResponseWriter, *http.Request) error { return nil }

func testResource(e engine) *feedbackHTTP.Resource {
	return testResourceWithObserver(e, func(int, string) {})
}

func testResourceWithObserver(e engine, observe func(int, string)) *feedbackHTTP.Resource {
	runtime := testResourceRuntime()
	runtime.ObserveResponse = observe
	return feedbackHTTP.NewResource(e, runtime)
}

func testResourceRuntime() feedbackHTTP.Runtime {
	return feedbackHTTP.Runtime{
		Protected: func(router chi.Router, register func(chi.Router, feedbackHTTP.Middleware)) {
			register(router, func(next http.Handler) http.Handler { return next })
		},
		Permission: func(string) feedbackHTTP.Middleware {
			return func(next http.Handler) http.Handler { return next }
		},
		Success: func(w http.ResponseWriter, r *http.Request, status int, data any, message string) {
			// Production answers through api/common, whose encoder writes
			// identifiers as strings; the double encodes the same way.
			body, err := wire.Marshal(&response{Status: "success", Data: data, Message: message})
			require.NoError(testingT(r.Context()), err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_, err = w.Write(append(body, '\n'))
			require.NoError(testingT(r.Context()), err)
		},
		Failure: func(w http.ResponseWriter, r *http.Request, failure feedbackHTTP.Failure) {
			render.Status(r, failure.Status)
			require.NoError(testingT(r.Context()), render.Render(w, r, &errorResponse{StatusCode: failure.Status, Status: failure.Status, Detail: failure.Err.Error(), Code: routetest.ClassCode(failure.Status)}))
		},
		ObserveResponse: func(int, string) {},
		ParseIDParam:    testpkg.ParseHTTPIDParam,
	}
}

// TestDemoFeedbackHistoryWireContract pins the demo-only route the public
// demo's seeder writes the past ratings through (ADR 0298): the school of the
// path, the batch body and the shared envelope for a refusal.
func TestDemoFeedbackHistoryWireContract(t *testing.T) {
	t.Parallel()
	runtime := testResourceRuntime()
	var recorded []feedbackModule.CreateEntry
	var recordedSchool int64
	recordErr := error(nil)
	handler := feedbackHTTP.DemoFeedbackHistoryHandler(func(_ context.Context, schoolID int64, entries []feedbackModule.CreateEntry) (int, error) {
		recordedSchool, recorded = schoolID, entries
		return len(entries), recordErr
	}, feedbackHTTP.DemoRuntime{Success: runtime.Success, Failure: runtime.Failure, ParseIDParam: runtime.ParseIDParam})
	router := chi.NewRouter()
	router.Post("/schools/{id}/demo-feedback-history", handler)
	post := func(target string, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, target, bytes.NewBufferString(body)).WithContext(context.WithValue(context.Background(), testKey{}, t))
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		return recorder
	}
	entry := `{"value":"positive","day":"2026-08-31","time":"12:34:56","student_id":42,"is_mensa_feedback":true}`

	recorder := post("/schools/9/demo-feedback-history", `{"entries":[`+entry+`]}`)
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, `{"status":"success","data":{"written":1},"message":"Feedbackverlauf gespeichert"}`+"\n", recorder.Body.String())
	assert.EqualValues(t, 9, recordedSchool, "the school of the path")
	assert.Equal(t, []feedbackModule.CreateEntry{{Value: "positive", Day: "2026-08-31", Time: "12:34:56", StudentID: 42, IsMensaFeedback: true}}, recorded)

	for _, test := range []struct{ name, target, body, detail string }{
		{"school", "/schools/0/demo-feedback-history", `{"entries":[` + entry + `]}`, "invalid school ID"},
		{"empty", "/schools/9/demo-feedback-history", `{"entries":[]}`, "at least one feedback entry is required"},
		{"unknown field", "/schools/9/demo-feedback-history", `{"entries":[` + entry + `],"extra":1}`, `invalid feedback history: json: unknown field \"extra\"`},
	} {
		recorder := post(test.target, test.body)
		assert.Equal(t, http.StatusBadRequest, recorder.Code, test.name)
		assert.Equal(t, `{"status":400,"detail":"`+test.detail+`","code":"general.input"}`+"\n", recorder.Body.String(), test.name)
	}

	recordErr = &feedbackModule.BatchOperationError{Errors: []error{&feedbackModule.InvalidEntryDataError{Err: errors.New("history day must be before today")}}}
	recorder = post("/schools/9/demo-feedback-history", `{"entries":[`+entry+`]}`)
	assert.Equal(t, http.StatusBadRequest, recorder.Code, "a day the writer refuses is the caller's error")
}

type testKey struct{}

func testingT(ctx context.Context) *testing.T { return ctx.Value(testKey{}).(*testing.T) }

func execute(t *testing.T, resource *feedbackHTTP.Resource, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var encoded bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&encoded).Encode(body))
	}
	request := httptest.NewRequest(method, target, &encoded).WithContext(context.WithValue(context.Background(), testKey{}, t))
	recorder := httptest.NewRecorder()
	resource.Router().ServeHTTP(recorder, request)
	return recorder
}

func TestStaffWireContractsStayStable(t *testing.T) {
	t.Parallel()
	entry := feedbackModule.Entry{ID: 7, Value: feedbackModule.ValuePositive, Day: "2026-08-31", Time: "12:34:56", StudentID: 42}
	entryJSON := `{"id":"7","value":"positive","day":"2026-08-31","time":"12:34:56","student_id":"42","is_mensa_feedback":false,"created_at":"0001-01-01T00:00:00Z","updated_at":"0001-01-01T00:00:00Z"}`
	tests := []struct {
		name, method, target, want string
		body                       any
		status                     int
	}{
		{"student", http.MethodGet, "/student/42", `{"status":"success","data":[` + entryJSON + `],"message":"Student feedback entries retrieved successfully"}` + "\n", nil, http.StatusOK},
	}
	resource := testResource(engine{available: true, entries: []feedbackModule.Entry{entry}})
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := execute(t, resource, test.method, test.target, test.body)
			assert.Equal(t, test.status, recorder.Code)
			assert.Equal(t, test.want, recorder.Body.String())
		})
	}
}

func TestStaffErrorStatusesStayStable(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		err  error
		code int
		body string
	}{
		{"not found", feedbackModule.ErrEntryNotFound, 404, `{"status":404,"detail":"feedback entry not found","code":"general.input"}`},
		{"invalid", feedbackModule.ErrInvalidEntryData, 400, `{"status":400,"detail":"invalid feedback entry data","code":"general.input"}`},
		{"range", feedbackModule.ErrInvalidDateRange, 400, `{"status":400,"detail":"invalid date range","code":"general.input"}`},
		{"student", feedbackModule.ErrStudentNotFound, 404, `{"status":404,"detail":"student not found","code":"general.input"}`},
		{"internal", errors.New("boom"), 500, `{"status":500,"detail":"boom","code":"general.server"}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			recorder := execute(t, testResource(engine{err: test.err}), http.MethodGet, "/student/42", nil)
			assert.Equal(t, test.code, recorder.Code)
			assert.Equal(t, test.body+"\n", recorder.Body.String())
		})
	}
}

func TestInvalidPathIDsAnswerBadRequest(t *testing.T) {
	t.Parallel()
	resource := testResource(engine{available: true})
	for _, test := range []struct{ method, target, detail string }{
		{http.MethodGet, "/student/abc", "invalid student ID"},
		{http.MethodGet, "/student/0", "invalid student ID"},
	} {
		recorder := execute(t, resource, test.method, test.target, nil)
		assert.Equal(t, http.StatusBadRequest, recorder.Code, test.target)
		assert.Equal(t, `{"status":400,"detail":"`+test.detail+`","code":"general.input"}`+"\n", recorder.Body.String(), test.target)
	}
}

func TestStudentReadDoesNotSwallowSettingsFailure(t *testing.T) {
	t.Parallel()
	recorder := execute(t, testResource(engine{err: errors.New("settings down")}), http.MethodGet, "/student/42", nil)
	assert.Equal(t, http.StatusInternalServerError, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "settings down")
}

func TestStaffResponseObserverUsesActualStatusAndStableCode(t *testing.T) {
	t.Parallel()
	type observation struct {
		status int
		code   string
	}
	var observations []observation
	resource := testResourceWithObserver(engine{err: feedbackModule.ErrEntryNotFound}, func(status int, code string) {
		observations = append(observations, observation{status: status, code: code})
	})

	execute(t, resource, http.MethodGet, "/student/invalid", nil)
	execute(t, resource, http.MethodGet, "/student/42", nil)

	assert.Equal(t, []observation{
		{status: http.StatusBadRequest, code: "invalid_parameters"},
		{status: http.StatusNotFound, code: "entry_not_found"},
	}, observations)
}
