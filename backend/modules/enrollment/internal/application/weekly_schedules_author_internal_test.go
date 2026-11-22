package application

import (
	"context"
	"errors"
	"testing"
	"time"

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
	emptyPickup := &enrollmentNative.RequestChild{ID: childID, CustomData: formValues(map[string]any{"pickup_times": map[string]any{}})}
	withoutPickup := &enrollmentNative.RequestChild{ID: childID, CustomData: formValues(map[string]any{})}

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

	// The start names an author for an answer without a time as well, so
	// the plan is stored with one or not at all.
	stored, err = run(context.Background(), emptyPickup, person, reviewerStaffFake{err: errReviewerNotFound})
	require.ErrorIs(t, err, enrollmentNative.ErrDecisionReviewerStaffRequired)
	assert.Empty(t, stored)
	stored, err = run(enrollmentNative.WithTraegerBueroReviewer(context.Background()), emptyPickup, person, reviewerStaffFake{err: errReviewerNotFound})
	require.NoError(t, err)
	require.Len(t, stored, 1)
	assert.True(t, stored[0].ByTraeger)

	stored, err = run(context.Background(), withoutPickup, reviewerPersonsFake{err: lookupFailed}, reviewerStaffFake{})
	require.NoError(t, err, "a plan without a weekly answer needs no author")
	require.Len(t, stored, 1)
	assert.Equal(t, enrollmentNative.WeeklyPlan{RequestChildID: childID, On: on}, *stored[0])
}

type pickupWritesFake struct {
	WeeklyPickupSchedules
	days *[]int
}

func (f pickupWritesFake) UpsertPickupSchedule(_ context.Context, _ int64, weekday int, _ time.Time, _ int64, _ bool) error {
	*f.days = append(*f.days, weekday)
	return nil
}

// A weekly answer names its author also when it has no time: under a
// replacing dispatch it has already cleared the running rows, so nobody
// without an author gets that far (#7818). The stored mark of the
// Träger-Büro is such an author and needs no session.
func TestWeekdayScheduleAnswerNeedsItsAuthor(t *testing.T) {
	t.Parallel()

	const studentID int64 = 61
	var days []int
	d := &Decisions{deps: DecisionDependencies{PickupSchedules: pickupWritesFake{days: &days}}}
	traegerBuero := scheduleAuthor{byTraeger: true}

	for _, answer := range []any{map[string]any{}, map[string]any{"mon": "", "tue": "  "}, map[string]any{"mon": "15:00"}} {
		require.Error(t, d.dispatchWeekdaySchedule(context.Background(), answer, studentID, scheduleAuthor{}, true))
	}
	assert.Empty(t, days)

	require.NoError(t, d.dispatchWeekdaySchedule(context.Background(), map[string]any{}, studentID, traegerBuero, true))
	assert.Empty(t, days)
	require.NoError(t, d.dispatchWeekdaySchedule(context.Background(), map[string]any{"mon": "15:00", "tue": ""}, studentID, traegerBuero, true))
	assert.Len(t, days, 1)
}

