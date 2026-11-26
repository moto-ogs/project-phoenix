// Package carecontract is the public capability of the Betreuungsvertrag
// (care-contract, ADR 0088, ADR 0153, #4678). The Träger-Büro keeps a
// contract template for every care offering of its schools, creates one
// contract from the accepted application of a child (Weg a: the draft is
// sent afterwards) over every module the child books, per weekday and sends it to the parents by mail and into the inbox of
// the parents portal. Contracts, versions and their trail live at the Träger,
// in tables with organization_id and the Träger policy (ADR 0086 section 5).
//
// The owner imports no other domain owner. The root binds its ports: the
// accepted applications and the offerings of a school (Enrollment and Care
// Plan, read in that school's tenant transaction), the schools of the Träger,
// the letterhead and the template of the contract letter (Organisation &
// Tenancy, Settings), and Delivery's outbox.
package carecontract

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The states of a contract (ADR 0088 section 2). The Träger-Büro reaches
// StatusDraft and StatusSent; the conclusion (conclusion.go: at the
// acceptance, #4680, or with the signature, #4679) reaches StatusActive;
// a withdrawal or termination (#4682, notice.go) moves it further.
const (
	StatusDraft      = "entwurf"
	StatusSent       = "versendet"
	StatusActive     = "aktiv"
	StatusTerminated = "gekuendigt"
	StatusWithdrawn  = "widerrufen"
	StatusEnded      = "beendet"
)

// JoinNames lists names as the contract and its mails write them: "A, B und C".
func JoinNames(names []string) string {
	if len(names) <= 1 {
		return strings.Join(names, "")
	}
	return strings.Join(names[:len(names)-1], ", ") + " und " + names[len(names)-1]
}

// The states of a version (ADR 0088 section 2). A draft's version waits as
// VersionRequested until a later step makes it effective.
const (
	VersionRequested  = "beantragt"
	VersionEffective  = "wirksam"
	VersionSuperseded = "abgeloest"
	VersionRejected   = "abgelehnt"
	// VersionReplaced is a version that a change on its own first day
	// replaced (#4681): it stays in the history and holds on no day.
	VersionReplaced = "ersetzt"
	// VersionOvertaken is a requested version nobody signed (#4816): a newer
	// version overtook it, or the school took its change back. It stays in
	// the history and holds on no day.
	VersionOvertaken = "ueberholt"
)

const (
	TermOpenEnded   = "open_ended"
	TermSchoolYear  = "school_year"
	TermFixedMonths = "fixed_months"
)

// The date a notice takes effect at.
const (
	NoticeMonthEnd      = "month_end"
	NoticeHalfYear      = "half_year"
	NoticeSchoolYearEnd = "school_year_end"
)

// MailKindContract is the outbox kind of the mail that carries a contract;
// MailRelatedContract its related entity type (ADR 0110, ADR 0123).
const (
	MailKindContract    = "care_contract"
	MailRelatedContract = "care_contract"
)

var (
	// ErrContractNotFound reports a contract that is not one of the Träger.
	ErrContractNotFound = errors.New("care contract not found")
	// ErrApplicationNotFound reports an application child that is unknown,
	// not accepted, or books no care offering at a school of the Träger.
	ErrApplicationNotFound  = errors.New("accepted application not found")
	ErrSchoolOutsideTraeger = errors.New("the school does not belong to the Träger")
	ErrOfferingNotFound     = errors.New("care offering not found")
	ErrContractExists       = errors.New("the application has a contract")
	ErrContractNotDraft     = errors.New("the contract is no draft")
	// ErrContractNotSendable reports a contract that cannot be sent
	// (signed, ended, or active without its frozen document).
	ErrContractNotSendable = errors.New("the contract can no longer be sent")
	ErrRecipientMissing    = errors.New("the contract party has no e-mail address")
	ErrMailPending         = errors.New("the last mail of the contract still waits")
	// ErrMailDelayed reports a send while the server still tries the last mail.
	ErrMailDelayed = errors.New("the last mail of the contract is delayed")
	// ErrMailBlocked reports a send a stop, a list or the provider would hold back.
	ErrMailBlocked         = errors.New("a mail to this address would stay back")
	ErrMailBlockUnreadable = errors.New("the mail provider's block could not be read")
	// ErrLetterheadTooLong reports a letterhead or footer that leaves too
	// little room for the contract.
	ErrLetterheadTooLong = errors.New("the letterhead leaves too little room for the contract")
	// ErrLetterheadMissing reports a send while the Träger has no
	// letterhead: the withdrawal notice takes the Träger's address from it
	// (#7177).
	ErrLetterheadMissing     = errors.New("the Träger has no letterhead for the withdrawal notice")
	ErrInboxDocumentNotFound = errors.New("contract not found in the inbox")
)

