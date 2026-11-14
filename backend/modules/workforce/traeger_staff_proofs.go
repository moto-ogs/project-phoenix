package workforce

import (
	"context"
	"errors"
	"fmt"
)

// Nachweise am Personalstamm (#4707, ADR 0089 section 7). The Träger keeps
// one proof per kind and record: the day it was presented, its expiry and,
// for a certificate of conduct, its issue day and the result „keine
// einschlägige Eintragung“, never a copy (§ 72a Abs. 5 SGB VIII). The kinds
// with their validity, reminder lead and mandatory flag are the Träger's.
// Every school kind maps once onto a Träger kind (decision E4 of
// 13.11.2026), so a person the Träger keeps is reminded once.

// The statuses of a proof on the list, the same as the school's (#4808).
const (
	TraegerProofStatusValid        = "valid"
	TraegerProofStatusExpiringSoon = "expiring_soon"
	TraegerProofStatusExpired      = "expired"
	TraegerProofStatusMissing      = "missing"
)

// The access log views of the Nachweise (ADR 0084 section 7).
const (
	TraegerStaffViewProofList   = "staff_proof_list"
	TraegerStaffViewProofExport = "staff_proof_export"
	TraegerStaffViewProofChange = "staff_proof_change"
)

var (
	// ErrTraegerProofTypeNotFound answers an unknown, foreign or archived
	// kind.
	ErrTraegerProofTypeNotFound = errors.New("workforce: proof type not found")
	// ErrTraegerProofTypeNameTaken refuses a second live kind of one name.
	ErrTraegerProofTypeNameTaken = errors.New("workforce: proof type name is already taken")
	// ErrTraegerProofNotFound answers a proof the record does not hold.
	ErrTraegerProofNotFound = errors.New("workforce: proof not found")
	// ErrTraegerProofInvalid refuses a proof or kind; TraegerProofError
	// names the field.
	ErrTraegerProofInvalid = errors.New("workforce: the proof is invalid")
	// ErrTraegerProofMappingInvalid refuses a mapping of a kind the school
	// does not have.
	ErrTraegerProofMappingInvalid = errors.New("workforce: the school has no such proof kind")
)

// TraegerProofError names the invalid field of a proof or kind.
type TraegerProofError struct {
	Field  string
	Reason string
}

func (e *TraegerProofError) Error() string {
	return fmt.Sprintf("workforce: proof %s: %s", e.Field, e.Reason)
}

func (e *TraegerProofError) Unwrap() error { return ErrTraegerProofInvalid }

// TraegerStaffProofType is one kind of proof of the Träger.
// PoliceCertificate marks the certificate of conduct, whose result moto
// records instead of a document.
type TraegerStaffProofType struct {
	ID                int64  `json:"id"`
	StandardKey       string `json:"standard_key,omitempty"`
	Name              string `json:"name"`
	ValidityMonths    *int   `json:"validity_months"`
	ReminderLeadWeeks int    `json:"reminder_lead_weeks"`
	Mandatory         bool   `json:"mandatory"`
	Archived          bool   `json:"archived"`
	PoliceCertificate bool   `json:"police_certificate"`
}

// TraegerStaffProofTypeInput creates or rewrites a kind.
type TraegerStaffProofTypeInput struct {
	Name              string
	ValidityMonths    *int
	ReminderLeadWeeks int
	Mandatory         bool
	Archived          bool
}

// TraegerStaffProof is the state of one kind at one record: Held with the
// days of the proof, or not held. Status is empty for a kind that is
// neither mandatory nor held.
type TraegerStaffProof struct {
	TypeID            int64  `json:"type_id"`
	TypeName          string `json:"type_name"`
	Mandatory         bool   `json:"mandatory"`
	PoliceCertificate bool   `json:"police_certificate"`
	Held              bool   `json:"held"`
	Status            string `json:"status"`
	PresentedOn       string `json:"presented_on,omitempty"`
	IssuedOn          string `json:"issued_on,omitempty"`
	NoRelevantEntry   bool   `json:"no_relevant_entry"`
	ExpiresOn         string `json:"expires_on,omitempty"`
}

// TraegerStaffProofInput records or renews the proof of one kind. An empty
// ExpiresOn takes the expiry the kind's validity suggests.
type TraegerStaffProofInput struct {
	PresentedOn     string
	IssuedOn        string
	NoRelevantEntry bool
	ExpiresOn       string
}

