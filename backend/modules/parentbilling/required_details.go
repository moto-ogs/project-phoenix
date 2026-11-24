package parentbilling

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// RequiredDetail names a detail a Träger has to enter before its letters,
// notices and contracts go out (#7177). Each is required only while a
// school of the Träger books a module that needs it.
type RequiredDetail string

const (
	// RequiredLetterhead names the Träger as the sender of every letter and
	// gives the withdrawal notice of a contract its address.
	RequiredLetterhead RequiredDetail = "letterhead"
	// RequiredBankAccount is the account the invoices ask to pay to.
	RequiredBankAccount RequiredDetail = "bank_account"
	// RequiredSEPACreditor is the Gläubiger-ID of the direct debits.
	RequiredSEPACreditor RequiredDetail = "sepa_creditor"
	// RequiredNumberRangeHoliday numbers the invoices of the holiday care.
	RequiredNumberRangeHoliday RequiredDetail = "number_range_holiday"
	// RequiredNumberRangeCare numbers the invoices and notices of the
	// monthly care.
	RequiredNumberRangeCare RequiredDetail = "number_range_care"
)

// RequiredDetails are the details the Träger still has to enter, in the
// order above. Missing is empty, never nil, when nothing is missing.
type RequiredDetails struct {
	Missing []RequiredDetail `json:"missing"`
}

// TraegerModules says which of the modules that need required details at
// least one school of the Träger books.
type TraegerModules struct {
	Contracts   bool
	CareBilling bool
	HolidayCare bool
}

// SchoolModules reads which of these modules the schools book.
type SchoolModules interface {
	BookedModules(ctx context.Context, schoolIDs []int64) (TraegerModules, error)
}

// TraegerSenderText reads the letterhead text of the Träger; its first line
// names the Träger.
type TraegerSenderText interface {
	SenderText(ctx context.Context, organizationID int64) (string, error)
}

// TraegerBankAccounts tells whether the Träger has a bank account, without
// reading it.
type TraegerBankAccounts interface {
	HasBankAccount(ctx context.Context, organizationID int64) (bool, error)
}

// RequiredDetailSources are the reads the root binds, each to one owner:
// the schools of the Träger, their module switches, the letterhead text
// and whether the Träger has a bank account; the issuers of the schools
// with the template of the fee notice and the contracts in force, which the
// state of each issuer counts (#8040). None of them hands out personal data.
type RequiredDetailSources struct {
	Schools   CareSchools
	Modules   SchoolModules
	Sender    TraegerSenderText
	Accounts  TraegerBankAccounts
	Issuers   BillingDocumentTemplates
	Contracts CareContracts
}

// BillingIssuerStatus is what a Schulträger or a Gemeinde that bills a
// school of the Träger needs before its documents go out (#8040, ADR 0322
// point 11): its number range per service, the kind of document per
// service and whether a fee notice lacks its legal remedy, and how many
// families pay by direct debit at its schools and how many of them have no
// mandate for its creditor identifier yet, counted for the monthly care.
// It names no person.
type BillingIssuerStatus struct {
	Issuer                 BillingIssuer         `json:"issuer"`
	SchoolIDs              []ident.ID            `json:"school_ids"`
	NumberRanges           []IssuerNumberRange   `json:"number_ranges"`
	DocumentKinds          []ServiceDocumentKind `json:"document_kinds"`
	LegalRemedyMissing     bool                  `json:"legal_remedy_missing"`
	DirectDebitFamilies    int                   `json:"direct_debit_families"`
	FamiliesWithoutMandate int                   `json:"families_without_mandate"`
	// CreditorIsTraegers: the body names the Träger's own creditor
	// identifier; no release goes out until it has its own (ADR 0322
	// point 10).
	CreditorIsTraegers bool `json:"creditor_is_traegers"`
}

// IssuerNumberRange is the pattern of a service of an issuer, empty while
// none is set.
type IssuerNumberRange struct {
	Service string `json:"service"`
	Pattern string `json:"pattern"`
}

// BillingIssuerOverview lists every body that bills a school of the Träger.
type BillingIssuerOverview struct {
	Issuers []BillingIssuerStatus `json:"issuers"`
}

// RequiredDetailsCheck names the details the Träger of the caller's Träger
// transaction still has to enter (#7177), and what each body that bills
// one of its schools still needs (#8040).
type RequiredDetailsCheck interface {
	RequiredDetails(ctx context.Context, organizationID int64) (RequiredDetails, error)
	BillingIssuerStatuses(ctx context.Context, organizationID int64) (BillingIssuerOverview, error)
}