// ValidationError marks every refused input with its reason. Selection says
// that the refusal concerns which or how many entries were chosen (count,
// page size) rather than values the user typed into fields.
type ValidationError struct {
	Fields    map[string]string
	Selection bool
}

// InvalidSelection refuses which or how many entries were chosen.
func InvalidSelection(field, reason string) *ValidationError {
	return &ValidationError{Fields: map[string]string{field: reason}, Selection: true}
}

func (e *ValidationError) Error() string {
	if e.Selection {
		return "the selection is invalid"
	}
	return "the input is invalid"
}

// Reviewer is the account of the Träger-Büro that acts, with its Träger.
type Reviewer struct {
	OrganizationID int64
	AccountID      int64
}

// TemplateInput is what the Träger-Büro writes into a contract template.
type TemplateInput struct {
	TermKind               string `json:"term_kind"`
	TermMonths             *int   `json:"term_months"`
	NoticeMonths           int    `json:"notice_months"`
	NoticeTo               string `json:"notice_to"`
	SpecialTermination     bool   `json:"special_termination"`
	SpecialTerminationNote string `json:"special_termination_note"`
	StatuteRequired        bool   `json:"statute_required"`
	StatuteTitle           string `json:"statute_title"`
	StatuteURL             string `json:"statute_url"`
	ContractPartner        string `json:"contract_partner"`
}

// ContractTemplate is the contract template of one offering.
type ContractTemplate struct {
	ID ident.ID `json:"id"`
	TemplateInput
	UpdatedAt time.Time `json:"updated_at"`
}

// OfferingTemplate is one care offering of a school with its template, or
// none yet.
type OfferingTemplate struct {
	SchoolID     ident.ID          `json:"school_id"`
	SchoolName   string            `json:"school_name"`
	OfferingID   ident.ID          `json:"offering_id"`
	OfferingName string            `json:"offering_name"`
	PhaseName    string            `json:"phase_name"`
	PriceCents   *int              `json:"price_cents"`
	Active       bool              `json:"active"`
	Template     *ContractTemplate `json:"template"`
	// IssuerName names the Schulträger or the Gemeinde that concludes the
	// contracts of the school in place of the Träger (#4811); empty for
	// the Träger. A contract partner the conditions name wins over it, so
	// the form warns where both differ.
	IssuerName string `json:"issuer_name"`
	// AcceptanceText is the complete saved conditions text for the enrollment
	// form. It is empty without a template or an explicit contract partner.
	AcceptanceText string `json:"acceptance_text"`
	// WithdrawalText and EarlyStartText are the withdrawal notice and the
	// block for an early start the school adds to the enrollment form
	// (#4682); empty like AcceptanceText.
	WithdrawalText string `json:"withdrawal_text"`
	EarlyStartText string `json:"early_start_text"`
	// TermText and NoticeText are the term and the notice period as the
	// contract PDF prints them; empty without a template.
	TermText   string `json:"term_text"`
	NoticeText string `json:"notice_text"`
	// Version is the read state of the offering's template (ADR 0311): a
	// save sends it back and is refused once the template changed.
	Version string `json:"version"`
}

