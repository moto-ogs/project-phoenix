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

type weeklyPlanSchemaFake struct {
	DecisionSchemas
	schema *enrollmentNative.FormSchema
}

func (f weeklyPlanSchemaFake) Schema(context.Context, int64) (*enrollmentNative.FormSchema, error) {
	return f.schema, nil
}

type weeklyPlanStoreFake struct {
	DecisionChildren
	stored *[]*enrollmentNative.WeeklyPlan
}

func (f weeklyPlanStoreFake) SetChildWeeklyPlan(_ context.Context, _ int64, plan *enrollmentNative.WeeklyPlan) error {
	*f.stored = append(*f.stored, plan)
	return nil
}

// An approval that defers weekly pickup or arrival rows stores their author
// with the plan, or fails: a failed lookup is the failure, a reviewer without
// staff record or mark is refused as at once, and nothing is stored (#7818).
// A plan without weekly rows needs no author.
func TestPlanWeeklyPlanStoresAnAuthorOrFails(t *testing.T) {
	t.Parallel()

	const schemaID int64 = 51
	const childID int64 = 52
	const reviewerAccountID int64 = 53
	const reviewerStaffID int64 = 54
	on := enrollmentNative.Date("2027-02-03")
	lookupFailed := errors.New("connection reset")
	schema := &enrollmentNative.FormSchema{Fields: []enrollmentNative.FormField{{
		Key: "pickup_times", Type: enrollmentNative.FormFieldWeekdaySchedule, AppliesToCh: true, Target: enrollmentNative.TargetSchedulePickup,
	}}}
	request := &enrollmentNative.Request{SchemaID: new(int64)}
	*request.SchemaID = schemaID
	withPickup := &enrollmentNative.RequestChild{ID: childID, CustomData: formValues(map[string]any{"pickup_times": map[string]any{"mon": "15:10"}})}
	withoutPickup := &enrollmentNative.RequestChild{ID: childID, CustomData: formValues(map[string]any{"pickup_times": map[string]any{}})}

	run := func(ctx context.Context, child *enrollmentNative.RequestChild, persons reviewerPersonsFake, staff reviewerStaffFake) ([]*enrollmentNative.WeeklyPlan, error) {
		var stored []*enrollmentNative.WeeklyPlan
		d := &Decisions{deps: DecisionDependencies{
			Schemas:  weeklyPlanSchemaFake{schema: schema},
			Children: weeklyPlanStoreFake{stored: &stored},
			People:   PeopleDirectory{Persons: persons, Staff: staff},
			Runtime:  Runtime{NotFound: func(err error) bool { return errors.Is(err, errReviewerNotFound) }},
		}}
		return stored, d.planWeeklyPlan(ctx, request, child, &on, reviewerAccountID)
	}
	person := reviewerPersonsFake{person: &Person{ID: reviewerAccountID}}

	stored, err := run(context.Background(), withPickup, reviewerPersonsFake{err: lookupFailed}, reviewerStaffFake{})
	require.ErrorIs(t, err, lookupFailed)
	require.NotErrorIs(t, err, enrollmentNative.ErrDecisionReviewerStaffRequired)
	assert.Empty(t, stored, "a failed lookup stores no plan")

	stored, err = run(enrollmentNative.WithTraegerBueroReviewer(context.Background()), withPickup, person, reviewerStaffFake{err: lookupFailed})
	require.ErrorIs(t, err, lookupFailed, "the mark never covers a failed lookup")
	assert.Empty(t, stored)

	stored, err = run(context.Background(), withPickup, person, reviewerStaffFake{err: errReviewerNotFound})
	require.ErrorIs(t, err, enrollmentNative.ErrDecisionReviewerStaffRequired)
	assert.Empty(t, stored, "a reviewer without staff record or mark stores no plan without author")

	stored, err = run(enrollmentNative.WithTraegerBueroReviewer(context.Background()), withPickup, person, reviewerStaffFake{err: errReviewerNotFound})
	require.NoError(t, err)
	require.Len(t, stored, 1)
	assert.Equal(t, enrollmentNative.WeeklyPlan{RequestChildID: childID, On: on, ByTraeger: true}, *stored[0])

	stored, err = run(context.Background(), withPickup, person, reviewerStaffFake{staffID: reviewerStaffID})
	require.NoError(t, err)
	require.Len(t, stored, 1)
	assert.Equal(t, enrollmentNative.WeeklyPlan{RequestChildID: childID, On: on, AuthorStaffID: reviewerStaffID}, *stored[0])

	stored, err = run(context.Background(), withoutPickup, reviewerPersonsFake{err: lookupFailed}, reviewerStaffFake{})
	require.NoError(t, err, "a plan without weekly rows needs no author")
	require.Len(t, stored, 1)
	assert.Equal(t, enrollmentNative.WeeklyPlan{RequestChildID: childID, On: on}, *stored[0])
}
