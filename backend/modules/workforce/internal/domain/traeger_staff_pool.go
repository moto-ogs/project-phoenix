package domain

import (
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The Vertretungspool of the Träger (#4709, ADR 0089 section 9).

// PoolSpringer is a Springer whose pool contracts cover days from PoolFrom
// on, until PoolUntil (zero while open).
type PoolSpringer struct {
	RecordID  int64
	FirstName string
	LastName  string
	PoolFrom  calendar.Date
	PoolUntil calendar.Date
}

// PoolBlock is one block of a Springer by one school. ID is zero for a
// block of another school in a tenant read. Start and End are HH:MM.
type PoolBlock struct {
	ID         int64
	RecordID   int64
	SchoolID   int64
	SchoolName string
	Own        bool
	Date       calendar.Date
	Start      string
	End        string
	Lifted     bool
}

// PoolProof is the status of one kind of Nachweis of a Springer.
type PoolProof struct {
	RecordID          int64
	TypeName          string
	Mandatory         bool
	Held              bool
	ExpiresOn         calendar.Date
	ReminderLeadWeeks int
}

// PoolProofState names a Nachweis as a school sees it: "missing" without a
// valid proof, "expiring" inside the reminder lead, "complete" otherwise.
func PoolProofState(proof PoolProof, today calendar.Date) string {
	if !proof.Held || (!proof.ExpiresOn.IsZero() && proof.ExpiresOn.Before(today)) {
		return "missing"
	}
	if !proof.ExpiresOn.IsZero() && !proof.ExpiresOn.After(today.AddDays(7*proof.ReminderLeadWeeks)) {
		return "expiring"
	}
	return "complete"
}

// PoolBlockSite is a school that blocked a Springer at least once.
type PoolBlockSite struct {
	SchoolID int64
	RecordID int64
}
