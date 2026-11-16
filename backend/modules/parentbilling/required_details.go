package parentbilling

import "context"

// The details a Träger has to enter before its letters, notices and
// contracts go out (#7177). Each is required only while a school of the
// Träger books a module that needs it.
const (
	// RequiredLetterhead names the Träger as the sender of every letter and
	// gives the withdrawal notice of a contract its address.
	RequiredLetterhead = "letterhead"
	// RequiredBankAccount is the account the invoices ask to pay to.
	RequiredBankAccount = "bank_account"
	// RequiredSEPACreditor is the Gläubiger-ID of the direct debits.
	RequiredSEPACreditor = "sepa_creditor"
	// RequiredNumberRangeHoliday numbers the invoices of the holiday care.
	RequiredNumberRangeHoliday = "number_range_holiday"
	// RequiredNumberRangeCare numbers the invoices and notices of the
	// monthly care.
	RequiredNumberRangeCare = "number_range_care"
)

// RequiredDetails are the details the Träger still has to enter, in the
// order above. Missing is empty, never nil, when nothing is missing.
type RequiredDetails struct {
	Missing []string `json:"missing"`
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
// and whether the Träger has a bank account. None of them reads personal
// data.
type RequiredDetailSources struct {
	Schools  CareSchools
	Modules  SchoolModules
	Sender   TraegerSenderText
	Accounts TraegerBankAccounts
}

// RequiredDetailsCheck names the details the Träger of the caller's Träger
// transaction still has to enter (#7177).
type RequiredDetailsCheck interface {
	RequiredDetails(ctx context.Context, organizationID int64) (RequiredDetails, error)
}
