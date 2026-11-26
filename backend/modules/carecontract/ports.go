package carecontract

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The ports of the Betreuungsvertrag. The root binds each one; none names
// another owner's types.

type School struct {
	ID   int64
	Name string
}

// TraegerSchools lists the schools of a Träger. It opens its own unit and
// must be called outside any transaction.
type TraegerSchools interface {
	TraegerSchools(ctx context.Context, organizationID int64) ([]School, error)
}

// Booking is an approved booking of an offering by an application child.
type Booking struct {
	CareOfferingID int64
	Days           []string
	ValidFrom      *calendar.Date
	ValidUntil     *calendar.Date
}

// ParentRequest is a request of the parents to change their child's care
// that the school or the Träger-Büro approved (Care Plan's offering change,
// #4816): who sent it and when, the day the approval applied it from, and
// the modules with their weekdays the parents asked for from that day. A
// module the request does not name is one the parents no longer want.
type ParentRequest struct {
	ID            int64
	AccountID     int64
	SubmittedAt   time.Time
	EffectiveFrom calendar.Date
	Offerings     []RequestedOffering
}

// RequestedOffering is one module of a ParentRequest with its weekdays
// ("mon" to "sun").
type RequestedOffering struct {
	CareOfferingID int64
	Days           []string
}

// SchoolParentRequests reads the approved requests of the parents for the
// application children, in the tenant transaction of the school the caller
// holds (Care Plan). A request the parents sent themselves proves their
// agreement to the version it made (#4816, ADR 0088 section 3); without the
// port every changed version waits for a signature.
type SchoolParentRequests interface {
	ApprovedParentRequests(ctx context.Context, requestChildIDs []int64) (map[int64][]ParentRequest, error)
}

// Application is an accepted application child of one school, with its
// guardian and its bookings.
type Application struct {
	AcceptedAt        *time.Time
	Acceptances       []AcceptedText
	RequestChildID    int64
	StudentID         *int64
	ChildFirstName    string
	ChildLastName     string
	ChildBirthDate    *calendar.Date
	GuardianFirstName string
	GuardianLastName  string
	GuardianEmail     string
	GuardianAccountID *int64
	PhaseName         string
	ServiceStartDate  *calendar.Date
	ActivateOn        *calendar.Date
	Bookings          []Booking
	// ParentRequests are the approved requests of the parents to change the
	// child's care (#4816); the intake fills them in with the bookings.
	ParentRequests []ParentRequest
	// FamilyChildren is the number of children the parents stated on the
	// registration (#6335); nil when they stated none.
	FamilyChildren *FamilyStatement
	// Renewal tells that the application renews care into a new phase, whose
	// conditions the parents accept on their own (#6456).
	Renewal bool
	// ContractImport tells that the school made the application for the
	// child of an imported contract (the source contract_import, ADR 0309):
	// no parent submitted it.
	ContractImport bool
	// ImportContractID is the imported contract such an application was
	// made for, as the school stored it with the application; 0 for any
	// other application.
	ImportContractID int64
}

// Offering is a care offering of one school. A contract books it as a
// module: on each weekday the child ends at the offering's end time of that
// day ("HH:MM", the Gehzeit), if the offering has one.
type Offering struct {
	ID             int64
	PhaseID        int64
	Name           string
	PhaseName      string
	PriceCents     *int
	Active         bool
	EndTimes       map[string]string
	DaysOfWeekMode string
	AvailableDays  []string
	// ServiceStart and ServiceEnd are the inclusive bounds of the offering phase.
	ServiceStart *calendar.Date
	ServiceEnd   *calendar.Date
}

