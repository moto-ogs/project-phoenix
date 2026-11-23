package application

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// editReviewStore is a review store with one received registration of one
// child. Its audit entry fails on demand: the edit then fails too, so the
// Träger transaction rolls the written details back (#5629). The embedded
// interface panics on every method the edit does not call.
type editReviewStore struct {
	HolidayReviewStore
	auditErr error
	written  int
	audited  []string
}

func (s *editReviewStore) LockHolidayRegistration(context.Context, int64, int64, int64) (string, string, string, bool, error) {
	return enrollment.HolidayRegistrationReceived, "", "", true, nil
}

func (s *editReviewStore) ReadHolidayReview(context.Context, int64, int64, int64) ([]enrollment.HolidayRegistrationDetail, map[int64]string, error) {
	return []enrollment.HolidayRegistrationDetail{{HolidayRegistrationSummary: enrollment.HolidayRegistrationSummary{
		ID: 7, Status: enrollment.HolidayRegistrationReceived, GuardianFirstName: "Eva", GuardianLastName: "Muster",
		GuardianEmail: "eva.muster@example.org", GuardianPhone: "0151 1",
		Children: []enrollment.HolidayRegistrationChild{{ID: 11, FirstName: "Lia", LastName: "Muster", BirthDate: calendar.NewDate(2018, 3, 1)}},
	}}}, map[int64]string{}, nil
}

func (s *editReviewStore) ReadHolidayContacts(context.Context, int64, int64) ([]enrollment.HolidayRegistrationContact, error) {
	return []enrollment.HolidayRegistrationContact{{Kind: enrollment.HolidayContactEmergency, Name: "Oma Muster", Phone: "05402 1"}}, nil
}

func (s *editReviewStore) ReadHolidayAnswers(context.Context, int64, int64, int64) (map[int64]enrollment.HolidayRegistrationAnswers, error) {
	return map[int64]enrollment.HolidayRegistrationAnswers{7: {FormVersion: 1, CustomData: enrollment.HolidayAnswers{},
		Children: []enrollment.HolidayChildAnswers{{ChildID: 11, CustomData: enrollment.HolidayAnswers{}}}}}, nil
}

func (s *editReviewStore) WriteHolidayRegistrationDetails(context.Context, int64, int64, enrollment.HolidayRegistrationInput, []int64, []bool) error {
	s.written++
	return nil
}

func (s *editReviewStore) AppendHolidayAudit(_ context.Context, _, _, _ int64, action string, _ any, _ int64) error {
	if s.auditErr != nil {
		return s.auditErr
	}
	s.audited = append(s.audited, action)
	return nil
}

func (s *editReviewStore) ReadHolidayHistory(context.Context, int64, int64) ([]enrollment.HolidayRegistrationEvent, error) {
	return nil, nil
}

func (s *editReviewStore) ReadHolidayProofs(context.Context, int64, int64) ([]enrollment.HolidayRegistrationProof, error) {
	return nil, nil
}

type editPeriodStore struct{ HolidayPeriodStore }

func (editPeriodStore) FindHolidayPeriod(context.Context, int64, int64, bool) (enrollment.HolidayPeriod, bool, error) {
	return enrollment.HolidayPeriod{ID: 3, RegistrationClosesOn: calendar.NewDate(2099, 1, 1)}, true, nil
}

type editFormStore struct{ HolidayFormStore }

func (editFormStore) HolidayPeriodForms(context.Context, int64, int64, []int) (map[int]enrollment.HolidayPeriodForm, error) {
	return map[int]enrollment.HolidayPeriodForm{1: {Version: 1}}, nil
}

type editCipher struct{}

func (editCipher) Seal(plaintext, _ []byte) ([]byte, error) { return plaintext, nil }
func (editCipher) Open(sealed, _ []byte) ([]byte, error)    { return sealed, nil }

func newEditReview(store *editReviewStore) *HolidayRegistrationReview {
	review, _, _, _ := NewHolidayRegistrationReview(store, editPeriodStore{}, editFormStore{}, editCipher{},
		func() calendar.Date { return calendar.NewDate(2026, 11, 3) }, nil, nil, nil, nil)
	return review
}

// storedVersion is the version a read of the registration answers.
func storedVersion(t *testing.T, store *editReviewStore) string {
	t.Helper()
	detail, err := newEditReview(store).editedDetail(t.Context(), 1, enrollment.HolidayPeriod{ID: 3}, 7)
	require.NoError(t, err)
	require.NotEmpty(t, detail.Version)
	return detail.Version
}

func editedPhone(t *testing.T, store *editReviewStore, phone string) enrollment.HolidayRegistrationEdit {
	t.Helper()
	return enrollment.HolidayRegistrationEdit{ExpectedVersion: storedVersion(t, store), Guardians: &enrollment.HolidayGuardiansEdit{Guardian: enrollment.HolidayGuardianInput{
		FirstName: "Eva", LastName: "Muster", Email: "eva.muster@example.org", Phone: phone,
	}}}
}

// TestHolidayRegistrationEditRefusesAnotherReadVersion pins ADR 0311: an
// edit over another version than the stored one, or over none, is refused
// before anything is written or audited.
func TestHolidayRegistrationEditRefusesAnotherReadVersion(t *testing.T) {
	t.Parallel()
	store := &editReviewStore{}
	reviewer := enrollment.HolidayReviewer{OrganizationID: 1, AccountID: 2}
	for _, expected := range []string{"older", ""} {
		edit := editedPhone(t, store, "0151 2")
		edit.ExpectedVersion = expected
		_, err := newEditReview(store).EditHolidayRegistration(t.Context(), reviewer, 3, 7, edit, nil)
		require.ErrorIs(t, err, readstate.ErrChanged, "expected version %q", expected)
	}
	assert.Zero(t, store.written, "a refused edit writes nothing")
	assert.Empty(t, store.audited)
}

