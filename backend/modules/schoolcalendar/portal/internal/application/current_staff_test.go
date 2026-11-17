package application

import (
	"context"
	"errors"
	"testing"

	appointmentcap "github.com/moto-ogs/project-phoenix/modules/appointments"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/portal/internal/ports"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var (
	errStaffMissingDouble = errors.New("caller not linked to staff")
	errLookupFailedDouble = errors.New("connection reset")
)

// currentStaffIdentity is an Identity double whose staff lookup fails with
// staffErr; it classifies only errStaffMissingDouble as a missing profile.
type currentStaffIdentity struct {
	ports.Identity
	staffErr error
}

func (i currentStaffIdentity) GetCurrentStaff(context.Context) (*ports.Staff, error) {
	return nil, i.staffErr
}

func (i currentStaffIdentity) GetCurrentUser(context.Context) (*ports.Account, error) {
	return &ports.Account{ID: 1, Active: true}, nil
}

// staffFeedRepoStub satisfies the configuration check; the staff lookup
// fails before any feed row is read.
type staffFeedRepoStub struct{ ports.StaffFeeds }

func (currentStaffIdentity) MissingUser(error) bool { return false }

func (currentStaffIdentity) MissingStaff(err error) bool {
	return errors.Is(err, errStaffMissingDouble)
}

func TestStaffOnlyReadsSeparateMissingProfileFromLookupFailures(t *testing.T) {
	t.Parallel()

	start := appointmentcap.NewDate(2026, 1, 5)
	reads := map[string]func(*service) error{
		"ListMyStaffEvents": func(svc *service) error {
			_, err := svc.ListMyStaffEvents(context.Background(), start, start)
			return err
		},
		"StaffCalendarAccess": func(svc *service) error {
			_, err := svc.StaffCalendarAccess(context.Background())
			return err
		},
		"RotateStaffCalendarAccess": func(svc *service) error {
			_, err := svc.RotateStaffCalendarAccess(context.Background())
			return err
		},
		"RespondToStaffInvitation": func(svc *service) error {
			return svc.RespondToStaffInvitation(context.Background(), 1, InvitationAnswer{Status: "accepted"})
		},
		"GetStaffAppointmentOverview": func(svc *service) error {
			_, err := svc.GetStaffAppointmentOverview(context.Background(), 1, "")
			return err
		},
	}

	for name, read := range reads {
		t.Run(name+"/missing profile", func(t *testing.T) {
			t.Parallel()
			err := read(newCurrentStaffService(errStaffMissingDouble))
			require.ErrorIs(t, err, ErrNoStaffProfile)
		})
		t.Run(name+"/lookup failure", func(t *testing.T) {
			t.Parallel()
			err := read(newCurrentStaffService(errLookupFailedDouble))
			require.ErrorIs(t, err, errLookupFailedDouble)
			assert.NotErrorIs(t, err, ErrForbidden, "a lookup failure is a server fault, not a refusal")
		})
	}
}

func newCurrentStaffService(staffErr error) *service {
	return &service{cfg: Config{
		UserContext:   currentStaffIdentity{staffErr: staffErr},
		StaffFeedRepo: staffFeedRepoStub{},
		FrontendURL:   "https://moto.test",
	}}
}