// TemplateVersion is the read-state token of an offering's template: the
// row's updated_at, which its trigger bumps on every update; an offering
// without a template has readstate.Absent, so a first save is bound too.
func TemplateVersion(template *ContractTemplate) string {
	if template == nil {
		return readstate.Absent
	}
	return readstate.Of(template.UpdatedAt)
}

// CandidateKey names one accepted application child.
type CandidateKey struct {
	SchoolID       ident.ID `json:"school_id"`
	RequestChildID ident.ID `json:"request_child_id"`
}

// Service is one booked service of a contract: on a weekday ("mon" to
// "sun") the child books a module (a care offering of the school) and ends
// at its end time ("HH:MM", empty when the module has none). A weekday may
// carry several modules, early and afternoon care for instance; a weekday
// without a service has no care.
type Service struct {
	Weekday        string   `json:"weekday"`
	CareOfferingID ident.ID `json:"care_offering_id"`
	ModuleName     string   `json:"module_name"`
	EndsAt         string   `json:"ends_at"`
	// LastDay is the last day the module is booked, set only when it ends
	// before the contract version does: the contract never promises a
	// module beyond its booking. Nil means the module runs as long as the
	// version.
	LastDay *calendar.Date `json:"last_day"`
}

// Candidate is an accepted application child with booked care and no
// contract yet. TemplateIssue names why no draft can be made: a module
// without conditions, or modules whose conditions differ.
type Candidate struct {
	CandidateKey
	// AcceptanceIssue tells why the application gives no proof of the
	// parents' agreement for a conclusion at the acceptance (Weg b): empty,
	// SkipAcceptanceMissing or SkipAcceptanceChanged.
	AcceptanceIssue string `json:"acceptance_issue"`
	// Renewal tells that the child was renewed into a new phase: a missing
	// acceptance then means the parents have not accepted the conditions of
	// that phase (#6456).
	Renewal        bool          `json:"renewal"`
	SchoolName     string        `json:"school_name"`
	ChildFirstName string        `json:"child_first_name"`
	ChildLastName  string        `json:"child_last_name"`
	GuardianName   string        `json:"guardian_name"`
	GuardianEmail  string        `json:"guardian_email"`
	PhaseName      string        `json:"phase_name"`
	Services       []Service     `json:"services"`
	EffectiveFrom  calendar.Date `json:"effective_from"`
	TemplateIssue  string        `json:"template_issue"`
	// ModulesText names the booked modules as the contract does.
	ModulesText string `json:"modules_text"`
	// MailBlock names, for a child the conclusion at the acceptance (Weg b)
	// could conclude, why the mail to the parents' address would stay back
	// now (#4680): MailBlockStopped or MailBlockAddress. The contract then
	// waits until the school corrects or clears the address.
	MailBlock string `json:"mail_block,omitempty"`
	// ImportedContractID is the imported contract that covers the child
	// (TemplateIssue SkipImportedContract).
	ImportedContractID ident.ID `json:"imported_contract_id,omitempty"`
}

// CreateResult answers a creation of several drafts: the created contracts
// and, per refused key, why.
type CreateResult struct {
	Created []ContractSummary `json:"created"`
	Skipped []CreateSkip      `json:"skipped"`
}

// CreateSkip is a key the creation left out, with the error code of its
// reason.
type CreateSkip struct {
	CandidateKey
	Reason string `json:"reason"`
}

// The reasons of a CreateSkip; the first two are also the TemplateIssue
// of a Candidate.
const (
	SkipTemplateMissing     = "template_missing"
	SkipTemplatesDiffer     = "templates_differ"
	SkipContractExists      = "contract_exists"
	SkipNotFound            = "application_not_found"
	SkipConclusionAutomatic = "conclusion_automatic"
	SkipAcceptanceMissing   = "acceptance_missing"
	SkipAcceptanceChanged   = "acceptance_changed"
	// SkipImportedContract: an imported contract covers the child in the
	// time of its booked care (#7760), by its child record or, linked to
	// none, by its names; no second contract is created for that time.
	SkipImportedContract = "imported_contract"
)

