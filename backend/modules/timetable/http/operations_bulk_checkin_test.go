package timetablehttp

import (
	"fmt"
	"net/http"
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
)

// TestOperationsCheckInStudentsValidatesAndDelegates pins the bulk check-in
// wire (#3824): the selection reaches the service deduplicated and in order,
// and a malformed selection is refused before any write.
func TestOperationsCheckInStudentsValidatesAndDelegates(t *testing.T) {
	t.Parallel()

	service := &fakeOperationsService{
		roster: &timetable.OperationRoster{Instance: timetable.OperationRosterInstance{ID: 250}},
	}
	res := newResourceForTest(Dependencies{OperationsService: service})
	router := operationRouter(http.MethodPost, "/instances/{id}/students/check-in", res.operationsCheckInStudents)

	rr := executeOperationRequest(t, router, http.MethodPost, "/instances/250/students/check-in",
		map[string]any{"student_ids": []string{fmt.Sprint(352), fmt.Sprint(350), fmt.Sprint(352), fmt.Sprint(351)}})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Equal(t, int64(250), service.lastInstanceID)
	assert.Equal(t, []int64{352, 350, 351}, service.lastStudentIDs)

	rr = executeOperationRequest(t, router, http.MethodPost, "/instances/250/students/check-in",
		map[string]any{"student_ids": []string{"9007199254740993", "9007199254740993"}})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Equal(t, []int64{9007199254740993}, service.lastStudentIDs)

	tooMany := make([]int64, maxBulkCheckInStudents+1)
	for i := range tooMany {
		tooMany[i] = int64(i + 1)
	}
	for name, body := range map[string]any{
		"missing":  map[string]any{},
		"empty":    map[string]any{"student_ids": []string{}},
		"zero":     map[string]any{"student_ids": []string{fmt.Sprint(350), fmt.Sprint(0)}},
		"negative": map[string]any{"student_ids": []string{fmt.Sprint(-1)}},
		"too many": map[string]any{"student_ids": testpkg.IDsOf[testpkg.ID](tooMany)},
		"not json": "{",
	} {
		rr = executeOperationRequest(t, router, http.MethodPost, "/instances/250/students/check-in", body)
		assert.Equal(t, http.StatusBadRequest, rr.Code, name)
	}

	rr = executeOperationRequest(t, router, http.MethodPost, "/instances/bad/students/check-in",
		map[string]any{"student_ids": []string{fmt.Sprint(350)}})
	assert.Equal(t, http.StatusBadRequest, rr.Code)

	errorRouter := operationRouter(http.MethodPost, "/instances/{id}/students/check-in",
		newResourceForTest(Dependencies{OperationsService: &fakeOperationsService{err: timetable.ErrTimetableOperationConflict}}).operationsCheckInStudents)
	rr = executeOperationRequest(t, errorRouter, http.MethodPost, "/instances/250/students/check-in",
		map[string]any{"student_ids": []string{fmt.Sprint(350)}})
	assert.Equal(t, http.StatusConflict, rr.Code)

	nilRouter := operationRouter(http.MethodPost, "/instances/{id}/students/check-in",
		newResourceForTest(Dependencies{}).operationsCheckInStudents)
	rr = executeOperationRequest(t, nilRouter, http.MethodPost, "/instances/250/students/check-in",
		map[string]any{"student_ids": []string{fmt.Sprint(350)}})
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}
