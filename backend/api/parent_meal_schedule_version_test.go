package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// The version a parent's save of the regular days answers is the version
// the next save is checked against (ADR 0311): a second save with it goes
// through without a new read, a save with the version read before the
// first one is refused.
func TestReplaceMealParticipationSchedule_AnsweredVersionPassesTheNextSave(t *testing.T) {
	t.Parallel()
	rig := newMealWriteRig(t)
	f := rig.mealFamily(t)
	ctx := context.Background()
	before := rig.asRead(t, mealSchedule(f.StudentID, 1, 2), f.token)

	first := rig.call(t, ctx, before, f.token)
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())
	var saved struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(first.Body.Bytes(), &saved))
	require.NotEmpty(t, saved.Data.Version)

	next := mealSchedule(f.StudentID, 3)
	next.body = map[string]any{"weekdays": []int{3}, "expected_version": saved.Data.Version}
	second := rig.call(t, ctx, next, f.token)
	require.Equal(t, http.StatusOK, second.Code, second.Body.String())

	stale := rig.call(t, ctx, before, f.token)
	require.Equal(t, http.StatusConflict, stale.Code, stale.Body.String())
	require.Contains(t, stale.Body.String(), `"code":"general.changed_since_read"`)
}
