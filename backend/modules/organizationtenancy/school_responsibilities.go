package organizationtenancy

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// Responsibilities at a school of a Träger (#4811, ADR 0088): who concludes
// the care contracts, who bills the parents and who employs the staff. Each
// is the Träger, the Schulträger or the Gemeinde. Which body it is, is a
// setting with a Träger value and a school override (responsibility.*, ADR
// 0086); the Settings Platform resolves it and the root binds the read. The
// master data of a Schulträger or a Gemeinde are kept here per school, like
// the Träger's own master data (ADR 0112), and written in the Träger
// transaction (ADR 0105).
//
// A body is responsible only once its master data are stored: a setting
// that names a Gemeinde without a stored Gemeinde leaves the Träger
// responsible, so no document names a body without an address.

// ResponsibilityArea is what a body is responsible for.
type ResponsibilityArea string

// The three areas, in the order every answer lists them.
const (
	ResponsibilityContracts ResponsibilityArea = "contracts"
	ResponsibilityBilling   ResponsibilityArea = "billing"
	ResponsibilityStaff     ResponsibilityArea = "staff"
)

// ResponsibilityAreas lists every area in its canonical order.
func ResponsibilityAreas() []ResponsibilityArea {
	return []ResponsibilityArea{ResponsibilityContracts, ResponsibilityBilling, ResponsibilityStaff}
}

// ResponsibleBody is a body that may be responsible.
type ResponsibleBody string

// The bodies. The values are the values of the settings responsibility.*.
const (
	BodyTraeger      ResponsibleBody = "traeger"
	BodySchultraeger ResponsibleBody = "schultraeger"
	BodyGemeinde     ResponsibleBody = "gemeinde"
)

// HasMasterData reports whether the body keeps master data per school: the
// Schulträger and the Gemeinde do, the Träger has its own (ADR 0112).
func (b ResponsibleBody) HasMasterData() bool { return b == BodySchultraeger || b == BodyGemeinde }

// ResponsibilitySource names where a school's choice comes from: the
// registry default, the value of its Träger or its own override.
type ResponsibilitySource string

// The sources, the value sources of the Settings Platform.
const (
	ResponsibilityFromDefault ResponsibilitySource = "default"
	ResponsibilityFromTraeger ResponsibilitySource = "traeger"
	ResponsibilityFromSchool  ResponsibilitySource = "school"
)

var (
	// ErrSchoolPartySchoolNotFound reports a school that is no school of
	// the Träger: an unknown one and one of another Träger read the same.
	ErrSchoolPartySchoolNotFound = errors.New("organization tenancy: the school is no school of the Träger")
	// ErrSchoolPartyNotFound reports a body the school has no master data
	// of.
	ErrSchoolPartyNotFound = errors.New("organization tenancy: the school has no master data of this body")
	// ErrSchoolPartyKindUnknown reports a body that keeps no master data
	// per school.
	ErrSchoolPartyKindUnknown = errors.New("organization tenancy: only a Schulträger or a Gemeinde has master data of a school")
)

// SchoolPartyInput are the master data of a Schulträger or a Gemeinde as
// the Träger-Büro writes them. Name and address are required; the contact
// person is optional; the creditor identifier and the bank account are what
// billing needs, and a bank account always names its holder.
type SchoolPartyInput struct {
	Name          string
	Street        string
	PostalCode    string
	City          string
	ContactName   string
	ContactPhone  string
	ContactEmail  string
	CreditorID    string
	AccountHolder string
	IBAN          string
	BIC           string
	BankName      string
}

// SchoolParty are the stored master data of a Schulträger or a Gemeinde of
// one school.
type SchoolParty struct {
	ID            ident.ID        `json:"id"`
	SchoolID      ident.ID        `json:"school_id"`
	Kind          ResponsibleBody `json:"kind"`
	Name          string          `json:"name"`
	Street        string          `json:"street"`
	PostalCode    string          `json:"postal_code"`
	City          string          `json:"city"`
	ContactName   string          `json:"contact_name"`
	ContactPhone  string          `json:"contact_phone"`
	ContactEmail  string          `json:"contact_email"`
	CreditorID    string          `json:"creditor_id" contract_text:"SEPA creditor identifier of the body, a text the bank assigns"`
	AccountHolder string          `json:"account_holder"`
	IBAN          string          `json:"iban"`
	BIC           string          `json:"bic"`
	BankName      string          `json:"bank_name"`
	UpdatedAt     time.Time       `json:"updated_at"`
	// Version is the read state a save sends back (ADR 0311).
	Version string `json:"version"`
}

// TraegerSchoolName is a school of the Träger with its name.
type TraegerSchoolName struct {
	ID   int64
	Name string
}