func TestHolidayRegistrationEditFailsWithItsAuditEntry(t *testing.T) {
	t.Parallel()
	store := &editReviewStore{auditErr: errors.New("audit unavailable")}
	reviewer := enrollment.HolidayReviewer{OrganizationID: 1, AccountID: 2}
	_, err := newEditReview(store).EditHolidayRegistration(t.Context(), reviewer, 3, 7, editedPhone(t, store, "0151 2"), nil)
	require.ErrorIs(t, err, store.auditErr, "without the entry the edit fails and its transaction rolls back")
}

func TestHolidayRegistrationEditWithoutChangeWritesNothing(t *testing.T) {
	t.Parallel()
	store := &editReviewStore{}
	reviewer := enrollment.HolidayReviewer{OrganizationID: 1, AccountID: 2}
	_, err := newEditReview(store).EditHolidayRegistration(t.Context(), reviewer, 3, 7, editedPhone(t, store, " 0151 1 "), nil)
	require.NoError(t, err)
	assert.Zero(t, store.written, "the same values, trimmed, are no change")
	assert.Empty(t, store.audited)

	_, err = newEditReview(store).EditHolidayRegistration(t.Context(), reviewer, 3, 7, editedPhone(t, store, "0151 2"), nil)
	require.NoError(t, err)
	assert.Equal(t, 1, store.written)
	assert.Equal(t, []string{enrollment.HolidayAuditEdit}, store.audited)
}

// rebookReviewStore is the registration of editReviewStore whose child books
// week 5 with time model 6; placement is what the week's places gave that
// booking.
type rebookReviewStore struct {
	*editReviewStore
	placement string
	replaced  int
}

func (s *rebookReviewStore) ReadHolidayReview(ctx context.Context, organizationID, periodID, registrationID int64) ([]enrollment.HolidayRegistrationDetail, map[int64]string, error) {
	read, overrides, err := s.editReviewStore.ReadHolidayReview(ctx, organizationID, periodID, registrationID)
	read[0].Children[0].Bookings = []enrollment.HolidayRegistrationBooking{{WeekID: 5, TimeModelID: 6, Placement: s.placement}}
	return read, overrides, err
}

func (s *rebookReviewStore) ReplaceHolidayChildBookings(context.Context, int64, int64, int64, []enrollment.HolidayBookingInput, string) ([]int64, error) {
	s.replaced++
	return nil, nil
}

type rebookPeriodStore struct{ HolidayPeriodStore }

func (rebookPeriodStore) FindHolidayPeriod(context.Context, int64, int64, bool) (enrollment.HolidayPeriod, bool, error) {
	monday := calendar.NewDate(2027, 7, 19)
	return enrollment.HolidayPeriod{ID: 3, RegistrationClosesOn: calendar.NewDate(2099, 1, 1), Weeks: []enrollment.HolidayWeek{{
		ID: 5, StartsOn: monday, EndsOn: monday.AddDays(4), HostSchoolID: ident.ID(careDayHostSchool),
		TimeModels: []enrollment.HolidayTimeModel{{ID: 6, Name: "bis 13 Uhr", StartsAt: "08:00", EndsAt: "13:00", PriceCents: 4500}},
	}}}, true, nil
}

// TestHolidayRebookingRefusesAReadBeforeAMoveUp pins the placement in the
// registration's version (ADR 0311, ADR 0314): the Büro decides a rebooking
// on the placement its card shows, so a booking that moved up from the
// waiting list since the read refuses the rebooking and writes nothing; the
// version read after the move up rebooks.
func TestHolidayRebookingRefusesAReadBeforeAMoveUp(t *testing.T) {
	t.Parallel()
	store := &rebookReviewStore{editReviewStore: &editReviewStore{}, placement: enrollment.HolidayPlacementWaitlisted}
	review, _, _, _ := NewHolidayRegistrationReview(store, rebookPeriodStore{}, editFormStore{}, editCipher{},
		func() calendar.Date { return calendar.NewDate(2026, 11, 3) }, nil, nil, careDaySchoolCalendar{}, nil)
	period, _, _ := rebookPeriodStore{}.FindHolidayPeriod(t.Context(), 1, 3, false)
	versionNow := func() string {
		detail, err := review.editedDetail(t.Context(), 1, period, 7)
		require.NoError(t, err)
		return detail.Version
	}
	waiting := versionNow()
	store.placement = enrollment.HolidayPlacementPlaced
	reviewer := enrollment.HolidayReviewer{OrganizationID: 1, AccountID: 2}
	bookings := []enrollment.HolidayBookingInput{{WeekID: 5, TimeModelID: 6, Lunch: false}}

	_, err := review.RebookHolidayChild(t.Context(), reviewer, 3, 7, 11, waiting, bookings)
	require.ErrorIs(t, err, readstate.ErrChanged, "the move up changed what the Büro read")
	assert.Zero(t, store.replaced, "a refused rebooking writes nothing")
	assert.Empty(t, store.audited)

	placed := versionNow()
	detail, err := review.RebookHolidayChild(t.Context(), reviewer, 3, 7, 11, placed, bookings)
	require.NoError(t, err)
	assert.Equal(t, 1, store.replaced)
	assert.Equal(t, placed, detail.Version, "the answer carries the version of the stored placement")
}
