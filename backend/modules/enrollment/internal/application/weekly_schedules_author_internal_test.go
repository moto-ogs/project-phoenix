package application

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"
)

var errReviewerNotFound = errors.New("no rows")

type reviewerPersonsFake struct {
	Persons
	person *Person
	err    error
}

func (f reviewerPersonsFake) PersonByAccount(context.Context, int64) (*Person, error) {
	return f.person, f.err
}

type reviewerStaffFake struct {
	staffID int64
	err     error
}

func (f reviewerStaffFake) StaffIDByPerson(context.Context, int64) (int64, error) {
	return f.staffID, f.err
}

// The Träger-Büro authors the weekly rows only for a reviewer whose staff
// record is cleanly missing in a marked request (#7818). A staff member
// stays the author, and a failed lookup stays a failure.
func TestResolveScheduleAuthorTraegerBueroOnlyForMissingStaff(t *testing.T) {
	t.Parallel()

	const reviewerAccountID int64 = 41
	const reviewerPersonID int64 = 42
	const reviewerStaffID int64 = 43
	lookupFailed := errors.New("connection reset")
	decisions := func(persons reviewerPersonsFake, staff reviewerStaffFake) *Decisions {
		return &Decisions{deps: DecisionDependencies{
			People:  PeopleDirectory{Persons: persons, Staff: staff},
			Runtime: Runtime{NotFound: func(err error) bool { return errors.Is(err, errReviewerNotFound) }},
		}}
	}
	person := &Person{ID: reviewerPersonID}
	marked := enrollmentNative.WithTraegerBueroReviewer(context.Background())
	author := scheduleAuthor{reviewerAccountID: reviewerAccountID}

	cases := []struct {
		name    string
		ctx     context.Context
		d       *Decisions
		want    resolvedScheduleAuthor
		wantErr error
	}{
		{"marked without person", marked, decisions(reviewerPersonsFake{}, reviewerStaffFake{}), resolvedScheduleAuthor{byTraeger: true}, nil},
		{"marked without staff", marked, decisions(reviewerPersonsFake{person: person}, reviewerStaffFake{err: errReviewerNotFound}), resolvedScheduleAuthor{byTraeger: true}, nil},
		{"marked with staff", marked, decisions(reviewerPersonsFake{person: person}, reviewerStaffFake{staffID: reviewerStaffID}), resolvedScheduleAuthor{staffID: reviewerStaffID}, nil},
		{"unmarked without staff", context.Background(), decisions(reviewerPersonsFake{person: person}, reviewerStaffFake{err: errReviewerNotFound}), resolvedScheduleAuthor{}, enrollmentNative.ErrDecisionReviewerStaffRequired},
		{"marked person lookup fails", marked, decisions(reviewerPersonsFake{err: lookupFailed}, reviewerStaffFake{}), resolvedScheduleAuthor{}, lookupFailed},
		{"marked staff lookup fails", marked, decisions(reviewerPersonsFake{person: person}, reviewerStaffFake{err: lookupFailed}), resolvedScheduleAuthor{}, lookupFailed},
	}
	for _, tc := range cases {
		got, err := tc.d.resolveScheduleAuthor(tc.ctx, author)
		if tc.wantErr != nil {
			require.ErrorIs(t, err, tc.wantErr, tc.name)
			assert.Equal(t, resolvedScheduleAuthor{}, got, tc.name)
			if errors.Is(tc.wantErr, lookupFailed) {
				assert.NotErrorIs(t, err, enrollmentNative.ErrDecisionReviewerStaffRequired, "%s: a failed lookup is no missing staff record", tc.name)
			}
			continue
		}
		require.NoError(t, err, tc.name)
		assert.Equal(t, tc.want, got, tc.name)
	}

	stored, err := decisions(reviewerPersonsFake{err: lookupFailed}, reviewerStaffFake{}).
		resolveScheduleAuthor(context.Background(), scheduleAuthor{byTraeger: true, reviewerAccountID: reviewerAccountID})
	require.NoError(t, err, "a plan stored by the Träger-Büro needs no lookup at the tick")
	assert.Equal(t, resolvedScheduleAuthor{byTraeger: true}, stored)
}
