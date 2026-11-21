package application

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

func accountSchool(name string, byTraeger, closed, closedByTraeger bool, laterClosed string) workforce.TraegerTimeAccountSchool {
	return workforce.TraegerTimeAccountSchool{
		SchoolID: ident.ID(int64(len(name))), SchoolName: name, ByTraeger: byTraeger, Closed: closed, ClosedByTraeger: closedByTraeger,
		LaterClosed: laterClosed, TraegerTimeAccountMinutes: workforce.TraegerTimeAccountMinutes{TargetMinutes: 600, ActualMinutes: 540, BalanceMinutes: -60},
	}
}

// TestSumTimeAccountNamesTheMonthsState pins the states of #4711: a month is
// open while a school the Träger closes is open, closed once all of them
// are, and the schools' own without a contract.
func TestSumTimeAccountNamesTheMonthsState(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		schools []workforce.TraegerTimeAccountSchool
		state   string
	}{
		"no contract":           {[]workforce.TraegerTimeAccountSchool{accountSchool("Nord", false, true, false, "")}, workforce.TraegerMonthSchool},
		"one school still open": {[]workforce.TraegerTimeAccountSchool{accountSchool("Nord", true, true, true, ""), accountSchool("Süd", true, false, false, "")}, workforce.TraegerMonthOpen},
		"all closed":            {[]workforce.TraegerTimeAccountSchool{accountSchool("Nord", true, true, true, ""), accountSchool("Süd", false, false, false, "")}, workforce.TraegerMonthClosed},
	} {
		sum, state := sumTimeAccount(tc.schools)
		assert.Equal(t, tc.state, state, name)
		assert.Equal(t, 600*len(tc.schools), sum.TargetMinutes, name)
		assert.Equal(t, -60*len(tc.schools), sum.BalanceMinutes, name)
	}
}

// TestCloseAndReopenAreCheckedBeforeAnySchoolIsWritten keeps a close or
// reopen from stopping halfway: every refusal that one school's state
// decides comes before the first write.
func TestCloseAndReopenAreCheckedBeforeAnySchoolIsWritten(t *testing.T) {
	t.Parallel()
	open := workforce.TraegerTimeAccount{Year: 2026, Month: 10, State: workforce.TraegerMonthOpen, Ended: true, Schools: []workforce.TraegerTimeAccountSchool{
		accountSchool("Nord", true, false, false, ""), accountSchool("Süd", true, false, false, "2026-11"),
	}}
	err := closableAccount(open, "Abrechnung")
	assert.ErrorIs(t, err, workforce.ErrLaterMonthClosed)
	var school *workforce.TraegerSchoolMonthError
	if assert.True(t, errors.As(err, &school)) {
		assert.Equal(t, "Süd", school.SchoolName)
		assert.Equal(t, "2026-11", school.LaterMonth)
	}
	assert.ErrorIs(t, closableAccount(open, " "), workforce.ErrMonthCloseInvalid)
	running := open
	running.Ended, running.Schools = false, running.Schools[:1]
	assert.ErrorIs(t, closableAccount(running, "Abrechnung"), workforce.ErrMonthNotClosable)

	bySchool := workforce.TraegerTimeAccount{Year: 2026, Month: 9, Schools: []workforce.TraegerTimeAccountSchool{accountSchool("Nord", true, true, false, "")}}
	assert.ErrorIs(t, reopenableAccount(bySchool, "Korrektur"), workforce.ErrMonthClosedBySchool)
	notClosed := workforce.TraegerTimeAccount{Schools: []workforce.TraegerTimeAccountSchool{accountSchool("Nord", true, false, false, "")}}
	assert.ErrorIs(t, reopenableAccount(notClosed, "Korrektur"), workforce.ErrMonthNotClosed)
	laterClosed := workforce.TraegerTimeAccount{Schools: []workforce.TraegerTimeAccountSchool{accountSchool("Nord", true, true, true, "2026-11")}}
	assert.ErrorIs(t, reopenableAccount(laterClosed, "Korrektur"), workforce.ErrLaterMonthClosed)
}
