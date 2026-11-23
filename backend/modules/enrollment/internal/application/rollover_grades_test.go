package application

import (
	"testing"

	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Pure-helper tests for the rollover service. computeNewGrade and
// renewalInitialStatus drive the bulk of the rollover dispatch, so
// they're worth covering without firing up the test DB.

func grade(n int16) *int16 { return &n }

func TestComputeNewGrade_NilSourceNeedsReview(t *testing.T) {
	t.Parallel()

	got, reason := computeNewGrade(nil, true, 4)
	assert.Nil(t, got, "no source grade → no new grade")
	assert.Equal(t, enrollmentNative.ReviewReasonNoGradeLevel, reason)
}

func TestComputeNewGrade_BumpAdvancesByOne(t *testing.T) {
	t.Parallel()

	got, reason := computeNewGrade(grade(2), true, 4)
	require.NotNil(t, got)
	assert.Equal(t, int16(3), *got)
	assert.Empty(t, reason, "in-range bump must not request review")
}

func TestComputeNewGrade_HalfYearKeepsGrade(t *testing.T) {
	t.Parallel()

	got, reason := computeNewGrade(grade(2), false, 4)
	require.NotNil(t, got)
	assert.Equal(t, int16(2), *got, "bumpsGrade=false preserves the grade")
	assert.Empty(t, reason)
}

func TestComputeNewGrade_AboveMaxSurfacesReview(t *testing.T) {
	t.Parallel()

	got, reason := computeNewGrade(grade(4), true, 4)
	require.NotNil(t, got)
	assert.Equal(t, int16(5), *got, "row still carries the would-be grade")
	assert.Equal(t, enrollmentNative.ReviewReasonGradeAboveMax, reason,
		"out-of-range bump must request admin review")
}

func TestComputeNewGrade_AtMaxOK(t *testing.T) {
	t.Parallel()

	got, reason := computeNewGrade(grade(3), true, 4)
	require.NotNil(t, got)
	assert.Equal(t, int16(4), *got)
	assert.Empty(t, reason)
}

func TestRenewalInitialStatus_OptInIsPendingRenewal(t *testing.T) {
	t.Parallel()

	assert.Equal(t,
		enrollmentNative.ChildStatusPendingRenewal,
		renewalInitialStatus(enrollmentNative.PhaseRolloverModeOptIn),
	)
}

func TestRenewalInitialStatus_OptOutIsAutoRenewed(t *testing.T) {
	t.Parallel()

	assert.Equal(t,
		enrollmentNative.ChildStatusAutoRenewed,
		renewalInitialStatus(enrollmentNative.PhaseRolloverModeOptOut),
	)
}

func TestRenewalInitialStatus_UnknownDefaultsToAutoRenewed(t *testing.T) {
	t.Parallel()

	// Defensive: unknown mode falls into the auto_renewed branch so
	// the rollover dispatch doesn't strand a child in an invalid state.
	assert.Equal(t,
		enrollmentNative.ChildStatusAutoRenewed,
		renewalInitialStatus("weird-mode"),
	)
}

// A renewal no parent can answer goes to the school's review, whatever its
// grade: the enrollment of a child of an imported care contract, and only
// that (#7760, ADR 0309). A request of another source without a guardian
// address and account rolls over as before.
func TestARenewalNoParentCanAnswerGoesToReview(t *testing.T) {
	t.Parallel()

	account := int64(41)
	cases := map[string]struct {
		request enrollmentNative.Request
		want    bool
	}{
		"contract import":          {enrollmentNative.Request{SubmissionSource: enrollmentNative.RequestSourceContractImport}, true},
		"contract import, address": {enrollmentNative.Request{SubmissionSource: enrollmentNative.RequestSourceContractImport, GuardianEmail: "eltern@example.test"}, true},
		"no address, no account":   {enrollmentNative.Request{SubmissionSource: enrollmentNative.RequestSourceAdminManual}, false},
		"public, no address":       {enrollmentNative.Request{}, false},
		"address":                  {enrollmentNative.Request{GuardianEmail: "eltern@example.test"}, false},
		"account":                  {enrollmentNative.Request{GuardianAccountID: &account}, false},
	}
	for name, tc := range cases {
		assert.Equal(t, tc.want, renewalWithoutParent(&tc.request), name)
	}
	assert.Equal(t, enrollmentNative.RequestSourceContractImport,
		renewalSource(&enrollmentNative.Request{SubmissionSource: enrollmentNative.RequestSourceContractImport}), "the renewal stays one of the source")
	assert.Empty(t, renewalSource(&enrollmentNative.Request{SubmissionSource: enrollmentNative.RequestSourceLateInvite}), "every other renewal keeps the default")

	got, reason := classifyRollover(grade(2), true, true, 4, true)
	require.NotNil(t, got)
	assert.Equal(t, int16(3), *got, "the row shows the grade it would carry")
	assert.Equal(t, enrollmentNative.ReviewReasonNoGuardian, reason)
	_, reason = classifyRollover(nil, true, true, 4, true)
	assert.Equal(t, enrollmentNative.ReviewReasonNoGuardian, reason, "it goes before a missing grade")
	_, reason = classifyRollover(grade(2), true, true, 4, false)
	assert.Empty(t, reason)
	_, reason = classifyRollover(nil, true, false, 4, true)
	assert.Equal(t, enrollmentNative.ReviewReasonNoGuardian, reason, "also where the school collects no grades")
}
