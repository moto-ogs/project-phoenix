package workforce

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The Personalstamm of ADR 0089 (#4705): one record per person the Träger
// employs, over all its schools. The record keeps the Träger's personnel
// number and the bank and tax values; the schools keep their persons,
// employments and everything of the day. A record exists only for a Träger
// the moto team released for „Personal beim Träger“.

// The two statements a Träger confirms before the release (ADR 0089
// section 2, decided on 13.11.2026 in #4705): an agreement with the works
// council or the church employee representation on time recording and
// planning across sites, or no such representation.
const (
	TraegerStaffRepresentationAgreement = "agreement"
	TraegerStaffRepresentationNone      = "none"
)

// The fields of a record. A link chooses each of them from one source.
const (
	TraegerStaffFieldFirstName            = "first_name"
	TraegerStaffFieldLastName             = "last_name"
	TraegerStaffFieldBirthday             = "birthday"
	TraegerStaffFieldPersonnelNumber      = "personnel_number"
	TraegerStaffFieldIBAN                 = "iban"
	TraegerStaffFieldTaxID                = "tax_id"
	TraegerStaffFieldSocialSecurityNumber = "social_security_number"
)

// TraegerStaffSourceRecord names the record's own value as the source of a
// field when employments join an existing record. Every other source is the
// decimal ID of the school whose employment brings the value.
const TraegerStaffSourceRecord = "record"

// Why moto suggests employments for one record (ADR 0089 section 5), in
// the order it tries them. A single employment without a match is offered
// on its own.
const (
	TraegerStaffMatchAccount         = "same_account"
	TraegerStaffMatchPersonnelNumber = "same_personnel_number"
	TraegerStaffMatchNameBirthday    = "same_name_birthday"
	TraegerStaffMatchNone            = "single"
)

// The kinds of a trail entry.
const (
	TraegerStaffChangeLinked    = "linked"
	TraegerStaffChangeNotChosen = "not_chosen"
	TraegerStaffChangeChanged   = "changed"
	// TraegerStaffChangeRemoved is a value the Personalverwaltung emptied,
	// such as a birthday (#7379); the entry keeps the value before.
	TraegerStaffChangeRemoved = "removed"
)

// The access log views of the Träger-Portal on staff data (ADR 0084
// section 7, ADR 0089 section 6); the overview export is the download of
// the records list as PDF, Excel or CSV (#4718).
const (
	TraegerStaffViewOverview        = "staff_overview"
	TraegerStaffViewOverviewExport  = "staff_overview_export"
	TraegerStaffViewRecord          = "staff_record"
	TraegerStaffViewLinkPreview     = "staff_link_preview"
	TraegerStaffViewFinancial       = "staff_financial_view"
	TraegerStaffViewFinancialReveal = "staff_financial_reveal"
)

var (
	// ErrTraegerStaffNotReleased refuses a Personalstamm of a Träger the moto
	// team has not released for „Personal beim Träger“.
	ErrTraegerStaffNotReleased = errors.New("workforce: personal beim träger is not released")
	// ErrTraegerStaffReleaseInvalid refuses a release without one of the two
	// statements.
	ErrTraegerStaffReleaseInvalid = errors.New("workforce: the release needs one of the two statements")
	// ErrTraegerStaffReleaseExists refuses a second release.
	ErrTraegerStaffReleaseExists = errors.New("workforce: the Träger is already released")
	// ErrTraegerStaffReleaseInUse refuses a withdrawal while the Träger keeps
	// records; the Personalverwaltung dissolves them first.
	ErrTraegerStaffReleaseInUse = errors.New("workforce: the Träger still keeps staff records")
	// ErrTraegerStaffReleaseNotFound answers a withdrawal without a release.
	ErrTraegerStaffReleaseNotFound = errors.New("workforce: the Träger is not released")
	// ErrTraegerStaffRecordNotFound answers an unknown or foreign record.
	ErrTraegerStaffRecordNotFound = errors.New("workforce: staff record not found")
	// ErrTraegerStaffLinkInvalid refuses a link; TraegerStaffLinkError names
	// the field.
	ErrTraegerStaffLinkInvalid = errors.New("workforce: the link is invalid")
	// ErrTraegerStaffAlreadyLinked refuses an employment that already
	// belongs to a record, or a second employment of one school.
	ErrTraegerStaffAlreadyLinked = errors.New("workforce: the employment already belongs to a staff record")
	// ErrStaffKeptByTraeger refuses a school's change of a value its Träger
	// keeps in the Personalstamm: the personnel number and the bank and tax
	// values (ADR 0089 section 6).
	ErrStaffKeptByTraeger = errors.New("workforce: the Träger keeps this value in its staff record")
)

// TraegerStaffLinkError names the part of a link request that is invalid.
type TraegerStaffLinkError struct {
	Field  string
	Reason string
}

func (e *TraegerStaffLinkError) Error() string {
	return fmt.Sprintf("workforce: link %s: %s", e.Field, e.Reason)
}

func (e *TraegerStaffLinkError) Unwrap() error { return ErrTraegerStaffLinkInvalid }

// TraegerStaffRelease is the release „Personal beim Träger“ of one Träger.
type TraegerStaffRelease struct {
	Representation       string    `json:"representation"`
	ReleasedAt           time.Time `json:"released_at"`
	ReleasedByOperatorID int64     `json:"-"`
}

// TraegerStaffReleaseState is what the moto team sees of a Träger: the
// release, nil without one, and how many records the Träger keeps.
type TraegerStaffReleaseState struct {
	Release *TraegerStaffRelease `json:"release"`
	Records int                  `json:"records"`
}

// TraegerStaffActor is the session of the Träger-Büro that reads or writes.
type TraegerStaffActor struct {
	OrganizationID int64
	AccountID      int64
}

// TraegerStaffSchool is one school of the Träger.
type TraegerStaffSchool struct {
	ID   ident.ID `json:"id"`
	Name string   `json:"name"`
}

// TraegerSchoolStaffMember is one live employment of a school with its
// person, read in that school's tenant transaction. Birthday is a calendar
// day (YYYY-MM-DD) or empty.
type TraegerSchoolStaffMember struct {
	StaffID         int64
	PersonID        int64
	AccountID       *int64
	FirstName       string
	LastName        string
	Birthday        string
	PersonnelNumber *string
}

// TraegerStaffEmployment is one Einsatzort of a record: the employment of
// one school. Active is false once the school ended the employment.
// ViaPool marks an Einsatzort a block of the Vertretungspool created: it
// ends after the school's last block and resumes with the next (ADR 0253).
type TraegerStaffEmployment struct {
	SchoolID   ident.ID `json:"school_id"`
	SchoolName string   `json:"school_name"`
	StaffID    ident.ID `json:"staff_id"`
	Active     bool     `json:"active"`
	ViaPool    bool     `json:"via_pool"`
	// EmployerName names the Schulträger or the Gemeinde that employs the
	// staff of this school in place of the Träger (#4811); empty where the
	// Träger is the employer, as for every Einsatzort of the Vertretungspool.
	// Only the view of one record carries it.
	EmployerName string `json:"employer_name"`
}

// TraegerStaffRecordSummary is one record in the list.
type TraegerStaffRecordSummary struct {
	ID              ident.ID                 `json:"id"`
	FirstName       string                   `json:"first_name"`
	LastName        string                   `json:"last_name"`
	Birthday        string                   `json:"birthday,omitempty"`
	PersonnelNumber *string                  `json:"personnel_number"`
	HasFinancial    bool                     `json:"has_financial"`
	Employments     []TraegerStaffEmployment `json:"employments"`
}

// TraegerStaffCandidate is a live employment no record holds yet.
type TraegerStaffCandidate struct {
	SchoolID        ident.ID `json:"school_id"`
	SchoolName      string   `json:"school_name"`
	StaffID         ident.ID `json:"staff_id"`
	FirstName       string   `json:"first_name"`
	LastName        string   `json:"last_name"`
	Birthday        string   `json:"birthday,omitempty"`
	PersonnelNumber *string  `json:"personnel_number"`
	HasAccount      bool     `json:"has_account"`
}

// TraegerStaffSuggestion is one proposal: employments that may be one
// person, or employments that may join the existing record RecordID. The
// Personalverwaltung confirms every proposal; nothing joins by itself.
type TraegerStaffSuggestion struct {
	Reason   string                  `json:"reason"`
	RecordID *ident.ID               `json:"staff_record_id,omitempty"`
	Members  []TraegerStaffCandidate `json:"members"`
}

// TraegerStaffOverview is the Personalstamm of a Träger: the release, its
// schools, its records and the open proposals.
type TraegerStaffOverview struct {
	Release     *TraegerStaffRelease        `json:"release"`
	Schools     []TraegerStaffSchool        `json:"schools"`
	Records     []TraegerStaffRecordSummary `json:"records"`
	Suggestions []TraegerStaffSuggestion    `json:"suggestions"`
}

// TraegerStaffMemberRef names one employment of one school.
type TraegerStaffMemberRef struct {
	SchoolID ident.ID `json:"school_id"`
	StaffID  ident.ID `json:"staff_id"`
}

// TraegerStaffLinkRequest joins employments to a new record or, with
// RecordID, to an existing one. Choices names the source of every field
// whose sources disagree: TraegerStaffSourceRecord or a school's ID.
type TraegerStaffLinkRequest struct {
	RecordID *int64
	Members  []TraegerStaffMemberRef
	Choices  map[string]string
	// ExpectedFingerprint is the Fingerprint of the preview the choices were
	// made on (ADR 0311); the link refuses values changed since.
	ExpectedFingerprint string
}

// TraegerStaffFieldOption is one value a source brings for a field. Bank
// and tax values show only their mask.
type TraegerStaffFieldOption struct {
	Source     string `json:"source"`
	SchoolName string `json:"school_name,omitempty"`
	Value      string `json:"value"`
}

// TraegerStaffFieldPreview lists the different values of one field.
// Conflict is true when more than one value exists and a choice is needed.
type TraegerStaffFieldPreview struct {
	Field    string                    `json:"field"`
	Options  []TraegerStaffFieldOption `json:"options"`
	Conflict bool                      `json:"conflict"`
}

// TraegerStaffLinkPreview shows what a link would bring together before
// the Personalverwaltung confirms it.
type TraegerStaffLinkPreview struct {
	Record  *TraegerStaffRecordSummary `json:"record,omitempty"`
	Members []TraegerStaffCandidate    `json:"members"`
	Fields  []TraegerStaffFieldPreview `json:"fields"`
	// Fingerprint is the token of every value the preview compares; the
	// link sends it back as expected_fingerprint (ADR 0311).
	Fingerprint string `json:"fingerprint"`
}

// TraegerStaffFinancial is the bank and tax section of a record, masked or,
// after an explicit reveal, as entered.
type TraegerStaffFinancial struct {
	IBAN                 *string `json:"iban"`
	TaxID                *string `json:"tax_id" contract_text:"statutory tax identifier"`
	SocialSecurityNumber *string `json:"social_security_number"`
	// Version is the section's token over its sealed values (ADR 0311);
	// a save of the section sends it back.
	Version string `json:"version"`
}

// TraegerStaffChange is one entry of a record's trail. Value is the value
// as text; bank and tax values show only their mask.
type TraegerStaffChange struct {
	Kind       string    `json:"kind"`
	Field      string    `json:"field"`
	Value      string    `json:"value"`
	SchoolID   *ident.ID `json:"school_id,omitempty"`
	SchoolName string    `json:"school_name,omitempty"`
	OccurredAt time.Time `json:"occurred_at"`
}

// TraegerStaffRecordDetail is one record with its masked bank and tax
// section, its trail and its proofs.
type TraegerStaffRecordDetail struct {
	TraegerStaffRecordSummary
	// PersonVersion is the token of name and birthday (ADR 0311); a
	// correction of the person sends it back.
	PersonVersion string                `json:"person_version"`
	Financial     TraegerStaffFinancial `json:"financial"`
	Changes       []TraegerStaffChange  `json:"changes"`
	// Proofs is the state of every live kind of the Träger at the record
	// (#4707).
	Proofs []TraegerStaffProof `json:"proofs"`
	// Contracts are the Arbeitsverträge of the record (#4706), newest first.
	Contracts []TraegerStaffContract `json:"contracts"`
	// UnsyncedSchools names the Einsatzorte a contract change was saved for
	// but could not reach yet; the next change of the record brings them up
	// to date (ADR 0237 section 4). Empty after every complete write.
	UnsyncedSchools []string `json:"unsynced_schools,omitempty"`
	// HeldBankSchools names the schools whose bank values changed between a
	// link's read and its hand-over: the record keeps the values the link
	// read, the school keeps its new row, and the Personalverwaltung checks
	// the bank section (ADR 0311). Only a link answers it.
	HeldBankSchools []string `json:"held_bank_schools,omitempty"`
}

// TraegerStaffPerson is the person of a record as the Personalverwaltung
// corrects it (#7379). Birthday is a calendar day as YYYY-MM-DD, nil or empty
// for none.
type TraegerStaffPerson struct {
	FirstName string
	LastName  string
	Birthday  *string
	// ExpectedVersion is the PersonVersion the form opened on; a person
	// changed since is refused (readstate.ErrChanged).
	ExpectedVersion string
}

// TraegerStaffPersonError names the refused field of a person correction;
// it is a refused master data value (ErrStaffStammdatenInvalid).
type TraegerStaffPersonError struct {
	Field string
	Cause error
}

func (e *TraegerStaffPersonError) Error() string {
	return fmt.Sprintf("workforce: person %s: %v", e.Field, e.Cause)
}

func (e *TraegerStaffPersonError) Unwrap() error { return ErrStaffStammdatenInvalid }

// TraegerStaffRecords is the Personalstamm in the Träger-Portal. Every
// method checks the release; the route checks the right „Personal“. Each
// read of personal data writes an access log entry in the tenant of every
// school whose data it shows (ADR 0084 section 7).
type TraegerStaffRecords interface {
	// Overview lists the records and the proposals; view names the access
	// entry, the page or its export.
	Overview(ctx context.Context, actor TraegerStaffActor, view string) (TraegerStaffOverview, error)
	Record(ctx context.Context, actor TraegerStaffActor, recordID int64) (TraegerStaffRecordDetail, error)
	PreviewLink(ctx context.Context, actor TraegerStaffActor, request TraegerStaffLinkRequest) (TraegerStaffLinkPreview, error)
	Link(ctx context.Context, actor TraegerStaffActor, request TraegerStaffLinkRequest) (TraegerStaffRecordDetail, error)
	UpdatePersonnelNumber(ctx context.Context, actor TraegerStaffActor, recordID int64, value *string) (TraegerStaffRecordDetail, error)
	// UpdatePerson corrects name and birthday of the record (#7379); the
	// schools keep their own person rows. It answers no record: a reader
	// loads it again, which writes the read into the access log.
	UpdatePerson(ctx context.Context, actor TraegerStaffActor, recordID int64, person TraegerStaffPerson) error
	Financial(ctx context.Context, actor TraegerStaffActor, recordID int64, reveal bool) (TraegerStaffFinancial, error)
	UpdateFinancial(ctx context.Context, actor TraegerStaffActor, recordID int64, input StammdatenFinancialInput) error
	Dissolve(ctx context.Context, actor TraegerStaffActor, recordID int64) error
}

// TraegerStaffReleases is the release in the Operator portal. Each call
// joins the caller's administrative transaction, which holds the operator
// audit entry of a change.
type TraegerStaffReleases interface {
	ReleaseState(ctx context.Context, organizationID int64) (TraegerStaffReleaseState, error)
	GrantRelease(ctx context.Context, organizationID, operatorID int64, representation string) (TraegerStaffRelease, error)
	WithdrawRelease(ctx context.Context, organizationID int64) error
}

// TraegerStaffSchools lists the live schools of a Träger.
type TraegerStaffSchools interface {
	TraegerSchools(ctx context.Context, organizationID int64) ([]TraegerStaffSchool, error)
}

// TraegerStaffEmployers names per school the body that employs its staff
// when that is not the Träger (#4811): the school's Schulträger or Gemeinde
// as the responsibility "Personal" names it, in the caller's Träger
// transaction. A school whose staff the Träger employs has no entry. The
// roots bind it to the responsibilities of Organisation & Tenancy.
type TraegerStaffEmployers interface {
	SchoolEmployers(ctx context.Context, organizationID int64, schoolIDs []int64) (map[int64]string, error)
}

// TraegerSchoolEmployment is one live employment of a school as School
// Membership keeps it, with the personnel number of its profile.
type TraegerSchoolEmployment struct {
	StaffID         int64
	PersonID        int64
	PersonnelNumber *string
}

// TraegerSchoolEmployments reads the live employments of the school of the
// caller's tenant transaction, staff of the Träger only (no external
// caregivers); staffIDs narrows the read, nil reads all.
type TraegerSchoolEmployments interface {
	SchoolEmployments(ctx context.Context, staffIDs []int64) ([]TraegerSchoolEmployment, error)
}

// TraegerSchoolPerson is the person behind an employment.
type TraegerSchoolPerson struct {
	PersonID  int64
	AccountID *int64
	FirstName string
	LastName  string
	Birthday  string
}

// TraegerSchoolPersons reads persons of the school of the caller's tenant
// transaction by ID.
type TraegerSchoolPersons interface {
	SchoolPersons(ctx context.Context, personIDs []int64) ([]TraegerSchoolPerson, error)
}

// TraegerStaffAccess is one access log entry of the Träger-Portal in the
// tenant of one school: which view showed how many of its people.
type TraegerStaffAccess struct {
	OrganizationID int64
	AccountID      int64
	View           string
	Rows           int
	// StaffIDs names the employments of the school the view showed;
	// RecordID the record a record view read, 0 for the overview.
	StaffIDs []int64
	RecordID int64
	// RecordIDs names the records a pool view showed (#4709).
	RecordIDs []int64
}

// TraegerStaffAccessLog writes an access entry in the caller's tenant
// transaction. A failed entry fails the read.
type TraegerStaffAccessLog interface {
	RecordTraegerStaffAccess(ctx context.Context, access TraegerStaffAccess) error
}

// TraegerStaffRuntime opens a school's tenant transaction or the Träger
// transaction, never both at once (ADR 0105).
type TraegerStaffRuntime interface {
	WithinSchool(ctx context.Context, schoolID int64, fn func(context.Context) error) error
	WithinTraeger(ctx context.Context, organizationID int64, fn func(context.Context) error) error
}

// TraegerStaffActorNames names the people of the Träger-Büro (#4724): the
// name each account carries at the Träger, in the caller's Träger
// transaction, one read for the set; an account without a name is missing.
type TraegerStaffActorNames interface {
	TraegerActorNames(ctx context.Context, organizationID int64, accountIDs []int64) (map[int64]string, error)
}

// TraegerStaffPorts are the collaborators the Personalstamm does not own.
type TraegerStaffPorts struct {
	Schools     TraegerStaffSchools
	Employments TraegerSchoolEmployments
	Persons     TraegerSchoolPersons
	Access      TraegerStaffAccessLog
	Runtime     TraegerStaffRuntime
	Names       TraegerStaffActorNames
	// Months is the school's month of an employment for the Stundenkonto
	// (#4711).
	Months TraegerStaffMonths
	// Springers employs a Springer at the school that blocks them (#7173).
	Springers SpringerEmployments
	// Exports are the school's months and days for the payroll file and the
	// time export, Payroll the Träger's payroll values (#4712); nil outside
	// the exports.
	Exports TraegerStaffExportSchool
	Payroll TraegerPayrollSettingsReader
	// HirePersons and HireEmployments create the person and the employment
	// of a hired person at a school (#7206); nil outside the records.
	HirePersons     TraegerHirePersons
	HireEmployments TraegerHireEmployments
	// Emails finds a school's accounts and invitations of an address, for
	// the check of a hire (#7378); nil outside the records.
	Emails TraegerSchoolEmails
	// Employers names the employer at each Einsatzort of a record (#4811);
	// nil where the Träger employs everywhere.
	Employers TraegerStaffEmployers
}