type ContractFilter struct {
	Status   string
	SchoolID int64
	Search   string
	Offset   int
	Limit    int
	// Export reads every contract of the filter for a file (#4718): at most
	// ContractExportLimit, Offset and Limit ignored, recorded as an export.
	Export bool
}

type ContractSummary struct {
	// StudentID is the child linked to this contract, nil before takeover.
	StudentID      *ident.ID `json:"student_id"`
	ID             ident.ID  `json:"id"`
	Status         string    `json:"status"`
	SchoolID       ident.ID  `json:"school_id"`
	SchoolName     string    `json:"school_name"`
	ChildFirstName string    `json:"child_first_name"`
	ChildLastName  string    `json:"child_last_name"`
	ModuleNames    []string  `json:"module_names"`
	// ModulesText names the modules as the contract does: "A, B und C".
	ModulesText   string        `json:"modules_text"`
	PartyName     string        `json:"party_name"`
	PartyEmail    string        `json:"party_email"`
	EffectiveFrom calendar.Date `json:"effective_from"`
	CreatedAt     time.Time     `json:"created_at"`
	SentAt        *time.Time    `json:"sent_at"`
	// Concluded is how and when the contract was concluded; nil before.
	Concluded *Concluded `json:"concluded"`
	// EndsOn is the last day of a terminated contract (#4682); nil
	// otherwise.
	EndsOn *calendar.Date `json:"ends_on"`
	// Imported tells a contract taken over from a file (ADR 0232) from one
	// of an application: only an imported contract is linked to a child
	// record by hand (ADR 0307).
	Imported bool `json:"imported"`
	// FollowsBookings tells that the contract has an application child: its
	// versions follow the approved bookings of that child. Every contract
	// from an application does, and an imported one once it is bound to the
	// enrollment of its child (ADR 0309); such a contract keeps its child
	// record and takes no offering correction from a file.
	FollowsBookings bool `json:"follows_bookings"`
	// RequestChildID is the application child the contract follows; nil
	// without one. The office names it to take the binding of an imported
	// contract off again (ADR 0309, "Der Weg zurück").
	RequestChildID *ident.ID `json:"request_child_id"`
	// ChangeAwaitsSignature tells that a changed version of an active
	// contract waits for the parents' signature (#4816); the version in
	// force holds until then.
	ChangeAwaitsSignature bool `json:"change_awaits_signature"`
}

// ContractList is the filtered list with the count of every status over all
// contracts of the Träger.
type ContractList struct {
	Contracts []ContractSummary `json:"contracts"`
	Counts    map[string]int    `json:"counts"`
	HasMore   bool              `json:"has_more"`
}

// Version is the frozen content of a contract version: the child, the
// booked services per weekday and module, the terms and the effective date.
type Version struct {
	ID             ident.ID       `json:"id"`
	Number         int            `json:"number"`
	Status         string         `json:"status"`
	EffectiveFrom  calendar.Date  `json:"effective_from"`
	EndsOn         *calendar.Date `json:"ends_on"`
	ChildFirstName string         `json:"child_first_name"`
	ChildLastName  string         `json:"child_last_name"`
	ChildBirthDate *calendar.Date `json:"child_birth_date"`
	SchoolName     string         `json:"school_name"`
	PhaseName      string         `json:"phase_name"`
	Services       []Service      `json:"services"`
	// PriceCents is the monthly price when the version was made: the price
	// of its only module, nil when it has none or the contract has several
	// modules (ADR 0088 section 2). The tariffs per weekday and module of
	// #4684 price the rest.
	PriceCents *int64        `json:"price_cents" contract:"number"`
	Terms      TemplateInput `json:"terms"`
	CreatedAt  time.Time     `json:"created_at"`
	// Source tells where the version came from: SourceConclusion,
	// SourceBookingChange (#4681), SourceImport (#4723) or
	// SourceOfferingCorrection (#7764).
	Source string `json:"source"`
	// ValidUntil is the last day the version holds: the day before the next
	// effective version starts, else its own end. Nil while it holds open
	// ended or is no effective version.
	ValidUntil *calendar.Date `json:"valid_until"`
	// AgreedFrom is the effective date the signed document names when the
	// parents signed a changed version after that day (#4816): the version
	// then holds from the day of the signature, EffectiveFrom. Nil for
	// every other version.
	AgreedFrom *calendar.Date `json:"agreed_from,omitempty"`
}