// SchoolPartyVersion is the read-state token of a body's master data: its
// updated_at, which the row's trigger bumps on every update.
func SchoolPartyVersion(party SchoolParty) string { return readstate.Of(party.UpdatedAt) }

// SenderText is the body as a letter names its sender: the name, then the
// address, one line each, the shape of the Träger's letterhead text.
func (p SchoolParty) SenderText() string {
	return strings.Join([]string{p.Name, p.Street, strings.TrimSpace(p.PostalCode + " " + p.City)}, "\n")
}

// BillingReady reports whether the body can bill: it has a SEPA creditor
// identifier and a bank account.
func (p SchoolParty) BillingReady() bool { return p.CreditorID != "" && p.IBAN != "" }

// EffectiveBody is the body that is responsible in effect for area: the
// chosen one once its master data are stored, and for billing once it has a
// creditor identifier and a bank account; else the Träger.
func EffectiveBody(area ResponsibilityArea, chosen ResponsibleBody, parties map[ResponsibleBody]SchoolParty) ResponsibleBody {
	party, stored := parties[chosen]
	if !chosen.HasMasterData() || !stored {
		return BodyTraeger
	}
	if area == ResponsibilityBilling && !party.BillingReady() {
		return BodyTraeger
	}
	return chosen
}

// SchoolResponsibilityChoice is what the settings name for one area of one
// school, and where the value comes from.
type SchoolResponsibilityChoice struct {
	Body   ResponsibleBody
	Source ResponsibilitySource
}

// SchoolResponsibilitySettings reads the settings responsibility.* of
// several schools at once: per school the choice of every area. The root
// binds it to the Settings Platform, which resolves the school override
// above the Träger value above the default (ADR 0086). The caller holds a
// Träger transaction, which cannot read school settings, so the binding
// reads in a transaction of its own (ADR 0105). A school without an answer
// is an error, never the default.
type SchoolResponsibilitySettings interface {
	SchoolResponsibilityChoices(ctx context.Context, schoolIDs []int64) (map[int64]map[ResponsibilityArea]SchoolResponsibilityChoice, error)
}

// AreaResponsibility is one area of one school: the body the settings
// name, where that value comes from, and the body that is responsible in
// effect. Effective is the Träger while the named body has no master data
// (for billing: no creditor identifier or bank account).
type AreaResponsibility struct {
	Area      ResponsibilityArea   `json:"area"`
	Body      ResponsibleBody      `json:"body"`
	Source    ResponsibilitySource `json:"source"`
	Effective ResponsibleBody      `json:"effective"`
}

// SchoolResponsibility are the responsibilities of one school with the
// master data of its Schulträger and its Gemeinde, as far as stored.
type SchoolResponsibility struct {
	SchoolID   ident.ID             `json:"school_id"`
	SchoolName string               `json:"school_name"`
	Areas      []AreaResponsibility `json:"areas"`
	Parties    []SchoolParty        `json:"parties"`
}

// ResponsibilityOverview lists the schools of a Träger by name.
type ResponsibilityOverview struct {
	Schools []SchoolResponsibility `json:"schools"`
}

// SchoolResponsibilities lets the Träger-Büro see who is responsible at
// its schools and keep the master data of their Schulträger and Gemeinde.
// Every operation joins the caller's Träger transaction of organizationID;
// accountID is the acting account the master data log records. A refused
// input is validation.Errors by field.
type SchoolResponsibilities interface {
	// Overview reads every school of the Träger with its responsibilities
	// and the stored bodies, and logs the read: it shows bank accounts.
	Overview(ctx context.Context, organizationID, accountID int64) (ResponsibilityOverview, error)
	// SaveParty stores the master data of the school's Schulträger or
	// Gemeinde. An existing body that differs from expectedVersion, the
	// version it was read with, is readstate.ErrChanged (ADR 0311); a new
	// one takes the empty version.
	SaveParty(ctx context.Context, organizationID, accountID, schoolID int64, kind ResponsibleBody, input SchoolPartyInput, expectedVersion string) (SchoolParty, error)
	// RemoveParty deletes the master data of the body; the Träger is then
	// responsible wherever the settings name it.
	RemoveParty(ctx context.Context, organizationID, accountID, schoolID int64, kind ResponsibleBody) error
	ResponsibleParties
}

// ResponsibleParties names the body that is responsible in effect, for a
// document or a record of the Träger. It serves a rendering, not a person,
// so it needs no account and writes no log.
type ResponsibleParties interface {
	// ResponsibleParties returns per school the Schulträger or the
	// Gemeinde responsible for area. A school the Träger itself is
	// responsible for has no entry, and neither has a school that is none
	// of the Träger.
	ResponsibleParties(ctx context.Context, organizationID int64, area ResponsibilityArea, schoolIDs []int64) (map[int64]SchoolParty, error)
}
