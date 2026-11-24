package feedback

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	feedbackModule "github.com/moto-ogs/project-phoenix/modules/feedback"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// Bounds of one demo feedback history request. A demo school's month of
// ratings is about 1,500 entries and 150 KiB.
const (
	maxDemoFeedbackHistoryEntries = 10000
	maxDemoFeedbackHistoryBytes   = 1 << 20
)

// DemoRuntime answers the demo feedback history route through the root's
// shared envelope.
type DemoRuntime struct {
	Success func(http.ResponseWriter, *http.Request, int, any, string)
	Failure func(http.ResponseWriter, *http.Request, Failure)
	// ParseIDParam reads an int64 path parameter: api/common.ParseIDParam.
	ParseIDParam func(*http.Request, string) (int64, error)
}

// DemoFeedbackHistoryResponse reports how many ratings the request wrote;
// zero when the school already had its history.
type DemoFeedbackHistoryResponse struct {
	Written int `json:"written"`
}

// DemoFeedbackHistoryHandler lets the public demo's seeder record the past
// ratings of one demo school (ADR 0298). The root mounts it on the operator
// routes under APP_ENV=demo only; record writes the entries in the school of
// the path.
func DemoFeedbackHistoryHandler(record func(context.Context, int64, []feedbackModule.CreateEntry) (int, error), runtime DemoRuntime) http.HandlerFunc {
	if record == nil || runtime.Success == nil || runtime.Failure == nil || runtime.ParseIDParam == nil {
		panic("feedback http: the demo feedback history needs its writer and runtime")
	}
	return func(w http.ResponseWriter, r *http.Request) {
		schoolID, err := runtime.ParseIDParam(r, "id")
		if err != nil || schoolID <= 0 {
			runtime.Failure(w, r, Failure{Status: http.StatusBadRequest, Err: errors.New("invalid school ID")})
			return
		}
		entries, err := decodeDemoFeedbackHistory(w, r)
		if err != nil {
			runtime.Failure(w, r, Failure{Status: http.StatusBadRequest, Err: err})
			return
		}
		written, err := record(r.Context(), schoolID, entries)
		if err != nil {
			runtime.Failure(w, r, Failure{Status: moduleErrorStatus(err), Err: err})
			return
		}
		runtime.Success(w, r, http.StatusOK, DemoFeedbackHistoryResponse{Written: written}, "Feedbackverlauf gespeichert")
	}
}

func decodeDemoFeedbackHistory(w http.ResponseWriter, r *http.Request) ([]feedbackModule.CreateEntry, error) {
	var body BatchFeedbackRequest
	decoder := wire.NewObjectDecoder(http.MaxBytesReader(w, r.Body, maxDemoFeedbackHistoryBytes))
	if err := decoder.Decode(&body); err != nil {
		return nil, fmt.Errorf("invalid feedback history: %w", err)
	}
	if len(body.Entries) > maxDemoFeedbackHistoryEntries {
		return nil, fmt.Errorf("a feedback history request carries at most %d entries", maxDemoFeedbackHistoryEntries)
	}
	if err := body.Bind(r); err != nil {
		return nil, err
	}
	entries := make([]feedbackModule.CreateEntry, 0, len(body.Entries))
	for index := range body.Entries {
		entries = append(entries, body.Entries[index].toInput())
	}
	return entries, nil
}