// SchoolAccess is one read of personal data of a school by the Träger-Büro,
// for the access log of that school (ADR 0084 section 7).
type SchoolAccess struct {
	OrganizationID int64
	AccountID      int64
	// Data names what was read: SchoolAccessApplications,
	// SchoolAccessContracts or SchoolAccessOverruns.
	Data string
	View string
	Rows int
	// ContractIDs are the contracts at this school a contract read showed.
	ContractIDs []int64
	// StudentIDs are the children an overrun read showed by name (#4683),
	// over the window from RangeStart to RangeEnd, and the child records a
	// link of imported contracts showed (#7760).
	StudentIDs []int64
	RangeStart calendar.Date
	RangeEnd   calendar.Date
}

const (
	// SchoolAccessApplications is a read of the school's accepted
	// applications to create contracts.
	SchoolAccessApplications = "applications"
	// SchoolAccessContracts is a read of the care contracts whose place of
	// care is the school: the list, a detail or a PDF (ADR 0088 section 7).
	SchoolAccessContracts = "contracts"
)

// SchoolApplications reads the accepted applications of the school whose
// tenant transaction the caller holds (Enrollment).
type SchoolApplications interface {
	// AcceptedApplications lists the accepted application children without
	// their bookings; a non-empty requestChildIDs keeps only those.
	AcceptedApplications(ctx context.Context, requestChildIDs []int64) ([]Application, error)
	// NamePhases fills in the name and service window of each offering's enrollment phase.
	NamePhases(ctx context.Context, offerings []Offering) ([]Offering, error)
}

// StudentApplications reads, of the school whose tenant transaction the
// caller holds, the accepted applications of named child records
// (Enrollment): what the plan of imported contracts needs (ADR 0309).
type StudentApplications interface {
	// AcceptedStudentApplications lists the accepted application children
	// of the child records and of no other, without their bookings and
	// without the guardians of the application: the application child, its
	// child record and where the application comes from (ContractImport,
	// ImportContractID). None for no child record.
	AcceptedStudentApplications(ctx context.Context, studentIDs []int64) ([]Application, error)
	// NamePhases fills in the name and service window of each offering's enrollment phase.
	NamePhases(ctx context.Context, offerings []Offering) ([]Offering, error)
}

// SchoolBookings reads the bookings and the offerings of the school whose
// tenant transaction the caller holds (Care Plan).
type SchoolBookings interface {
	Bookings(ctx context.Context, requestChildIDs []int64) (map[int64][]Booking, error)
	// Offerings lists the school's offerings; a non-empty ids keeps only
	// those.
	Offerings(ctx context.Context, ids []int64) ([]Offering, error)
}

// SchoolAccessLog appends a read to the access log of the school whose
// tenant transaction the caller holds (ADR 0084 section 7).
type SchoolAccessLog interface {
	RecordAccess(ctx context.Context, access SchoolAccess) error
}

// Runtime opens the transactions the intake uses one after the other.
type Runtime interface {
	WithinSchool(ctx context.Context, schoolID int64, fn func(context.Context) error) error
	WithinTraeger(ctx context.Context, organizationID int64, fn func(context.Context) error) error
}

// LetterTemplate is the Träger's current template of the contract letter.
type LetterTemplate struct {
	Version    int
	Subject    string
	Salutation string
	Body       string
	Closing    string
}

// Letterhead is the master data and branding of the Träger as the contract
// prints it.
type Letterhead struct {
	AccentColor  string
	Logo         []byte
	SenderText   string
	FooterText   string
	ContactName  string
	ContactPhone string
	ContactEmail string
	// WithdrawalPhone and WithdrawalEmail are the Träger's own for
	// withdrawals (#6200); empty takes the contact person's.
	WithdrawalPhone string
	WithdrawalEmail string
	Template        LetterTemplate
}

// Reach is what the withdrawal notice names of the letterhead's phone and
// e-mail.
func (h Letterhead) Reach() WithdrawalReach {
	return WithdrawalReach{
		ContactPhone: h.ContactPhone, ContactEmail: h.ContactEmail,
		WithdrawalPhone: h.WithdrawalPhone, WithdrawalEmail: h.WithdrawalEmail,
	}
}

