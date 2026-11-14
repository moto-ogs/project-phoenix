package timetracking

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// A type marked requestable goes to the Leitung as a request (#4710): the
// caregiver's entry holds its days as requested and changes no plan until
// the Leitung decides; a request beyond the Kontingent is refused.
func TestAbsCreateOwnAbsence_RequestableTypeBecomesARequest(t *testing.T) {
	t.Parallel()
	requestable := &StaffAbsenceType{
		Model: Model{ID: 42}, Name: "Regenerationstag",
		BaseType: AbsenceTypeOther, IsActive: true, AllowanceEnabled: true, Requestable: true,
	}
	typeID := requestable.ID
	request := CreateAbsenceRequest{AbsenceTypeID: &typeID, DateStart: "2099-03-02", DateEnd: "2099-03-06", Note: "Bitte"}

	t.Run("stored as requested", func(t *testing.T) {
		t.Parallel()
		svc, absRepo, _ := absSetupService()
		syncer := &absShiftPlanSyncerMock{}
		svc.shiftPlanSyncer = syncer
		svc.absenceTypes = &absTypeReaderMock{rows: []*StaffAbsenceType{requestable}}
		var stored *StaffAbsence
		absRepo.createFunc = func(_ context.Context, entity *StaffAbsence) error {
			copied := *entity
			stored = &copied
			return nil
		}
		resp, err := svc.CreateOwnAbsence(context.Background(), 7, nil, request)
		require.NoError(t, err)
		require.NotNil(t, stored)
		assert.Equal(t, AbsenceStatusRequested, stored.Status)
		assert.Equal(t, AbsenceTypeOther, stored.AbsenceType)
		require.NotNil(t, stored.AbsenceTypeID)
		assert.Equal(t, typeID, *stored.AbsenceTypeID)
		require.NotNil(t, stored.WorkingDays)
		assert.Equal(t, 5.0, *stored.WorkingDays)
		assert.Equal(t, AbsenceStatusRequested, resp.Status)
		assert.Empty(t, syncer.markCalls, "a request changes no plan before the Leitung decides")
	})

	t.Run("refused beyond the Kontingent", func(t *testing.T) {
		t.Parallel()
		svc, absRepo, _ := absSetupService()
		svc.absenceTypes = &absTypeReaderMock{rows: []*StaffAbsenceType{requestable}, previewAllowanceBookingError: workforce.ErrAbsenceTypeAllowanceExceeded}
		absRepo.createFunc = func(context.Context, *StaffAbsence) error {
			t.Fatal("a request beyond the Kontingent must not be stored")
			return nil
		}
		_, err := svc.CreateOwnAbsence(context.Background(), 7, nil, request)
		require.ErrorIs(t, err, workforce.ErrAbsenceTypeAllowanceExceeded)
	})

	t.Run("a type with a Kontingent that is not requestable stays with the Leitung", func(t *testing.T) {
		t.Parallel()
		svc, _, _ := absSetupService()
		managed := *requestable
		managed.Requestable = false
		svc.absenceTypes = &absTypeReaderMock{rows: []*StaffAbsenceType{&managed}}
		_, err := svc.CreateOwnAbsence(context.Background(), 7, nil, request)
		require.ErrorIs(t, err, ErrManagerControlledAbsence)
	})
}