// A stored author stands for the rows it approved, not for the raw answers:
// a weekday added without a time changes nothing, a new time does (#7818).
func TestWeeklyRowsChangedComparesRowsNotAnswers(t *testing.T) {
	t.Parallel()

	const childID int64 = 71
	fields := []enrollmentNative.FormField{{
		Key: "pickup_times", Type: enrollmentNative.FormFieldWeekdaySchedule, AppliesToCh: true, Target: enrollmentNative.TargetSchedulePickup,
	}}
	run := func(answer map[string]any) *approvedChildSync {
		return &approvedChildSync{
			request: &enrollmentNative.Request{},
			child:   &enrollmentNative.RequestChild{ID: childID, CustomData: formValues(map[string]any{"pickup_times": answer})},
			snapshot: map[string]any{"children": []any{map[string]any{
				"id": childID, "custom_data": map[string]any{"pickup_times": map[string]any{"mon": "15:00"}},
			}}},
		}
	}

	assert.False(t, weeklyRowsChanged(run(map[string]any{"mon": "15:00", "tue": ""}), fields))
	assert.False(t, weeklyRowsChanged(run(map[string]any{"mon": "15:00 "}), fields))
	assert.True(t, weeklyRowsChanged(run(map[string]any{"mon": "15:30"}), fields))
	assert.True(t, weeklyRowsChanged(run(map[string]any{"mon": "15:00", "tue": "14:00"}), fields))
	assert.True(t, weeklyRowsChanged(run(map[string]any{}), fields))

	// An arrival row holds its weekday only: a new time changes nothing.
	arrival := []enrollmentNative.FormField{{
		Key: "pickup_times", Type: enrollmentNative.FormFieldWeekdaySchedule, AppliesToCh: true, Target: enrollmentNative.TargetScheduleArrival,
	}}
	assert.False(t, weeklyRowsChanged(run(map[string]any{"mon": "08:30"}), arrival))
	assert.True(t, weeklyRowsChanged(run(map[string]any{"tue": "15:00"}), arrival))
}

// An actor without an author of their own can only leave a stored author
// standing. A plan that has none yet, because it carried no weekly answer so
// far, gets none from them: their edit that adds one is refused, or the
// start would have nobody to name (#7818).
func TestEditedWeeklyPlanKeepsOnlyAStoredAuthor(t *testing.T) {
	t.Parallel()

	const schemaID int64 = 81
	const childID int64 = 82
	const actorAccountID int64 = 83
	schema := &enrollmentNative.FormSchema{Fields: []enrollmentNative.FormField{{
		Key: "pickup_times", Type: enrollmentNative.FormFieldWeekdaySchedule, AppliesToCh: true, Target: enrollmentNative.TargetSchedulePickup,
	}}}
	d := &Decisions{deps: DecisionDependencies{
		Schemas: weeklyPlanSchemaFake{schema: schema},
		People: PeopleDirectory{
			Persons: reviewerPersonsFake{person: &Person{ID: actorAccountID}},
			Staff:   reviewerStaffFake{err: errReviewerNotFound},
		},
		Runtime: Runtime{NotFound: func(err error) bool { return errors.Is(err, errReviewerNotFound) }},
	}}
	request := &enrollmentNative.Request{SchemaID: new(int64)}
	*request.SchemaID = schemaID
	edit := func(before, after map[string]any) *approvedChildSync {
		previous := map[string]any{}
		if before != nil {
			previous["pickup_times"] = before
		}
		return &approvedChildSync{
			input:    enrollmentNative.ApprovedChildSync{ActorAccountID: actorAccountID},
			request:  request,
			child:    &enrollmentNative.RequestChild{ID: childID, CustomData: formValues(map[string]any{"pickup_times": after})},
			snapshot: map[string]any{"children": []any{map[string]any{"id": childID, "custom_data": previous}}},
		}
	}
	times := map[string]any{"mon": "15:00"}

	_, err := d.editedWeeklyPlanAuthor(context.Background(), edit(nil, map[string]any{}), enrollmentNative.WeeklyPlan{})
	require.ErrorIs(t, err, enrollmentNative.ErrDecisionReviewerStaffRequired, "no stored author to keep")

	traegerPlan := enrollmentNative.WeeklyPlan{ByTraeger: true}
	kept, err := d.editedWeeklyPlanAuthor(context.Background(), edit(times, times), traegerPlan)
	require.NoError(t, err)
	assert.Equal(t, traegerPlan, kept)

	_, err = d.editedWeeklyPlanAuthor(context.Background(), edit(times, map[string]any{"mon": "16:00"}), traegerPlan)
	require.ErrorIs(t, err, enrollmentNative.ErrDecisionReviewerStaffRequired, "changed rows need the actor's own author")
}