// Issuer is the body that concludes the contracts of a school in place of
// the Träger (#4811): the school's Schulträger or Gemeinde, as its contract
// names it. SenderText is its name and its address, one line each, the
// shape of the Träger's letterhead text.
type Issuer struct {
	SenderText   string `json:"sender_text"`
	ContactName  string `json:"contact_name"`
	ContactPhone string `json:"contact_phone"`
	ContactEmail string `json:"contact_email"`
}

// Letterhead is the Träger's letterhead as the issuer signs with it: its
// own name, address and contact person. The colour and the template stay;
// the Träger's logo and footer do not stand on another body's letter.
func (i Issuer) Letterhead(head Letterhead) Letterhead {
	head.SenderText, head.FooterText, head.Logo = i.SenderText, "", nil
	head.ContactName, head.ContactPhone, head.ContactEmail = i.ContactName, i.ContactPhone, i.ContactEmail
	head.WithdrawalPhone, head.WithdrawalEmail = "", ""
	return head
}

// Reach is where the withdrawal notice says parents reach the issuer.
func (i Issuer) Reach() WithdrawalReach {
	return WithdrawalReach{ContactPhone: i.ContactPhone, ContactEmail: i.ContactEmail}
}

// SchoolIssuers names per school the body that concludes its contracts
// when that is not the Träger (#4811), in the caller's Träger transaction.
// A school the Träger itself concludes for has no entry. The roots bind it
// to the responsibilities of Organisation & Tenancy.
type SchoolIssuers interface {
	SchoolIssuers(ctx context.Context, organizationID int64, schoolIDs []int64) (map[int64]Issuer, error)
}

// Letterheads reads the letterhead in the Träger transaction of the
// reviewer.
type Letterheads interface {
	Letterhead(ctx context.Context, reviewer Reviewer) (Letterhead, error)
}

type MailState struct {
	OutboxID int64
	State    string
	// Outcome is what Delivery knows about the mail, in its words.
	Outcome string
}

// MailBlocks reads, in the caller's Träger transaction, why a first contract
// mail to each address would stay back now, in one read (#4680). The key is
// the address as given; an address that would be sent has no key.
type MailBlocks interface {
	ContractMailBlocks(ctx context.Context, organizationID int64, addresses []string) (map[string]string, error)
}

// Post enqueues the mail of a contract in the caller's Träger transaction
// and reads the state of its mails.
type Post interface {
	EnqueueContractMail(ctx context.Context, mail ContractMail) (int64, error)
	// ContractMailBlock says why a mail to the address would stay back now, or
	// nothing. Outcome is the last mail's to this address, if there was one: only a
	// mail that left a block at the provider makes the provider worth asking.
	ContractMailBlock(ctx context.Context, organizationID int64, address, outcome string) (string, error)
	// ShareMailBlockLimit makes the provider's limits count once for everything that
	// uses the returned context, so one request cannot wait once per contract.
	ShareMailBlockLimit(ctx context.Context) context.Context
	ContractMailStates(ctx context.Context, organizationID, contractID int64) ([]MailState, error)
}

// AcceptedText is Enrollment's checked evidence of a parent's agreement to
// the exact terms shown before the school's acceptance.
type AcceptedText struct {
	Key         string
	Text        string
	SHA256      string
	SubmittedAt time.Time
	// Required tells that the form demanded the tick: only a required block
	// proves the conditions; an optional one records a wish (#4682).
	Required bool
}

// SchoolHolidays reads the statutory public holidays of each school's
// federal state in [from, to], the days § 193 BGB moves the last day of a
// withdrawal period past (#6350). School Calendar computes them; the
// federal state is a setting of the school, so the binding reads it outside
// the caller's Träger transaction (ADR 0175). Every school asked has an
// entry; an unknown or unreadable federal state is an error, never an empty
// set: a period shown too short must not pass as safe.
type SchoolHolidays interface {
	SchoolHolidayDates(ctx context.Context, schoolIDs []int64, from, to calendar.Date) (map[int64]map[calendar.Date]bool, error)
}
