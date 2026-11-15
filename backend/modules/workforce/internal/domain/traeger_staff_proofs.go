package domain

import (
	"errors"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Nachweise am Personalstamm (#4707, ADR 0089 section 7): the kinds of proof
// a Träger asks for and one proof per kind and record. Of a certificate of
// conduct moto keeps only that it was inspected, its issue day and the
// result „keine einschlägige Eintragung“, never a copy (§ 72a Abs. 5
// SGB VIII); of every other proof the day it was presented and its expiry.

// Standard kinds of the Träger. The keys are stable; the names are the
// Träger's to rename.
const (
	TraegerProofStandardPoliceCertificate = "police_certificate"
	TraegerProofStandardMeasles           = "measles_protection"
	TraegerProofStandardPrevention        = "prevention_training"
)

var (
	// ErrTraegerProofTypeNameTaken: a live kind of the Träger has the name.
	ErrTraegerProofTypeNameTaken = errors.New("traeger proof type name is already taken")
	// ErrTraegerProofTypeMissing: the Träger has no such kind, or it is
	// archived where a live one is needed.
	ErrTraegerProofTypeMissing = errors.New("traeger proof type not found")
	// ErrTraegerProofMissing: the record holds no proof of the kind.
	ErrTraegerProofMissing = errors.New("traeger proof not found")
)

// TraegerProofInvalidError names the field of a proof or kind that is
// invalid.
type TraegerProofInvalidError struct {
	Field  string
	Reason string
}

func (e *TraegerProofInvalidError) Error() string { return e.Field + ": " + e.Reason }

func invalidProof(field, reason string) error {
	return &TraegerProofInvalidError{Field: field, Reason: reason}
}

// TraegerProofType is one kind of proof of a Träger.
type TraegerProofType struct {
	ID                int64
	OrganizationID    int64
	StandardKey       string
	Name              string
	ValidityMonths    *int
	ReminderLeadWeeks int
	Mandatory         bool
	SortOrder         int
	ArchivedAt        *time.Time
}

// Archived reports whether the kind is no longer offered.
func (t TraegerProofType) Archived() bool { return t.ArchivedAt != nil }

// PoliceCertificate reports whether the kind is the certificate of conduct,
// whose result moto records instead of a document.
func (t TraegerProofType) PoliceCertificate() bool {
	return t.StandardKey == TraegerProofStandardPoliceCertificate
}

// Normalize trims the name and checks the bounds the table enforces.
func (t TraegerProofType) Normalize() (TraegerProofType, error) {
	t.Name = strings.TrimSpace(t.Name)
	switch {
	case t.Name == "":
		return t, invalidProof("name", "the name is required")
	case len([]rune(t.Name)) > maxQualificationTypeName:
		return t, invalidProof("name", "the name must not exceed 100 characters")
	case t.ValidityMonths != nil && (*t.ValidityMonths < 1 || *t.ValidityMonths > maxValidityMonths):
		return t, invalidProof("validity_months", "validity_months must be between 1 and 240")
	case t.ReminderLeadWeeks < 0 || t.ReminderLeadWeeks > maxReminderLeadWeeks:
		return t, invalidProof("reminder_lead_weeks", "reminder_lead_weeks must be between 0 and 52")
	}
	return t, nil
}

// StandardTraegerProofTypes is the list a Träger starts with (ADR 0089
// section 7). The certificate of conduct is checked again every five years
// (§ 72a Abs. 1 SGB VIII in the agreements of the youth welfare offices) and
// is mandatory like the measles protection (§ 20 Abs. 8 IfSG); the
// measles protection does not expire. The prevention training is refreshed
// every five years where a diocese or association asks for it.
func StandardTraegerProofTypes() []TraegerProofType {
	return []TraegerProofType{
		{StandardKey: TraegerProofStandardPoliceCertificate, Name: "Erweitertes Führungszeugnis", ValidityMonths: months(60), ReminderLeadWeeks: 12, Mandatory: true, SortOrder: 0},
		{StandardKey: TraegerProofStandardMeasles, Name: "Masernschutz", ReminderLeadWeeks: DefaultReminderLeadWeeks, Mandatory: true, SortOrder: 1},
		{StandardKey: TraegerProofStandardPrevention, Name: "Präventionsschulung", ValidityMonths: months(60), ReminderLeadWeeks: DefaultReminderLeadWeeks, SortOrder: 2},
	}
}

// TraegerProof is the proof of one kind at one record. Dates are calendar
// days (YYYY-MM-DD); IssuedOn and ExpiresOn may be empty.
type TraegerProof struct {
	ID                  int64
	OrganizationID      int64
	RecordID            int64
	TypeID              int64
	PresentedOn         string
	IssuedOn            string
	NoRelevantEntry     bool
	ExpiresOn           string
	LeadRemindedFor     string
	ExpiryRemindedFor   string
	RecordedByAccountID int64
	UpdatedAt           time.Time
}

// PrepareProof checks a proof for its kind on today and fills the expiry
// date the kind's validity suggests when none is given: from the issue day
// of a certificate of conduct, from the day presented otherwise. A proof
// lies in the past: no day after today. A certificate of conduct needs its
// issue day and the confirmed result; every other kind records none.
func PrepareProof(proof TraegerProof, kind TraegerProofType, today calendar.Date) (TraegerProof, error) {
	presented, err := calendar.ParseDate(proof.PresentedOn)
	if err != nil {
		return proof, invalidProof("presented_on", "presented_on must be a date (YYYY-MM-DD)")
	}
	if presented.After(today) {
		return proof, invalidProof("presented_on", "presented_on must not lie in the future")
	}
	base := presented
	if kind.PoliceCertificate() {
		issued, err := calendar.ParseDate(proof.IssuedOn)
		switch {
		case err != nil:
			return proof, invalidProof("issued_on", "the certificate of conduct needs its issue day")
		case issued.After(presented):
			return proof, invalidProof("issued_on", "issued_on must not lie after presented_on")
		case !proof.NoRelevantEntry:
			return proof, invalidProof("no_relevant_entry", "moto records a certificate of conduct only without a relevant entry")
		}
		base = issued
	} else {
		proof.IssuedOn, proof.NoRelevantEntry = "", false
	}
	if proof.ExpiresOn == "" {
		if kind.ValidityMonths != nil {
			proof.ExpiresOn = AddCalendarMonths(base, *kind.ValidityMonths).String()
		}
		return proof, nil
	}
	expiry, err := calendar.ParseDate(proof.ExpiresOn)
	switch {
	case err != nil:
		return proof, invalidProof("expires_on", "expires_on must be a date (YYYY-MM-DD)")
	case expiry.Before(presented):
		return proof, invalidProof("expires_on", "expires_on must not lie before presented_on")
	}
	return proof, nil
}

// AddCalendarMonths moves a day by whole months and keeps it inside the
// target month: 31 January plus one month is the last day of February.
func AddCalendarMonths(day calendar.Date, count int) calendar.Date {
	year, month := day.Year(), int(day.Month())-1+count
	year += month / 12
	month %= 12
	if month < 0 {
		month += 12
		year--
	}
	last := calendar.NewDate(year, time.Month(month+2), 1).AddDays(-1).Day()
	return calendar.NewDate(year, time.Month(month+1), min(day.Day(), last))
}

// TraegerProofStatus is the status of a kind at a record on a day: missing
// when a mandatory kind has no proof, otherwise the status of its expiry
// (QualificationStatus). A kind that is neither mandatory nor held has no
// status and reports "".
func TraegerProofStatus(kind TraegerProofType, proof *TraegerProof, today calendar.Date) string {
	if proof == nil {
		if kind.Mandatory {
			return QualificationStatusMissing
		}
		return ""
	}
	return QualificationStatus(proof.ExpiresOn, kind.ReminderLeadWeeks, today)
}

// DueTraegerProofReminder names the reminder a proof is due for on a day,
// by the rules of the school's reminders (DueQualificationReminder).
func DueTraegerProofReminder(proof TraegerProof, leadWeeks int, today calendar.Date) (string, bool) {
	return DueQualificationReminder(StaffQualification{
		ExpiresOn: proof.ExpiresOn, LeadRemindedFor: proof.LeadRemindedFor, ExpiryRemindedFor: proof.ExpiryRemindedFor,
	}, leadWeeks, today)
}

// TraegerProofTypeMapping maps one kind of a school onto a kind of its
// Träger (decision E4 of 13.11.2026).
type TraegerProofTypeMapping struct {
	SchoolID     int64
	SchoolTypeID int64
	ProofTypeID  int64
}

// SchoolTraegerProofStatus is what a school reads of the Träger's proofs of
// one of its employments (ADR 0089 section 7): the kind and its status, and
// the school kinds mapped onto it.
type SchoolTraegerProofStatus struct {
	StaffID           int64
	ProofTypeID       int64
	TypeName          string
	Mandatory         bool
	Held              bool
	ExpiresOn         string
	ReminderLeadWeeks int
	SchoolTypeIDs     []int64
}
