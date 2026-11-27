package staffshifts

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

type actorGuardPlanning struct {
	workforce.StaffShiftPlanning
	calls int
}

func (p *actorGuardPlanning) DeleteShift(context.Context, int64) error {
	p.calls++
	return nil
}

func (p *actorGuardPlanning) EndSeries(context.Context, int64, string) (workforce.StaffShiftSeriesResult, error) {
	p.calls++
	return workforce.StaffShiftSeriesResult{}, nil
}

func TestDeleteRoutesRefuseARequestWithoutAnActor(t *testing.T) {
	t.Parallel()
	planning := &actorGuardPlanning{}
	var failure FailureKind
	resource := &Resource{
		planning: planning,
		runtime: Runtime{
			ParseID:      func(*http.Request) (int64, error) { return 7, nil },
			ResolveActor: func(context.Context) (Actor, error) { return Actor{}, ErrNoStaffActor },
			Failure: func(_ http.ResponseWriter, _ *http.Request, kind FailureKind, _ error) {
				failure = kind
			},
		},
	}

	for _, test := range []struct {
		name    string
		request *http.Request
		handler func(http.ResponseWriter, *http.Request)
	}{
		{name: "shift", request: httptest.NewRequest(http.MethodDelete, "/7", nil), handler: resource.delete},
		{name: "series", request: httptest.NewRequest(http.MethodDelete, "/series/7?from=2026-09-14", nil), handler: resource.endSeries},
	} {
		t.Run(test.name, func(t *testing.T) {
			failure = ""
			test.handler(httptest.NewRecorder(), test.request)

			assert.Equal(t, FailureForbidden, failure)
			assert.Zero(t, planning.calls, "the refusal must happen before the planning capability")
		})
	}
}
