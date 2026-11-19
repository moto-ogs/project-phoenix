package analytics

import (
	"bytes"
	"encoding/json"
	"net/http"
	"slices"

	"github.com/go-chi/chi/v5"
)

// The first steps of a care worker (#3748) as core actions (#7553). They
// count for the school without the person's consent, like every core action,
// and carry only values from the closed lists below: the step key and what
// happened to it, never the account or a free value.

// staffFirstStepKeys are the steps of the first steps
// (schoolsetup.StaffStepKeys). analytics may not import the owner, so the
// list stands here; TestStaffFirstStepKeysMatchTheChecklist in the root
// keeps both equal. An unknown key counts nothing.
var staffFirstStepKeys = []string{"groups", "students", "attendance", "calendar", "supervision", "work_time"}

// StaffFirstStepKeys returns the step keys an event may name, for the guard
// test against the checklist.
func StaffFirstStepKeys() []string { return slices.Clone(staffFirstStepKeys) }

// What happened to a step: the state the response reports for it.
const (
	staffStepDone     = "done"
	staffStepSkipped  = "skipped"
	staffStepReopened = "reopened"
)

// StaffFirstStepsOutcomeQuery is the query parameter with which „Abschließen“
// tells the dismissal apart from „Ausblenden“. Both hide the checklist; the
// server cannot tell them apart from its data, because which steps apply
// depends on settings and permissions only the client holds.
const (
	StaffFirstStepsOutcomeQuery     = "outcome"
	StaffFirstStepsOutcomeCompleted = "completed"
)

// staffFirstStepsStatus is the part of the first steps' response
// (schoolsetup.StaffStatus) the events read.
type staffFirstStepsStatus struct {
	Changed      bool     `json:"changed"`
	Dismissed    bool     `json:"dismissed"`
	DoneSteps    []string `json:"done_steps"`
	SkippedSteps []string `json:"skipped_steps"`
}

// staffFirstStepsStatusOf reads the status from the response, in the
// {"data": ...} envelope or flat. A response without both step lists is not
// the status and counts nothing.
func staffFirstStepsStatusOf(body []byte) (staffFirstStepsStatus, bool) {
	var envelope struct {
		Data *json.RawMessage `json:"data"`
	}
	trimmed := bytes.TrimSpace(body)
	if json.Unmarshal(trimmed, &envelope) != nil {
		return staffFirstStepsStatus{}, false
	}
	raw := trimmed
	if envelope.Data != nil {
		raw = *envelope.Data
	}
	var shape map[string]json.RawMessage
	var status staffFirstStepsStatus
	if json.Unmarshal(raw, &shape) != nil || json.Unmarshal(raw, &status) != nil {
		return staffFirstStepsStatus{}, false
	}
	_, changed := shape["changed"]
	_, done := shape["done_steps"]
	_, skipped := shape["skipped_steps"]
	return status, changed && status.Changed && done && skipped
}

// staffFirstStepChanged names a step's new state (PUT .../steps/{step}): the
// response holds the person's whole progress, so the step's place in it is
// what the request set.
func staffFirstStepChanged(r *http.Request, body []byte) (string, map[string]string, bool) {
	step := chi.URLParam(r, "step")
	if !slices.Contains(StaffFirstStepKeys(), step) {
		return "", nil, false
	}
	status, ok := staffFirstStepsStatusOf(body)
	if !ok {
		return "", nil, false
	}
	action := staffStepReopened
	switch {
	case slices.Contains(status.DoneSteps, step):
		action = staffStepDone
	case slices.Contains(status.SkippedSteps, step):
		action = staffStepSkipped
	}
	return "staff_first_step_changed", map[string]string{"step": step, "action": action}, true
}

// staffFirstStepsHidden counts a dismissal that hid the checklist: finished
// („Abschließen“) or closed early („Ausblenden“). Bringing it back is no
// event.
func staffFirstStepsHidden(r *http.Request, body []byte) (string, map[string]string, bool) {
	status, ok := staffFirstStepsStatusOf(body)
	if !ok || !status.Dismissed {
		return "", nil, false
	}
	if r.URL.Query().Get(StaffFirstStepsOutcomeQuery) == StaffFirstStepsOutcomeCompleted {
		return "staff_first_steps_completed", nil, true
	}
	return "staff_first_steps_dismissed", nil, true
}

func detailEvent(name string, detail func(*http.Request, []byte) (string, map[string]string, bool)) CoreAction {
	return CoreAction{Event: name, Detail: detail}
}
