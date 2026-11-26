package compose

import (
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/application"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/ports"
	calendar "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type PickupApprovalDependencies struct {
	People      ports.PickupApprovalDirectory
	Departure   ports.RequestSubmissionPickup
	Presence    ports.PickupApprovalPresence
	Exceptions  ports.PickupApprovalExceptions
	Excusal     ports.PickupApprovalExcusal
	Locker      ports.PickupApprovalLocker
	Persons     ports.PickupApprovalPersons
	Today       func() calendar.Date
	Fingerprint func([]byte) string // lowercase hexadecimal SHA-256 of the content
}

func NewPickupApprovals(deps PickupApprovalDependencies) (carerequests.PickupApprovals, error) {
	if deps.People == nil || deps.Departure == nil || deps.Presence == nil || deps.Exceptions == nil || deps.Excusal == nil || deps.Locker == nil || deps.Persons == nil || deps.Today == nil || deps.Fingerprint == nil {
		return nil, errors.New("pickup approvals: people, departure plan, presence, exceptions, excusal, care-day locker, pickup persons, clock, and impact fingerprint are required")
	}
	return &application.PickupApprovals{
		People: deps.People, Departure: deps.Departure, Presence: deps.Presence, Exceptions: deps.Exceptions,
		Excusal: deps.Excusal, Locker: deps.Locker, Persons: deps.Persons, Today: deps.Today, Fingerprint: deps.Fingerprint,
	}, nil
}
