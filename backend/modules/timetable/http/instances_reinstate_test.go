package timetablehttp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// reinstateDouble answers Reinstate with a fixed result (#7151).
type reinstateDouble struct {
	result *timetable.LifecycleInstance
	err    error
	gotID  int64
}

func (d *reinstateDouble) Reinstate(_ context.Context, instanceID int64, _ *int64) (*timetable.LifecycleInstance, error) {
	d.gotID = instanceID
	return d.result, d.err
}

func TestReinstateInstanceAnswers(t *testing.T) {
	t.Parallel()
	planned := &timetable.LifecycleInstance{Status: timetable.InstanceStatusPlanned}
	planned.ID = 31

	cases := []struct {
		name     string
		double   *reinstateDouble
		path     string
		wantCode int
		wantErr  string
	}{
		{name: "reinstated", double: &reinstateDouble{result: planned}, path: "/instances/31/reinstate", wantCode: http.StatusOK},
		{name: "ended", double: &reinstateDouble{err: timetable.ErrInstanceReinstateEnded}, path: "/instances/31/reinstate", wantCode: http.StatusConflict, wantErr: "timetable.reinstate_ended"},
		{name: "not cancelled", double: &reinstateDouble{err: &wrappedErr{inner: timetable.ErrInvalidInstanceTransition}}, path: "/instances/31/reinstate", wantCode: http.StatusConflict, wantErr: "timetable.invalid_transition"},
		{name: "deleted", double: &reinstateDouble{err: timetable.ErrInstanceNotFound}, path: "/instances/31/reinstate", wantCode: http.StatusNotFound, wantErr: "timetable.instance_not_found"},
		{name: "invalid id", double: &reinstateDouble{}, path: "/instances/nope/reinstate", wantCode: http.StatusBadRequest},
		{name: "failure", double: &reinstateDouble{err: errors.New("db failure")}, path: "/instances/31/reinstate", wantCode: http.StatusInternalServerError},
		{name: "not wired", path: "/instances/31/reinstate", wantCode: http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			deps := Dependencies{}
			if tc.double != nil {
				deps.InstanceReinstatement = tc.double
			}
			rs := newResourceForTest(deps)
			router := setupLifecycleRouter(rs, "/instances/{id}/reinstate", rs.reinstateInstance)

			w := doPost(t, router, tc.path, nil)

			require.Equal(t, tc.wantCode, w.Code, w.Body.String())
			var body struct {
				Code string `json:"code"`
				Data struct {
					InstanceID int64  `json:"instance_id"`
					Status     string `json:"status"`
				} `json:"data"`
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			if tc.wantErr != "" {
				assert.Equal(t, tc.wantErr, body.Code)
			}
			if tc.wantCode == http.StatusOK {
				assert.Equal(t, int64(31), tc.double.gotID)
				assert.Equal(t, int64(31), body.Data.InstanceID)
				assert.Equal(t, "planned", body.Data.Status)
			}
		})
	}
}
