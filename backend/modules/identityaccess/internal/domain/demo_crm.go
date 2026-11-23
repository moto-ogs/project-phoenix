package domain

import "time"

type DemoCRMContact struct {
	Email, FirstName, LastName, Phone string
	SchoolName, Source, AccessID      string
	ContactOptIn                      bool
	RequestedAt, StartedAt            time.Time
}

type DemoCRMJob struct {
	ID       int64
	Lease    string
	Attempts int
	Contact  DemoCRMContact
}
