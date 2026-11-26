package application

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The signature of a contract (#4679, ADR 0088 section 3): the one-time
// mail link, the signature in the parents portal, the paper contract and
// the signature on the contract's detail.

type (
	SignatureStore    = ports.SignatureStore
	StoredDocument    = ports.StoredDocument
	StoredSignature   = ports.StoredSignature
	NewSignature      = ports.NewSignature
	SigningLinkRecord = ports.SigningLinkRecord
	SentState         = ports.SentState
)

type ContractStore interface {
	Store
	SignatureStore
	// FamilyStore keeps the families of the contracts without a mail
	// address (#7161).
	ports.FamilyStore
}

// SignaturePorts are the root-bound ports of the signature.
type SignaturePorts struct {
	Ledger  carecontract.SignatureLedger
	Links   carecontract.SigningLinks
	Sender  carecontract.TraegerSigningSender
	Post    carecontract.Post
	Runtime carecontract.Runtime
	// Holidays dates the withdrawal period the signature names (#6350).
	Holidays carecontract.SchoolHolidays
	// Families keeps the number of children the parents state on the link
	// (#6335).
	Families carecontract.FamilyNumbers
}

// Signatures serves carecontract.Signing, carecontract.InboxSigning and
// carecontract.PaperSignatures.
type Signatures struct {
	store ContractStore
	ports SignaturePorts
	clock Clock
	// contracts freezes the PDF of a draft signed on paper; nil where only
	// the parents sign.
	contracts *Contracts
}

var (
	_ carecontract.Signing         = (*Signatures)(nil)
	_ carecontract.InboxSigning    = (*Signatures)(nil)
	_ carecontract.PaperSignatures = (*Signatures)(nil)
)

func NewSignatures(store ContractStore, ports SignaturePorts, clock Clock, contracts *Contracts) *Signatures {
	requireClock(clock, "signatures")
	if store == nil || ports.Ledger == nil || ports.Links.Tokens == nil || ports.Links.Fingerprint == nil || ports.Sender == nil || ports.Post == nil || ports.Runtime == nil ||
		ports.Holidays == nil || ports.Families == nil {
		panic("care contract: the store, the ledger, the tokens, the sender, the post, the runtime, the school holidays and the family numbers are required")
	}
	return &Signatures{store: store, ports: ports, clock: clock, contracts: contracts}
}

// parseLink splits "<Träger>.<token>"; a malformed link is an invalid one.
func parseLink(link string) (int64, string, error) {
	organization, token, found := strings.Cut(strings.TrimSpace(link), ".")
	id, err := strconv.ParseInt(organization, 10, 64)
	if !found || err != nil || id <= 0 || token == "" || len(token) > 128 {
		return 0, "", carecontract.ErrSigningLinkInvalid
	}
	return id, token, nil
}

// linkTarget is a contract that an open link names, with its frozen PDF.
type linkTarget struct {
	link     SigningLinkRecord
	record   ContractRecord
	document StoredDocument
}

// openLink resolves an open link in the Träger transaction: it must be
// unused and unexpired, its contract must wait for a signature, and the
// PDF it was sent with must still be the contract's PDF. Only failed link
// validation answers ErrSigningLinkInvalid; operational errors stay retryable.
// The contract's row stays locked until the transaction ends.
func (s *Signatures) openLink(ctx context.Context, organizationID int64, token string, now time.Time) (linkTarget, error) {
	return s.openLinkContract(ctx, organizationID, token, now, true)
}

// openLinkContract is openLink; lockContract false reads the contract
// without its row lock, for a caller that does not change the contract.
func (s *Signatures) openLinkContract(ctx context.Context, organizationID int64, token string, now time.Time, lockContract bool) (linkTarget, error) {
	link, err := s.store.SigningLink(ctx, organizationID, s.ports.Links.Tokens.Fingerprint(token))
	if err != nil {
		return linkTarget{}, err
	}
	if link.UsedAt != nil || !link.ExpiresAt.After(now) {
		return linkTarget{}, carecontract.ErrSigningLinkInvalid
	}
	record, err := s.store.Contract(ctx, organizationID, link.ContractID, lockContract)
	if errors.Is(err, carecontract.ErrContractNotFound) {
		return linkTarget{}, carecontract.ErrSigningLinkInvalid
	}
	if err != nil {
		return linkTarget{}, err
	}
	// The link signs the version that waits: a sent contract's, or the
	// changed version of an active one (#4816).
	waits, err := waitingRecord(ctx, s.store, organizationID, &record)
	if err != nil {
		return linkTarget{}, err
	}
	document, err := s.store.CurrentDocument(ctx, organizationID, link.ContractID, record.Version.ID.Int64())
	if errors.Is(err, carecontract.ErrContractNotSignable) {
		return linkTarget{}, carecontract.ErrSigningLinkInvalid
	}
	if err != nil {
		return linkTarget{}, err
	}
	if document.ID != link.DocumentID || !waits {
		return linkTarget{}, carecontract.ErrSigningLinkInvalid
	}
	return linkTarget{link: link, record: record, document: document}, nil
}

// LinkSigning shows the contract of an open link. It records the read and
// leaves the link open.
func (s *Signatures) LinkSigning(ctx context.Context, link string) (carecontract.SigningView, error) {
	organizationID, token, err := parseLink(link)
	if err != nil {
		return carecontract.SigningView{}, err
	}
	var view carecontract.SigningView
	err = s.withinLink(ctx, organizationID, func(txCtx context.Context) error {
		target, err := s.openLink(txCtx, organizationID, token, s.clock.now())
		if err != nil {
			return err
		}
		if view, err = s.view(txCtx, organizationID, target.record, target.document); err != nil {
			return err
		}
		return trailContract(txCtx, s.store, organizationID, 0, target.record, ports.ActionRead, map[string]any{"via": carecontract.ChannelMailLink})
	})
	return view, err
}

func (s *Signatures) LinkSigningDocument(ctx context.Context, link string) (carecontract.File, error) {
	organizationID, token, err := parseLink(link)
	if err != nil {
		return carecontract.File{}, err
	}
	var file carecontract.File
	err = s.withinLink(ctx, organizationID, func(txCtx context.Context) error {
		target, err := s.openLink(txCtx, organizationID, token, s.clock.now())
		if err != nil {
			return err
		}
		file = target.document.File
		return trailContract(txCtx, s.store, organizationID, 0, target.record, ports.ActionRead,
			map[string]any{"via": carecontract.ChannelMailLink, "view": "document"})
	})
	return file, err
}

// SignByLink signs the contract of an open link and closes the link.
func (s *Signatures) SignByLink(ctx context.Context, link string, input carecontract.SignatureInput) (carecontract.SigningView, error) {
	organizationID, token, err := parseLink(link)
	if err != nil {
		return carecontract.SigningView{}, err
	}
	var view carecontract.SigningView
	err = s.withinLink(ctx, organizationID, func(txCtx context.Context) error {
		now := s.clock.now()
		target, err := s.openLink(txCtx, organizationID, token, now)
		if err != nil {
			return err
		}
		if err := s.store.UseSigningLink(txCtx, organizationID, target.link.ID, now); err != nil {
			return err
		}
		linkID := target.link.ID
		sent := target.link.Sent
		view, err = s.sign(txCtx, organizationID, target.record, target.document, input, signer{
			channel: carecontract.ChannelMailLink, linkID: &linkID, sent: &sent,
		}, now)
		return err
	})
	return view, err
}

// periods dates withdrawal periods over the school holidays port.
func (s *Signatures) periods() withdrawalPeriods {
	return withdrawalPeriods{holidays: s.ports.Holidays}
}

// withinLink opens the Träger transaction without reclassifying operational failures.
func (s *Signatures) withinLink(ctx context.Context, organizationID int64, fn func(context.Context) error) error {
	if err := s.ports.Runtime.WithinTraeger(ctx, organizationID, fn); err != nil {
		return fmt.Errorf("care contract: signing link transaction: %w", err)
	}
	return nil
}

// InboxSigningView shows a contract addressed to the reader, for one of
// the children the reader may sign for.
func (s *Signatures) InboxSigningView(ctx context.Context, organizationID, contractID int64, reader carecontract.InboxReader) (carecontract.SigningView, error) {
	record, document, err := s.inboxContract(ctx, organizationID, contractID, reader, false)
	if err != nil {
		return carecontract.SigningView{}, err
	}
	// The page shows a contract that waits for the signature or carries it;
	// a terminated or withdrawn one has its confirmation page (#4682).
	if record.Summary.Status != carecontract.StatusSent && record.Summary.Status != carecontract.StatusActive {
		return carecontract.SigningView{}, carecontract.ErrContractNotSignable
	}
	view, err := s.view(ctx, organizationID, record, document)
	if err != nil {
		return carecontract.SigningView{}, err
	}
	stored, err := s.store.Signature(ctx, organizationID, record.Summary.ID.Int64(), record.Version.ID.Int64())
	if err != nil {
		return carecontract.SigningView{}, err
	}
	if stored != nil {
		view.Signature = &carecontract.SigningSignature{
			Method: stored.Method, SignerName: stored.SignerName, SignedAt: stored.SignedAt,
			EarlyStartRequested: stored.EarlyStartRequested,
		}
		// Only a drawn or typed signature starts a withdrawal period.
		if stored.Method == carecontract.SignatureDrawn || stored.Method == carecontract.SignatureTyped {
			ends, err := s.periods().withdrawalEnd(ctx, record.Summary.SchoolID.Int64(), stored.SignedAt)
			if err != nil {
				return carecontract.SigningView{}, err
			}
			view.Signature.WithdrawalEndsOn = &ends
		}
	}
	view.AwaitsSignature = stored == nil && awaitsSignature(record)
	return view, trailContract(ctx, s.store, organizationID, reader.AccountID, record, ports.ActionRead, map[string]any{"via": carecontract.ChannelParentAccount})
}

func (s *Signatures) SignInInbox(ctx context.Context, organizationID, contractID int64, reader carecontract.InboxReader, input carecontract.SignatureInput) (carecontract.SigningView, error) {
	record, document, err := s.inboxContract(ctx, organizationID, contractID, reader, true)
	if err != nil {
		return carecontract.SigningView{}, err
	}
	account := reader.AccountID
	// The parents sign what the newest send gave them, the PDF and the
	// version of its link.
	link, found, err := s.store.LatestSigningLink(ctx, organizationID, record.Summary.ID.Int64())
	if err != nil {
		return carecontract.SigningView{}, err
	}
	var sent *SentState
	if found {
		sent = &link.Sent
	}
	return s.sign(ctx, organizationID, record, document, input,
		signer{channel: carecontract.ChannelParentAccount, accountID: &account, sent: sent}, s.clock.now())
}

// inboxContract reads a contract the reader may see and sign: sent to the
// reader's address, for a child the reader acts for. Any other contract is
// not in the inbox.
func (s *Signatures) inboxContract(ctx context.Context, organizationID, contractID int64, reader carecontract.InboxReader, forUpdate bool) (ContractRecord, StoredDocument, error) {
	email, err := inboxAddress(organizationID, reader)
	if err != nil || contractID <= 0 {
		return ContractRecord{}, StoredDocument{}, carecontract.ErrInboxDocumentNotFound
	}
	reader.Email = email
	addressed, err := s.store.InboxContractAddressed(ctx, organizationID, contractID, 0, reader)
	if err != nil {
		return ContractRecord{}, StoredDocument{}, err
	}
	if !addressed {
		return ContractRecord{}, StoredDocument{}, carecontract.ErrInboxDocumentNotFound
	}
	record, err := s.store.Contract(ctx, organizationID, contractID, forUpdate)
	if errors.Is(err, carecontract.ErrContractNotFound) {
		return ContractRecord{}, StoredDocument{}, carecontract.ErrInboxDocumentNotFound
	}
	if err != nil {
		return ContractRecord{}, StoredDocument{}, err
	}
	// An active contract shows its changed version while it waits for the
	// signature (#4816), else the version in force.
	waits, err := waitingRecord(ctx, s.store, organizationID, &record)
	if err != nil {
		return ContractRecord{}, StoredDocument{}, err
	}
	// A version that waits is shown and signed only by an account it was
	// sent to: an earlier address of the contract does not sign a change
	// that went to another one.
	if waits {
		addressed, err = s.store.InboxContractAddressed(ctx, organizationID, contractID, record.Version.ID.Int64(), reader)
		if err != nil {
			return ContractRecord{}, StoredDocument{}, err
		}
		if !addressed {
			return ContractRecord{}, StoredDocument{}, carecontract.ErrInboxDocumentNotFound
		}
	}
	document, err := s.store.CurrentDocument(ctx, organizationID, contractID, record.Version.ID.Int64())
	if errors.Is(err, carecontract.ErrContractNotSignable) {
		return ContractRecord{}, StoredDocument{}, carecontract.ErrInboxDocumentNotFound
	}
	if err != nil {
		return ContractRecord{}, StoredDocument{}, err
	}
	return record, document, nil
}

// unchangedChecksum answers the checksum of the version the parents sign,
// once it is clear that neither it nor the PDF changed after the send.
func (s *Signatures) unchangedChecksum(record ContractRecord, document StoredDocument, sent *SentState) (string, error) {
	checksum, err := versionChecksum(s.ports.Links.Fingerprint, record.Version)
	if err != nil {
		return "", err
	}
	return checksum, unchangedSinceSent(sent, document, checksum)
}

// unchangedSinceSent refuses a signature of a contract whose frozen PDF or
// version no longer matches what was sent: the parents sign only what they
// were given. A contract without a send to compare with is not signable.
func unchangedSinceSent(sent *SentState, document StoredDocument, versionChecksum string) error {
	if sent == nil {
		return fmt.Errorf("%w: no send to compare the contract with", carecontract.ErrContractNotSignable)
	}
	if sent.DocumentSHA256 != document.SHA256 || sent.VersionSHA256 != versionChecksum {
		return fmt.Errorf("%w: the contract changed after it was sent", carecontract.ErrContractNotSignable)
	}
	return nil
}

// reviewedDocument refuses a signature for another PDF than the one the
// signer read (#4816): while the page was open, a changed version may have
// overtaken the one it showed. A changed version always needs the checksum
// of the PDF the page showed; a first contract has one PDF and takes a
// signature without it, as before.
func reviewedDocument(record ContractRecord, document StoredDocument, input carecontract.SignatureInput) error {
	reviewed := strings.TrimSpace(input.DocumentSHA256)
	if reviewed == "" && record.Version.Number <= 1 {
		return nil
	}
	if reviewed != document.SHA256 {
		return fmt.Errorf("%w: the signer read another version", carecontract.ErrContractNotSignable)
	}
	return nil
}

// signer is who signs, how the signer was identified, and what was sent to
// the signer.
type signer struct {
	channel   string
	accountID *int64
	linkID    *int64
	sent      *SentState
}

// sign records a drawn or typed signature of the contract's frozen PDF,
// concludes the contract and enqueues the confirmation with the PDF and
// the withdrawal notice, all in the caller's Träger transaction.
func (s *Signatures) sign(ctx context.Context, organizationID int64, record ContractRecord, document StoredDocument,
	input carecontract.SignatureInput, who signer, now time.Time) (carecontract.SigningView, error) {
	if !awaitsSignature(record) || ident.ID(document.VersionID) != record.Version.ID {
		return carecontract.SigningView{}, carecontract.ErrContractNotSignable
	}
	checksum, err := s.unchangedChecksum(record, document, who.sent)
	if err != nil {
		return carecontract.SigningView{}, err
	}
	if err := reviewedDocument(record, document, input); err != nil {
		return carecontract.SigningView{}, err
	}
	if !input.NoticeAcknowledged {
		return carecontract.SigningView{}, carecontract.ErrWithdrawalNoticeRequired
	}
	party, _ := recipient(record.Parties)
	signerName := fullName(party.FirstName, party.LastName)
	if input.Method == carecontract.SignatureTyped && strings.TrimSpace(input.TypedName) != "" {
		signerName = strings.TrimSpace(input.TypedName)
	}
	if signerName == "" {
		return carecontract.SigningView{}, carecontract.ErrSignatureInvalid
	}
	if err := s.recordSignature(ctx, organizationID, record, document, input, who, signed{name: signerName, checksum: checksum, at: now}); err != nil {
		return carecontract.SigningView{}, err
	}
	accountID := int64(0)
	if who.accountID != nil {
		accountID = *who.accountID
	}
	status, from, err := s.takeEffect(ctx, organizationID, accountID, record, input.Method, now)
	if err != nil {
		return carecontract.SigningView{}, err
	}
	// A version signed after the day its PDF names holds from today: the
	// confirmation shows that day.
	record.Version.EffectiveFrom = from
	if err := trailContract(ctx, s.store, organizationID, accountID, record, ports.ActionSign, map[string]any{
		"via": who.channel, "method": input.Method, "document_sha256": document.SHA256, "version_sha256": checksum,
		"early_start": input.EarlyStart, "status": status, "version_number": record.Version.Number,
	}); err != nil {
		return carecontract.SigningView{}, err
	}
	view, err := s.signedView(ctx, organizationID, record, document, carecontract.SigningSignature{
		Method: input.Method, SignerName: signerName, SignedAt: now, EarlyStartRequested: input.EarlyStart,
	})
	if err != nil {
		return carecontract.SigningView{}, err
	}
	view.Status = status
	return view, s.confirm(ctx, organizationID, record, document, view, party)
}

// signed is a drawn or typed signature as it is recorded: the signer's
// name, the checksum of the version and the instant.
type signed struct {
	name     string
	checksum string
	at       time.Time
}

// recordSignature stores the drawn or typed signature in the ledger of the
// Audit Platform and with the contract's version.
func (s *Signatures) recordSignature(ctx context.Context, organizationID int64, record ContractRecord, document StoredDocument,
	input carecontract.SignatureInput, who signer, entry signed) error {
	auditID, err := s.ports.Ledger.RecordContractSignature(ctx, carecontract.ContractSignatureEntry{
		OrganizationID: organizationID, VersionID: record.Version.ID.Int64(), SignerAccountID: who.accountID,
		SignerName: entry.name, DocumentSHA256: document.SHA256, SignedAt: entry.at, Input: input,
	})
	if err != nil {
		return err
	}
	documentID := document.ID
	return s.store.InsertSignature(ctx, organizationID, NewSignature{
		ContractID: record.Summary.ID.Int64(), VersionID: record.Version.ID.Int64(), DocumentID: &documentID, Method: input.Method,
		Channel: who.channel, AuditSignatureID: &auditID, SignerName: entry.name, SignerAccountID: who.accountID,
		SigningLinkID: who.linkID, VersionSHA256: entry.checksum, DocumentSHA256: document.SHA256, WithdrawalNoticeAt: &entry.at,
		EarlyStartRequested: input.EarlyStart, SignedOn: calendar.DateFromTime(entry.at), SignedAt: entry.at,
	})
}

// takeEffect lets the signed version take effect: the signature of a sent
// contract concludes it, the signature of a changed version of an active
// contract moves that version into the timeline (#4816). Either way the
// contract is aktiv afterwards; the day is the one the version holds from.
func (s *Signatures) takeEffect(ctx context.Context, organizationID, accountID int64, record ContractRecord, method string, now time.Time) (string, calendar.Date, error) {
	if record.Summary.Status == carecontract.StatusSent {
		status, err := concludeSigned(ctx, s.store, organizationID, accountID, record, method, now)
		return status, record.Version.EffectiveFrom, err
	}
	from, err := activateSigned(ctx, s.store, organizationID, record, calendar.DateFromTime(now))
	return carecontract.StatusActive, from, err
}

// signedView is the page after the signature, with the last day of the
// withdrawal period at the contract's school (#6350).
func (s *Signatures) signedView(ctx context.Context, organizationID int64, record ContractRecord, document StoredDocument,
	signature carecontract.SigningSignature) (carecontract.SigningView, error) {
	view, err := s.view(ctx, organizationID, record, document)
	if err != nil {
		return carecontract.SigningView{}, err
	}
	ends, err := s.periods().withdrawalEnd(ctx, record.Summary.SchoolID.Int64(), signature.SignedAt)
	if err != nil {
		return carecontract.SigningView{}, err
	}
	signature.WithdrawalEndsOn = &ends
	// Signed: nothing waits and nothing is left to compare.
	view.Signature, view.AwaitsSignature, view.Previous = &signature, false, nil
	return view, nil
}

// confirm enqueues the confirmation mail: the signed PDF, when and by whom
// it was signed, its checksum and the withdrawal notice on a durable medium
// (§ 312f section 2 BGB).
func (s *Signatures) confirm(ctx context.Context, organizationID int64, record ContractRecord, document StoredDocument,
	view carecontract.SigningView, party carecontract.Party) error {
	if strings.TrimSpace(party.Email) == "" {
		return nil
	}
	address, err := deliveryAddress(ctx, s.store, organizationID, record.Summary.ID.Int64(), party.Email)
	if err != nil {
		return err
	}
	letterhead, err := s.ports.Sender.TraegerLetterhead(ctx, organizationID)
	if err != nil {
		return fmt.Errorf("care contract: letterhead: %w", err)
	}
	if letterheadMissing(issuedSender(letterhead, record)) {
		return carecontract.ErrLetterheadMissing
	}
	signature := view.Signature
	_, err = s.ports.Post.EnqueueContractMail(ctx, carecontract.ContractMail{
		OrganizationID: organizationID, ContractID: record.Summary.ID.Int64(), Recipient: address,
		GuardianName: fullName(party.FirstName, party.LastName), TraegerName: view.TraegerName,
		ChildName: fullName(record.Version.ChildFirstName, record.Version.ChildLastName),
		Modules:   carecontract.JoinNames(ModuleNames(record.Version.Services)), Filename: document.File.Filename, PDF: document.File.Data,
		IdempotencyKey: fmt.Sprintf("care-contract:%d:signed:%d", record.Summary.ID, record.Version.ID),
		Purpose:        carecontract.MailPurposeSigned, SignerName: signature.SignerName,
		SignedAt: berlinStamp(signature.SignedAt), DocumentSHA256: document.SHA256, EarlyStart: signature.EarlyStartRequested,
		WithdrawalEndsOn: germanDate(*signature.WithdrawalEndsOn), WithdrawalNotice: view.WithdrawalNotice,
	})
	if err != nil {
		return fmt.Errorf("care contract: enqueue confirmation: %w", err)
	}
	return nil
}

func (s *Signatures) view(ctx context.Context, organizationID int64, record ContractRecord, document StoredDocument) (carecontract.SigningView, error) {
	letterhead, err := s.ports.Sender.TraegerLetterhead(ctx, organizationID)
	if err != nil {
		return carecontract.SigningView{}, fmt.Errorf("care contract: letterhead: %w", err)
	}
	reach, err := s.ports.Sender.WithdrawalReach(ctx, organizationID)
	if err != nil {
		return carecontract.SigningView{}, fmt.Errorf("care contract: withdrawal reach: %w", err)
	}
	// The signing page names the body that issued the PDF it shows (#4811).
	if issuer, _ := issuedBy(record); issuer != nil {
		letterhead, reach = issuer.SenderText, issuer.Reach()
	}
	// A contract is sent only with a named party, so one of both is set.
	traeger := traegerName(letterhead, record.Version.Terms)
	partner := firstText(record.Version.Terms.ContractPartner, traeger)
	party, _ := recipient(record.Parties)
	previous, amendment, err := s.previousVersion(ctx, organizationID, record)
	if err != nil {
		return carecontract.SigningView{}, err
	}
	return carecontract.SigningView{
		ContractID: record.Summary.ID, OrganizationID: ident.ID(organizationID), Status: record.Summary.Status,
		TraegerName: traeger, PartyName: fullName(party.FirstName, party.LastName), Version: signingContract(record.Version),
		DocumentSHA256: document.SHA256, WithdrawalNotice: withdrawalNoticeParagraphs(withdrawalAddressee(partner, letterhead, reach)),
		Previous: previous, AwaitsSignature: awaitsSignature(record), Amendment: amendment,
	}, nil
}

// previousVersion is the version the parents have before the changed one
// that waits for their signature (#4816), so the page shows what changes:
// of an active contract the version in force on the day the change holds
// from, of a contract not signed yet the version sent before. Nil for a
// first version and for a version that does not wait. The second answer
// is the signature scope from the stored history, including after signing.
func (s *Signatures) previousVersion(ctx context.Context, organizationID int64, record ContractRecord) (*carecontract.SigningContract, bool, error) {
	if record.Version.Number <= 1 {
		return nil, false, nil
	}
	versions, err := s.store.Versions(ctx, organizationID, record.Summary.ID.Int64())
	if err != nil {
		return nil, false, err
	}
	amendment := amendsConcludedVersion(record.Version, versions)
	if !awaitsSignature(record) {
		return nil, amendment, nil
	}
	day := record.Version.EffectiveFrom
	if today := calendar.DateFromTime(s.clock.now()); day.Before(today) {
		day = today
	}
	var previous *carecontract.Version
	for i, version := range versions {
		inForce := version.Status == carecontract.VersionEffective || version.Status == carecontract.VersionSuperseded
		switch {
		case record.Summary.Status == carecontract.StatusSent:
			if version.Status == carecontract.VersionOvertaken && version.Number < record.Version.Number {
				previous = &versions[i]
			}
		case inForce && !version.EffectiveFrom.After(day) && (previous == nil || version.EffectiveFrom.After(previous.EffectiveFrom)):
			previous = &versions[i]
		}
	}
	if previous == nil {
		return nil, amendment, nil
	}
	contract := signingContract(*previous)
	return &contract, amendment, nil
}

// An unsigned version overtaken before the first conclusion is no contract
// to amend. Replaced concluded versions still establish the original scope.
func amendsConcludedVersion(current carecontract.Version, versions []carecontract.Version) bool {
	for _, version := range versions {
		if version.Number < current.Number && (version.Status == carecontract.VersionEffective ||
			version.Status == carecontract.VersionSuperseded || version.Status == carecontract.VersionReplaced) {
			return true
		}
	}
	return false
}

func berlinStamp(at time.Time) string {
	return at.In(calendar.Berlin).Format("02.01.2006, 15:04") + " Uhr"
}

func signingContract(version carecontract.Version) carecontract.SigningContract {
	services := make([]carecontract.SigningService, len(version.Services))
	for i, service := range version.Services {
		services[i] = carecontract.SigningService{
			Weekday: service.Weekday, ModuleName: service.ModuleName, EndsAt: service.EndsAt, LastDay: service.LastDay,
		}
	}
	return carecontract.SigningContract{
		ChildFirstName: version.ChildFirstName, ChildLastName: version.ChildLastName,
		SchoolName: version.SchoolName, PhaseName: version.PhaseName,
		EffectiveFrom: version.EffectiveFrom, EndsOn: version.EndsOn, PriceCents: signingPrice(version.PriceCents), Services: services,
	}
}

// signingPrice is the monthly price as the signing view counts it; the wire
// keeps the JSON number.
func signingPrice(cents *int64) *int {
	if cents == nil {
		return nil
	}
	price := int(*cents)
	return &price
}