// VersionSignature tells how the parents agreed to one version (#4816): a
// drawn or typed signature, a paper contract, or their own request for the
// change (SignatureRequest).
type VersionSignature struct {
	VersionNumber int       `json:"version_number"`
	Method        string    `json:"method"`
	Channel       string    `json:"channel"`
	SignerName    string    `json:"signer_name"`
	SignedAt      time.Time `json:"signed_at"`
}

type Party struct {
	FirstName  string `json:"first_name"`
	LastName   string `json:"last_name"`
	Email      string `json:"email"`
	HasAccount bool   `json:"has_account"`
	// ContractDraft says the party's contract is still a draft. Only the
	// billing reads (ContractBilling) fill it: a draft can be discarded, so
	// nothing of the billing may hang on it (#7770).
	ContractDraft bool `json:"-"`
	// FamilyContractID is the leading contract of the family the office
	// joined the contract to (#7161, ADR 0319), zero when it leads or is
	// alone. Only the billing reads fill it.
	FamilyContractID int64 `json:"-"`
	// ContractSchoolID is the place of care of the party's contract. Only
	// the billing reads fill it: its school's issuer takes the mandate
	// (#8040).
	ContractSchoolID int64 `json:"-"`
}

// Mailing is one send of the contract with the state of its mail.
type Mailing struct {
	Recipient string    `json:"recipient"`
	SentAt    time.Time `json:"sent_at"`
	State     string    `json:"state"`
	// Outcome is what Delivery knows about the mail, as with the Abrechnung's letters.
	Outcome string `json:"outcome,omitempty"`
	// SendBlock says why another mail to this address would stay back now. Only the
	// newest mailing carries it.
	SendBlock string `json:"send_block,omitempty"`
	// OutboxID is the mail in Delivery's outbox; the wire never shows it.
	OutboxID int64 `json:"-"`
}

// The states of a Mailing, as ADR 0123 names them.
const (
	MailQueued  = "queued"
	MailSent    = "sent"
	MailFailed  = "failed"
	MailUnknown = "unknown"
)

// Why another mail would stay back now, in Delivery's words.
const (
	MailBlockDelayed    = "delayed"
	MailBlockStopped    = "stopped"
	MailBlockAddress    = "address"
	MailBlockProvider   = "provider"
	MailBlockUnreadable = "provider_unknown"
)

type ContractDetail struct {
	ContractSummary
	Version  Version   `json:"version"`
	Parties  []Party   `json:"parties"`
	Mailings []Mailing `json:"mailings"`
	// DocumentFrozen tells that the PDF was rendered at the first send or
	// the handover on paper (#8030) and no longer follows the template.
	DocumentFrozen bool `json:"document_frozen"`
	// Signature is the signature of the current version, nil until signed;
	// Reminders the reminder mails while it waits (#4679, signature.go).
	Signature *ContractSignature `json:"signature"`
	Reminders []Reminder         `json:"reminders"`
	// VersionSignatures tell for every signed version how the parents
	// agreed to it, oldest first (#4816).
	VersionSignatures []VersionSignature `json:"version_signatures"`
	// Versions are all versions of the contract, oldest first (#4681). The
	// version above is the one in force today, else the next one.
	Versions []Version `json:"versions"`
	// The term up to the contract's last day, the notice period and the
	// monthly fee of the version above, as the contract PDF prints them.
	TermText   string `json:"term_text"`
	NoticeText string `json:"notice_text"`
	FeeText    string `json:"fee_text"`
	// Corrections are the corrections of a contract from an import, newest
	// first (#7767, contract_corrections.go); empty for every other.
	Corrections []ContractCorrection `json:"corrections"`
}

