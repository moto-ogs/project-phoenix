package users

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// TestGuardianReadStateRefusalsCountAsConflicts locks the metric of a save
// refused for an outdated read state (ADR 0311): it is a 409 the person
// resolves by reloading, so phoenix_guardian_directory_http_responses_total
// must count it as 4xx, not as a 5xx alert. The paths below carry no case of
// their own for the refusal: an unclassified business rejection is a 409.
func TestGuardianReadStateRefusalsCountAsConflicts(t *testing.T) {
	t.Parallel()

	refused := fmt.Errorf("update guardian entry: %w", readstate.ErrChanged)
	cases := []struct {
		name   string
		code   string
		refuse func(*GuardianResource, http.ResponseWriter, *http.Request)
	}{
		{"guardian entry", readstate.ChangedCode, func(rs *GuardianResource, w http.ResponseWriter, r *http.Request) { rs.moduleFailure(w, r, refused) }},
		{"payment", readstate.ChangedCode, func(rs *GuardianResource, w http.ResponseWriter, r *http.Request) {
			rs.renderPaymentError(w, r, refused)
		}},
		{"guardian delete", readstate.ChangedCode, func(rs *GuardianResource, w http.ResponseWriter, r *http.Request) {
			rs.renderGuardianDeleteError(w, r, refused, true)
		}},
		{"bulk invitation run", readstate.ChangedCode, func(rs *GuardianResource, w http.ResponseWriter, r *http.Request) {
			rs.fail(w, r, FailureInternal, refused)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var kind FailureKind
			var status int
			var code string
			rs := &GuardianResource{runtime: GuardianRuntime{
				Failure:         func(_ http.ResponseWriter, _ *http.Request, k FailureKind, _ error) { kind = k },
				ObserveResponse: func(s int, c string) { status, code = s, c },
				MarkRollback:    func(context.Context) {},
			}}

			tc.refuse(rs, httptest.NewRecorder(), httptest.NewRequest(http.MethodPut, "/", nil))

			if kind != FailureConflict || status != http.StatusConflict {
				t.Fatalf("refusal rendered as %q and counted as %d, want conflict and 409", kind, status)
			}
			if code != tc.code {
				t.Fatalf("refusal counted with code %q, want %q", code, tc.code)
			}
		})
	}
}

// TestPersonReadStateRefusalCountsAsConflict is the same rule for the person
// routes: the refusal answers 409 and is counted with its own code.
func TestPersonReadStateRefusalCountsAsConflict(t *testing.T) {
	t.Parallel()
	var kind FailureKind
	var status int
	var code string
	rs := &Resource{runtime: Runtime{
		Failure:         func(_ http.ResponseWriter, _ *http.Request, k FailureKind, _ error) { kind = k },
		ObserveResponse: func(s int, c string) { status, code = s, c },
	}}

	rs.moduleFailure(httptest.NewRecorder(), httptest.NewRequest(http.MethodPut, "/", nil), fmt.Errorf("update person: %w", readstate.ErrChanged))

	if kind != FailureConflict || status != http.StatusConflict || code != readstate.ChangedCode {
		t.Fatalf("refusal rendered as %q and counted as %d %q, want conflict, 409 and %s", kind, status, code, readstate.ChangedCode)
	}
}
