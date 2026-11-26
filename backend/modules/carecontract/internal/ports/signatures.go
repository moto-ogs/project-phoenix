package ports

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The actions of the trail the signature adds (#4679).
const (
	ActionSign   = "sign"
	ActionRemind = "remind"
)

// StoredDocument is the frozen PDF of the contract's current version with
// its checksum.
type StoredDocument struct {
	ID        int64
	VersionID int64
	SHA256    string
	File      carecontract.File
}

// SentState is what the parents were sent: the SHA-256 of the PDF and the
// checksum of the version it shows. A signature compares the contract with
// it, so a PDF or a version changed after the send is never signed.
type SentState struct {
	DocumentSHA256 string
	VersionSHA256  string
}

// SigningLinkRecord is a stored one-time mail link.
type SigningLinkRecord struct {
	ID         int64
	ContractID int64
	DocumentID int64
	Sent       SentState
	ExpiresAt  time.Time
	UsedAt     *time.Time
}

// NewSignature is the conclusion of one contract version.
type NewSignature struct {
	ContractID          int64
	VersionID           int64
	DocumentID          *int64
	Method              string
	Channel             string
	AuditSignatureID    *int64
	SignerName          string
	SignerAccountID     *int64
	SigningLinkID       *int64
	VersionSHA256       string
	DocumentSHA256      string
	WithdrawalNoticeAt  *time.Time
	EarlyStartRequested bool
	PaperFilename       string
	PaperPDF            []byte
	PaperSHA256         string
	SignedOn            calendar.Date
	SignedAt            time.Time
	RecordedByAccountID *int64
	// ChangeRequestID is the parents' request that counts as the signature
	// (carecontract.SignatureRequest, #4816); nil for every other method.
	ChangeRequestID *int64
}

type StoredSignature struct {
	VersionID           int64
	DocumentID          *int64
	Method              string
	Channel             string
	AuditSignatureID    *int64
	SignerName          string
	VersionSHA256       string
	DocumentSHA256      string
	WithdrawalNoticeAt  *time.Time
	EarlyStartRequested bool
	PaperFilename       string
	PaperIntact         bool
	SignedOn            calendar.Date
	SignedAt            time.Time
}

// ReminderCandidate is a sent contract without signature whose last mail
// or reminder lies back far enough.
type ReminderCandidate struct {
	ContractID int64
	// VersionID is the version that waits for the signature (#4816).
	VersionID int64
	Number    int
	Recipient string
}

// SignatureStore persists the signatures, links and reminders of the
// contracts of a Träger in its Träger transaction.
type SignatureStore interface {
	CurrentDocument(ctx context.Context, organizationID, contractID, versionID int64) (StoredDocument, error)
	// InsertSigningLink stamps the link's created_at and expires_at on the
	// owner clock, the clock every reader of the link compares with (#7295).
	InsertSigningLink(ctx context.Context, organizationID, contractID, documentID int64, tokenSHA256 string, sent SentState, createdAt, expiresAt time.Time) error
	SigningLink(ctx context.Context, organizationID int64, tokenSHA256 string) (SigningLinkRecord, error)
	// LatestSigningLink reads the newest link of a contract; found is false
	// when the contract was never sent with one.
	LatestSigningLink(ctx context.Context, organizationID, contractID int64) (link SigningLinkRecord, found bool, err error)
	UseSigningLink(ctx context.Context, organizationID, linkID int64, at time.Time) error
	InsertSignature(ctx context.Context, organizationID int64, signature NewSignature) error
	// Signature reads the signature of a version; versionID 0 reads the
	// newest signature of the contract, whichever version it signed.
	Signature(ctx context.Context, organizationID, contractID, versionID int64) (*StoredSignature, error)
	PaperDocument(ctx context.Context, organizationID, contractID int64) (carecontract.File, error)
	Reminders(ctx context.Context, organizationID, contractID int64) ([]carecontract.Reminder, error)
	DueReminders(ctx context.Context, organizationID, contractID int64, lastContactBefore time.Time, maxReminders int) ([]ReminderCandidate, error)
	// InsertReminder records a reminder at the owner clock's instant at.
	InsertReminder(ctx context.Context, organizationID int64, candidate ReminderCandidate, outboxID int64, at time.Time) error
	// VersionSignatures lists how the parents agreed to each signed version
	// of the contract, oldest version first (#4816).
	VersionSignatures(ctx context.Context, organizationID, contractID int64) ([]carecontract.VersionSignature, error)
	// InboxContractAddressed tells whether the contract went to the
	// reader's address for a child the reader may act for; a nonzero
	// versionID asks for the PDF of that version (#4816).
	InboxContractAddressed(ctx context.Context, organizationID, contractID, versionID int64, reader carecontract.InboxReader) (bool, error)
}