// File is a rendered PDF.
type File struct {
	// WithdrawalNotice identifies PDFs generated with the withdrawal notice.
	WithdrawalNotice bool `json:"-"`
	Filename         string
	ContentType      string
	Data             []byte
}

type SendResult struct {
	Sent    []ident.ID `json:"sent"`
	Skipped []SendSkip `json:"skipped"`
}

type SendSkip struct {
	ID     ident.ID `json:"id"`
	Reason string   `json:"reason"`
}

const (
	SkipRecipientMissing    = "recipient_missing"
	SkipPartnerMissing      = "partner_missing"
	SkipMailPending         = "mail_pending"
	SkipMailDelayed         = "mail_delayed"
	SkipMailBlocked         = "mail_blocked"
	SkipMailBlockUnreadable = "mail_block_unreadable"
	SkipNotSendable         = "not_sendable"
	// SkipLetterheadMissing holds back a conclusion at the acceptance while
	// the Träger has no letterhead (#7177); the office's own send answers
	// with ErrLetterheadMissing instead.
	SkipLetterheadMissing = "letterhead_missing"
)

// Contracts serves the contracts of a Träger to its Träger-Büro. Every
// operation lands in the trail. The writes run in the Träger transaction of
// the reviewer's Träger, which the caller opens. The reads (ListContracts,
// Contract, ContractDocument) open their own units, so the caller holds no
// transaction: the Träger transaction, then the tenant transaction of each
// school whose contracts they showed, for its access log (ADR 0088 section 7).
type Contracts interface {
	// ListContracts lists the contracts of the filter, newest first. With
	// Export it holds every contract of the filter or refuses one with more
	// than ContractExportLimit.
	ListContracts(ctx context.Context, reviewer Reviewer, filter ContractFilter) (ContractList, error)
	Contract(ctx context.Context, reviewer Reviewer, contractID int64) (ContractDetail, error)
	// ContractDocument answers the PDF: the stored one once sent, before
	// that a preview with the current template, which stores nothing.
	ContractDocument(ctx context.Context, reviewer Reviewer, contractID int64) (File, error)
	// SendContracts sends each contract by mail and into the inbox: a draft
	// gets its PDF and becomes versendet, a sent or active one is sent again with the
	// same PDF.
	SendContracts(ctx context.Context, reviewer Reviewer, contractIDs []int64) (SendResult, error)
	// ResendContract corrects only the delivery address of a failed send,
	// preserving the contract party, frozen PDF and previous mailings.
	ResendContract(ctx context.Context, reviewer Reviewer, contractID int64, email string) (SendResult, error)
	// DiscardContract removes a draft; a sent contract stays.
	DiscardContract(ctx context.Context, reviewer Reviewer, contractID int64) error
	// VersionDocument answers the PDF of one version (#4681): the stored one
	// when it was sent, else a rendering with the current template that
	// stores nothing.
	VersionDocument(ctx context.Context, reviewer Reviewer, contractID int64, number int) (File, error)
	// ContractFamilies lists the contracts without a mail address with their
	// families and the newest changes of the families (#7161, ADR 0319).
	ContractFamilies(ctx context.Context, reviewer Reviewer) (ContractFamilySet, error)
	// JoinContractFamily joins the contracts to one family. A contract of
	// another Träger is ErrContractNotFound, one that may not join a
	// FamilyRefusal, another version than the stored one readstate.ErrChanged.
	JoinContractFamily(ctx context.Context, reviewer Reviewer, input FamilyJoinInput) (ContractFamilySet, error)
	// LeaveContractFamily gives a contract led by another its own family
	// back, with the same refusals.
	LeaveContractFamily(ctx context.Context, reviewer Reviewer, contractID int64, expectedVersion string) (ContractFamilySet, error)
}