// TraegerStaffProofEntry is one row of the list: a kind at a record that is
// expired, expiring, missing or valid.
type TraegerStaffProofEntry struct {
	RecordID        int64    `json:"staff_record_id"`
	FirstName       string   `json:"first_name"`
	LastName        string   `json:"last_name"`
	PersonnelNumber *string  `json:"personnel_number"`
	Schools         []string `json:"schools"`
	TypeID          int64    `json:"type_id"`
	TypeName        string   `json:"type_name"`
	Status          string   `json:"status"`
	PresentedOn     string   `json:"presented_on,omitempty"`
	ExpiresOn       string   `json:"expires_on,omitempty"`
}

// TraegerStaffProofCounts counts the entries by status.
type TraegerStaffProofCounts struct {
	Expired      int `json:"expired"`
	ExpiringSoon int `json:"expiring_soon"`
	Missing      int `json:"missing"`
	Valid        int `json:"valid"`
}

// TraegerStaffProofList is every proof state of the Träger's records, the
// most urgent first: expired, missing, expiring by expiry date, valid.
type TraegerStaffProofList struct {
	Today   string                   `json:"today"`
	Types   []TraegerStaffProofType  `json:"types"`
	Entries []TraegerStaffProofEntry `json:"entries"`
	Counts  TraegerStaffProofCounts  `json:"counts"`
}

// TraegerSchoolProofKind is one kind of proof of a school with the Träger
// kind it maps onto, nil while it maps onto none.
type TraegerSchoolProofKind struct {
	SchoolTypeID int64  `json:"school_type_id"`
	Name         string `json:"name"`
	ProofTypeID  *int64 `json:"proof_type_id"`
}

// TraegerSchoolProofKinds are the live kinds of one school of the Träger.
type TraegerSchoolProofKinds struct {
	SchoolID   int64                    `json:"school_id"`
	SchoolName string                   `json:"school_name"`
	Kinds      []TraegerSchoolProofKind `json:"kinds"`
}

// TraegerProofMappingInput maps a school kind onto a Träger kind, or with a
// nil ProofTypeID removes the mapping.
type TraegerProofMappingInput struct {
	SchoolID     int64
	SchoolTypeID int64
	ProofTypeID  *int64
}

// TraegerStaffProofs is the Nachweise in the Träger-Portal. Every method
// checks the release; the route checks the right „Personal“. A read or
// write of a record's proofs writes an access entry at every Einsatzort of
// the records it shows (ADR 0084 section 7).
type TraegerStaffProofs interface {
	ProofTypes(ctx context.Context, actor TraegerStaffActor) ([]TraegerStaffProofType, error)
	CreateProofType(ctx context.Context, actor TraegerStaffActor, input TraegerStaffProofTypeInput) (TraegerStaffProofType, error)
	UpdateProofType(ctx context.Context, actor TraegerStaffActor, id int64, input TraegerStaffProofTypeInput) (TraegerStaffProofType, error)
	SaveProof(ctx context.Context, actor TraegerStaffActor, recordID, typeID int64, input TraegerStaffProofInput) ([]TraegerStaffProof, error)
	DeleteProof(ctx context.Context, actor TraegerStaffActor, recordID, typeID int64) ([]TraegerStaffProof, error)
	// ProofList lists every proof state; view names the access entry, the
	// list or its export.
	ProofList(ctx context.Context, actor TraegerStaffActor, view string) (TraegerStaffProofList, error)
	SchoolProofKinds(ctx context.Context, actor TraegerStaffActor) ([]TraegerSchoolProofKinds, error)
	MapProofKind(ctx context.Context, actor TraegerStaffActor, input TraegerProofMappingInput) ([]TraegerSchoolProofKinds, error)
}

// SchoolTraegerProof is what a school sees of the Träger's proof of one kind
// for one of its employments (ADR 0089 section 7): the status, the expiry
// date and nothing of the proof itself.
type SchoolTraegerProof struct {
	TypeName  string `json:"type_name"`
	Status    string `json:"status"`
	ExpiresOn string `json:"expires_on,omitempty"`
}

// TraegerProofReminders sends the warnings before a proof of the
// Personalstamm expires, at every released Träger (#4707).
type TraegerProofReminders interface {
	RunDue(ctx context.Context) error
}

// TraegerProofReminderPorts are the collaborators of the warnings: the
// active Träger, the transactions and the ports of the school reminders.
type TraegerProofReminderPorts struct {
	Traeger   func(ctx context.Context) ([]int64, error)
	Runtime   TraegerStaffRuntime
	Reminders QualificationReminderPorts
}