// ContractExportLimit is the most contracts one export holds; a filter with
// more is refused with an invalid selection, never cut short.
const ContractExportLimit = 5000

// Intake creates contracts from the accepted applications and keeps the
// templates of the offerings. It reads each school in that school's tenant
// transaction and writes in the Träger transaction, one after the other, so
// its ordinary commands open their own units outside any transaction.
// PrepareTemplateBatch instead participates in the caller's school unit and
// returns a command for its later financial Träger unit.
type Intake interface {
	// PrepareTemplateBatch validates every template and its school offering
	// before the caller commits the school copies.
	PrepareTemplateBatch(ctx context.Context, reviewer Reviewer, schoolID int64, inputs []ModuleTemplateInput) (PreparedTemplates, error)
	// Candidates lists the accepted application children with booked care
	// and no contract, over all schools of the Träger.
	Candidates(ctx context.Context, reviewer Reviewer, schoolID int64) ([]Candidate, error)
	// CreateContracts creates a draft for every key over all modules the
	// child books; the keys that have a contract already, or whose modules
	// lack conditions or differ in them, are left out with their reason.
	CreateContracts(ctx context.Context, reviewer Reviewer, keys []CandidateKey) (CreateResult, error)
	// Templates lists every offering of the Träger's schools with its
	// template.
	Templates(ctx context.Context, reviewer Reviewer) ([]OfferingTemplate, error)
	// SaveTemplate creates or replaces the template of one offering; it
	// refuses with readstate.ErrChanged once the template differs from the
	// version its author read (expectedVersion, TemplateVersion).
	SaveTemplate(ctx context.Context, reviewer Reviewer, schoolID, offeringID int64, input TemplateInput, expectedVersion string) (OfferingTemplate, error)
	// ConclusionModes tells for every school of the Träger how its contracts
	// come about: ModeSendLater (Weg a) or ModeOnAcceptance (Weg b).
	ConclusionModes(ctx context.Context, reviewer Reviewer) ([]SchoolConclusion, error)
}

// InboxReader is the parents' account that reads its inbox, with its
// current address and the children the workflow authorized.
type InboxReader struct {
	AccountID int64
	Email     string
	// Children contains only permitted student IDs, grouped by school.
	Children map[int64][]int64
	// SigningChildren contains only children the workflow permits signing for.
	SigningChildren map[int64][]int64
}

// InboxContract is one sent contract in the inbox of the parents portal.
type InboxContract struct {
	ID          int64         `json:"id"`
	ChildNames  []string      `json:"child_names"`
	ModuleNames []string      `json:"module_names"`
	ModulesText string        `json:"modules_text"`
	SchoolName  string        `json:"school_name"`
	SentAt      time.Time     `json:"sent_at"`
	EffectiveOn calendar.Date `json:"effective_on"`
	CanSign     bool          `json:"can_sign"`
	// Status and SignedAt tell the parents whether the contract waits for
	// their signature (#4679).
	Status   string     `json:"status"`
	SignedAt *time.Time `json:"signed_at"`
	// Replaced tells that a change on the first day of the sent version
	// replaced it (#4681): it holds on no day, and a changed version holds
	// from EffectiveOn.
	Replaced bool `json:"replaced"`
	// EndsOn is the last day of a terminated contract (#4682), so the inbox
	// shows its end. CanEnd tells that the contract is active and the
	// reader's relationship to its child grants the right a declaration
	// needs (InboxReader.SigningChildren, parent_portal.enrollment.submit).
	EndsOn *calendar.Date `json:"ends_on"`
	CanEnd bool           `json:"can_end"`
	// CanWithdraw tells that CanEnd holds and the withdrawal period may
	// still run (#6105): the inbox then shows the withdrawal function
	// „Vertrag widerrufen“ of § 356a BGB. The declaration page decides on
	// the exact day.
	CanWithdraw bool `json:"can_withdraw"`
	// ChangeAwaitsSignature tells that the row shows a changed version of
	// an active contract that waits for the signature (#4816): the earlier
	// version holds until the parents sign.
	ChangeAwaitsSignature bool `json:"change_awaits_signature"`
}

// Inbox serves the contracts of one Träger in the parents' inbox (ADR 0088
// section 7, ADR 0126): a contract shows once it was sent to the address of
// the account and the matching child relationship permits it. Both operations
// run in the Träger transaction the caller
// opens and record the read with the account.
type Inbox interface {
	InboxContracts(ctx context.Context, organizationID int64, reader InboxReader) ([]InboxContract, error)
	InboxContractDocument(ctx context.Context, organizationID, contractID int64, reader InboxReader) (File, error)
}

// ContractMail is the payload of the mail of a contract: everything the
// worker needs, so it needs no Träger transaction (ADR 0123 point 2).
type ContractMail struct {
	OrganizationID int64  `json:"organization_id"`
	ContractID     int64  `json:"contract_id"`
	Recipient      string `json:"recipient"`
	GuardianName   string `json:"guardian_name"`
	TraegerName    string `json:"traeger_name"`
	ChildName      string `json:"child_name"`
	Modules        string `json:"modules"`
	Filename       string `json:"filename"`
	PDF            []byte `json:"pdf"`
	IdempotencyKey string `json:"idempotency_key"`
	// The signature of #4679 (signature.go): Purpose picks the mail
	// (contract, reminder, confirmation), SigningURL is the one-time link
	// with its last day, and a confirmation names the signature and carries
	// the withdrawal notice.
	Purpose          string   `json:"purpose,omitempty"`
	SigningURL       string   `json:"signing_url,omitempty"`
	LinkExpiresOn    string   `json:"link_expires_on,omitempty"`
	SignedAt         string   `json:"signed_at,omitempty"`
	SignerName       string   `json:"signer_name,omitempty"`
	DocumentSHA256   string   `json:"document_sha256,omitempty"`
	EarlyStart       bool     `json:"early_start,omitempty"`
	WithdrawalEndsOn string   `json:"withdrawal_ends_on,omitempty"`
	WithdrawalNotice []string `json:"withdrawal_notice,omitempty"`
	// Concluded tells that the contract is concluded already (Weg b): the
	// parents receive it for their records and sign nothing.
	Concluded bool `json:"concluded,omitempty"`
	// EffectiveFrom is the German date a changed version holds from (#4816).
	EffectiveFrom string `json:"effective_from,omitempty"`
	// Amendment asks for another signature on a change to a concluded contract.
	Amendment bool `json:"amendment,omitempty"`
}

// RenderedContractMail is the mail the worker sends.
type RenderedContractMail struct {
	SenderName string
	Subject    string
	Template   string
	Content    ContractMailContent
	Filename   string
	PDF        []byte
}

// ContractMailContent is what the mail template prints.
type ContractMailContent struct {
	GuardianName string
	TraegerName  string
	ChildName    string
	Modules      string
	// The signature of #4679: the link of a contract or reminder mail, and
	// what a confirmation names.
	SigningURL       string
	LinkExpiresOn    string
	SignedAt         string
	SignerName       string
	DocumentSHA256   string
	EarlyStart       bool
	WithdrawalEndsOn string
	WithdrawalNotice []string
	Concluded        bool
	// EffectiveFrom is the day a changed version holds from (#4816).
	EffectiveFrom string
	Amendment     bool
}

type ContractMailRenderer func(ctx context.Context, payload []byte) (RenderedContractMail, error)

// ModuleTemplateInput names the validated school offering of a template.
type ModuleTemplateInput struct {
	CareOfferingID int64
	Input          TemplateInput
}

// PreparedTemplates writes owner-validated inputs in the caller's Träger
// transaction. Preparation runs in the school's transaction; no scope is nested.
type PreparedTemplates func(context.Context) error
