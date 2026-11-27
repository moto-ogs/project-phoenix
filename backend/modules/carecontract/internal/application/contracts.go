package application

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

const maxSendBatch = 200

// Contracts serves carecontract.Contracts. The writes run in the caller's
// Träger transaction. The reads (list, detail, PDF) open their own units: the
// Träger transaction for the contracts, then the tenant transaction of every
// school whose contracts they showed, for that school's access log (ADR 0088
// section 7, ADR 0084 section 7). No transaction holds both (ADR 0105).
type Contracts struct {
	store       ContractStore
	letterheads carecontract.Letterheads
	renderer    LetterRenderer
	post        carecontract.Post
	clock       Clock
	runtime     carecontract.Runtime
	access      carecontract.SchoolAccessLog
	ledger      carecontract.SignatureLedger
	links       carecontract.SigningLinks
	versions    carecontract.ContractVersions
	notices     carecontract.DocumentNotices
	issuers     carecontract.SchoolIssuers
	periods     withdrawalPeriods
}

// ContractPorts are the root-bound ports of the contracts. Ledger and
// Links serve the signature (#4679, contract_signature.go).
type ContractPorts struct {
	Letterheads carecontract.Letterheads
	Post        carecontract.Post
	Runtime     carecontract.Runtime
	Access      carecontract.SchoolAccessLog
	Ledger      carecontract.SignatureLedger
	Links       carecontract.SigningLinks
	// Notices puts the push of a first send on the outbox (#5941). The
	// roots bind it; a composition without it sends no push.
	Notices carecontract.DocumentNotices
	// Holidays dates the withdrawal period of a signature at the school.
	Holidays carecontract.SchoolHolidays
	// Issuers names the Schulträger or the Gemeinde that concludes the
	// contracts of a school (#4811). The roots bind it; a composition
	// without it knows only the Träger.
	Issuers carecontract.SchoolIssuers
}

var _ carecontract.Contracts = (*Contracts)(nil)

func NewContracts(store ContractStore, renderer LetterRenderer, ports ContractPorts, clock Clock, versions carecontract.ContractVersions) *Contracts {
	requireClock(clock, "contracts")
	if store == nil || renderer == nil || ports.Letterheads == nil || ports.Post == nil || ports.Runtime == nil || ports.Access == nil ||
		ports.Ledger == nil || ports.Links.Tokens == nil || ports.Links.Fingerprint == nil || versions == nil || ports.Holidays == nil {
		panic("care contract: the store, the renderer, the letterhead, the post, the runtime, the access log, the ledger, the link tokens, the versions and the school holidays are required")
	}
	return &Contracts{store: store, letterheads: ports.Letterheads, renderer: renderer, post: ports.Post, clock: clock,
		runtime: ports.Runtime, access: ports.Access, ledger: ports.Ledger, links: ports.Links, versions: versions, notices: ports.Notices, issuers: ports.Issuers,
		periods: withdrawalPeriods{holidays: ports.Holidays}}
}

// ListContracts lists the contracts of the filter, records the read in the
// trail and in the access log of every school it shows contracts of.
func (c *Contracts) ListContracts(ctx context.Context, reviewer carecontract.Reviewer, filter carecontract.ContractFilter) (carecontract.ContractList, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.ContractList{}, err
	}
	maxLimit, view := 100, "list"
	if filter.Export {
		// The export (#4718) holds the whole filter or nothing.
		filter.Offset, filter.Limit, filter.Revision = 0, carecontract.ContractExportLimit, ""
		maxLimit, view = carecontract.ContractExportLimit, "export"
	}
	var list carecontract.ContractList
	err := c.runtime.WithinTraeger(ctx, reviewer.OrganizationID, func(txCtx context.Context) error {
		var err error
		list, err = c.listContracts(txCtx, reviewer, filter, maxLimit, view)
		return err
	})
	if err != nil {
		return carecontract.ContractList{}, err
	}
	if filter.Export && list.HasMore {
		return carecontract.ContractList{}, carecontract.InvalidSelection("contracts", "export_too_large")
	}
	bySchool := map[int64][]int64{}
	for _, contract := range list.Contracts {
		bySchool[contract.SchoolID.Int64()] = append(bySchool[contract.SchoolID.Int64()], contract.ID.Int64())
	}
	if err := c.logSchools(ctx, reviewer, "care_contract_"+view, bySchool); err != nil {
		return carecontract.ContractList{}, err
	}
	return list, nil
}

// Contract reads one contract with the state of its mails and records the
// read in the access log of its school.
func (c *Contracts) Contract(ctx context.Context, reviewer carecontract.Reviewer, contractID int64) (carecontract.ContractDetail, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.ContractDetail{}, err
	}
	var detail carecontract.ContractDetail
	err := c.runtime.WithinTraeger(ctx, reviewer.OrganizationID, func(txCtx context.Context) error {
		var err error
		detail, err = c.contract(txCtx, reviewer, contractID)
		return err
	})
	if err != nil {
		return carecontract.ContractDetail{}, err
	}
	return detail, c.logSchools(ctx, reviewer, "care_contract_detail", map[int64][]int64{detail.SchoolID.Int64(): {detail.ID.Int64()}})
}

// ContractDocument answers the PDF and records the read in the access log
// of the contract's school.
func (c *Contracts) ContractDocument(ctx context.Context, reviewer carecontract.Reviewer, contractID int64) (carecontract.File, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.File{}, err
	}
	var file carecontract.File
	var schoolID int64
	err := c.runtime.WithinTraeger(ctx, reviewer.OrganizationID, func(txCtx context.Context) error {
		var err error
		file, schoolID, err = c.contractDocument(txCtx, reviewer, contractID)
		return err
	})
	if err != nil {
		return carecontract.File{}, err
	}
	return file, c.logSchools(ctx, reviewer, "care_contract_document", map[int64][]int64{schoolID: {contractID}})
}

// logSchools writes one entry per school into that school's access log, in
// the school's own tenant transaction, after the Träger transaction ended.
// A failed entry fails the read: no contract leaves without its entry.
func (c *Contracts) logSchools(ctx context.Context, reviewer carecontract.Reviewer, view string, bySchool map[int64][]int64) error {
	schools := make([]int64, 0, len(bySchool))
	for school := range bySchool {
		if school > 0 {
			schools = append(schools, school)
		}
	}
	slices.Sort(schools)
	for _, school := range schools {
		ids := bySchool[school]
		err := c.runtime.WithinSchool(ctx, school, func(txCtx context.Context) error {
			return c.access.RecordAccess(txCtx, carecontract.SchoolAccess{
				OrganizationID: reviewer.OrganizationID, AccountID: reviewer.AccountID,
				Data: carecontract.SchoolAccessContracts, View: view, Rows: len(ids), ContractIDs: ids,
			})
		})
		if err != nil {
			return fmt.Errorf("care contract: access log of school %d: %w", school, err)
		}
	}
	return nil
}

// listContracts reads one page of the filter, at most maxLimit contracts,
// and writes the read into the Träger trail under view.
func (c *Contracts) listContracts(ctx context.Context, reviewer carecontract.Reviewer, filter carecontract.ContractFilter, maxLimit int, view string) (carecontract.ContractList, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.ContractList{}, err
	}
	if err := knownSelection(filter); err != nil {
		return carecontract.ContractList{}, err
	}
	if filter.Offset < 0 || filter.Limit < 0 || filter.Limit > maxLimit {
		return carecontract.ContractList{}, carecontract.InvalidSelection("contracts", "invalid_pagination")
	}
	if filter.Limit == 0 {
		filter.Limit = 50
	}
	filter.Search = strings.TrimSpace(filter.Search)
	contracts, revision, err := c.store.ListContracts(ctx, reviewer.OrganizationID, filter)
	if err != nil {
		return carecontract.ContractList{}, fmt.Errorf("care contract: list: %w", err)
	}
	hasMore := len(contracts) > filter.Limit
	if hasMore {
		contracts = contracts[:filter.Limit]
	}
	counts, err := c.store.CountContracts(ctx, reviewer.OrganizationID)
	if err != nil {
		return carecontract.ContractList{}, fmt.Errorf("care contract: count: %w", err)
	}
	if len(contracts) > 0 {
		ids := make([]int64, len(contracts))
		for i, contract := range contracts {
			ids[i] = contract.ID.Int64()
		}
		if err := trail(ctx, c.store, reviewer.OrganizationID, reviewer.AccountID, 0, 0, ActionRead,
			map[string]any{"view": view, "contract_ids": ids}); err != nil {
			return carecontract.ContractList{}, err
		}
	}
	return carecontract.ContractList{Contracts: contracts, Counts: counts, HasMore: hasMore, Revision: revision}, nil
}

func (c *Contracts) contract(ctx context.Context, reviewer carecontract.Reviewer, contractID int64) (carecontract.ContractDetail, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.ContractDetail{}, err
	}
	record, err := c.store.Contract(ctx, reviewer.OrganizationID, contractID, false)
	if err != nil {
		return carecontract.ContractDetail{}, err
	}
	detail, err := c.detail(ctx, reviewer, record)
	if err != nil {
		return carecontract.ContractDetail{}, err
	}
	if err := trailContract(ctx, c.store, reviewer.OrganizationID, reviewer.AccountID, record, ActionRead, map[string]any{"view": "detail"}); err != nil {
		return carecontract.ContractDetail{}, err
	}
	return detail, nil
}

func (c *Contracts) detail(ctx context.Context, reviewer carecontract.Reviewer, record ContractRecord) (carecontract.ContractDetail, error) {
	mailings, err := c.mailings(ctx, reviewer.OrganizationID, record.Summary.ID.Int64())
	if err != nil {
		return carecontract.ContractDetail{}, err
	}
	versions, err := c.store.Versions(ctx, reviewer.OrganizationID, record.Summary.ID.Int64())
	if err != nil {
		return carecontract.ContractDetail{}, err
	}
	current, err := c.versionToday(ctx, reviewer.OrganizationID, record)
	if err != nil {
		return carecontract.ContractDetail{}, err
	}
	corrections := []carecontract.ContractCorrection{}
	if record.Concluded != nil && record.Concluded.TakenOver {
		// Only a contract from an import carries corrections (#7767).
		if corrections, err = c.store.ContractCorrections(ctx, reviewer.OrganizationID, record.Summary.ID.Int64()); err != nil {
			return carecontract.ContractDetail{}, err
		}
	}
	detail := carecontract.ContractDetail{
		ContractSummary: record.Summary, Version: current, Parties: record.Parties,
		Mailings: mailings, DocumentFrozen: record.DocumentID != nil, Versions: versions,
		TermText: TermText(current.Terms, contractEnd(versions, current)), NoticeText: NoticeText(current.Terms),
		FeeText: feeText(current), Corrections: corrections,
	}
	if detail.VersionSignatures, err = c.store.VersionSignatures(ctx, reviewer.OrganizationID, record.Summary.ID.Int64()); err != nil {
		return carecontract.ContractDetail{}, err
	}
	return detail, c.addSignature(ctx, reviewer.OrganizationID, record, &detail)
}

// versionToday is the version the billing takes for today (#4681, #4684),
// read through the same ContractVersions, so the page and the billing never
// disagree; before the conclusion, or before the contract starts, it is the
// contract's current version.
func (c *Contracts) versionToday(ctx context.Context, organizationID int64, record ContractRecord) (carecontract.Version, error) {
	today := calendar.DateFromTime(c.clock.now())
	periods, err := c.versions.VersionsInForce(ctx, organizationID, today, today, record.Summary.ID.Int64())
	if err != nil || len(periods) == 0 {
		return record.Version, err
	}
	return periods[0].Version, nil
}

// mailings are the sends of the contract, newest first, with the state of
// their mail. A mail the outbox no longer holds is unknown (ADR 0123).
func (c *Contracts) mailings(ctx context.Context, organizationID, contractID int64) ([]carecontract.Mailing, error) {
	stored, err := c.store.Mailings(ctx, organizationID, contractID)
	if err != nil || len(stored) == 0 {
		return []carecontract.Mailing{}, err
	}
	states, err := c.post.ContractMailStates(ctx, organizationID, contractID)
	if err != nil {
		return nil, fmt.Errorf("care contract: mail states: %w", err)
	}
	byOutbox := make(map[int64]carecontract.MailState, len(states))
	for _, state := range states {
		byOutbox[state.OutboxID] = state
	}
	mailings := make([]carecontract.Mailing, len(stored))
	for i, mailing := range stored {
		state, ok := byOutbox[mailing.OutboxID]
		if !ok {
			state = carecontract.MailState{State: carecontract.MailUnknown}
		}
		mailings[i] = carecontract.Mailing{Recipient: mailing.Recipient, SentAt: mailing.SentAt, State: state.State, Outcome: state.Outcome, OutboxID: mailing.OutboxID}
	}
	if mailings[0].SendBlock, err = c.post.ContractMailBlock(ctx, organizationID, mailings[0].Recipient, mailings[0].Outcome); err != nil {
		return nil, fmt.Errorf("care contract: mail block: %w", err)
	}
	return mailings, nil
}

// contractDocument answers the stored PDF of a sent contract and, for a
// draft, a preview with the current template that stores nothing, with the
// contract's school.
func (c *Contracts) contractDocument(ctx context.Context, reviewer carecontract.Reviewer, contractID int64) (carecontract.File, int64, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.File{}, 0, err
	}
	record, err := c.store.Contract(ctx, reviewer.OrganizationID, contractID, false)
	if err != nil {
		return carecontract.File{}, 0, err
	}
	var file carecontract.File
	if record.DocumentID != nil {
		file, _, err = c.store.VersionDocument(ctx, reviewer.OrganizationID, record.Version.ID.Int64())
	} else {
		file, _, err = c.render(ctx, reviewer, record, draftPreview(record))
	}
	if err != nil {
		return carecontract.File{}, 0, err
	}
	view := "document"
	if record.DocumentID == nil {
		view = "preview"
	}
	if err := trailContract(ctx, c.store, reviewer.OrganizationID, reviewer.AccountID, record, ActionRead, map[string]any{"view": view}); err != nil {
		return carecontract.File{}, 0, err
	}
	return file, record.Summary.SchoolID.Int64(), nil
}

// render lays out the contract with the current letterhead and template. A
// preview carries the preview note; the PDF a send or handover freezes never
// does (#8030).
func (c *Contracts) render(ctx context.Context, reviewer carecontract.Reviewer, record ContractRecord, preview bool) (carecontract.File, int, error) {
	file, templateVersion, _, err := c.renderIssued(ctx, reviewer, record, preview)
	return file, templateVersion, err
}

// renderIssued renders the PDF and names the body it printed as sender, nil
// for the Träger, so the stored PDF keeps exactly that body (#4811).
func (c *Contracts) renderIssued(ctx context.Context, reviewer carecontract.Reviewer, record ContractRecord, preview bool) (carecontract.File, int, *carecontract.Issuer, error) {
	head, issuer, err := c.letterhead(ctx, reviewer, record)
	if err != nil {
		return carecontract.File{}, 0, nil, err
	}
	if firstText(record.Version.Terms.ContractPartner, firstLine(textLines(head.SenderText))) == "" {
		return carecontract.File{}, 0, nil, &carecontract.ValidationError{Fields: map[string]string{"contract_partner": "required"}}
	}
	letter := contractLetter(record, head)
	if preview {
		letter = previewLetter(letter)
	}
	file, err := c.renderer.RenderContract(letter, documentFilenameBase(record))
	if err != nil {
		return carecontract.File{}, 0, nil, fmt.Errorf("care contract: render: %w", err)
	}
	return file, head.Template.Version, issuer, nil
}

// letterhead is the letterhead the contract prints and its mails name: the
// Träger's, or on it the body that concludes the contracts of the school
// (#4811), which it returns as well, nil for the Träger. A frozen PDF keeps
// its body.
func (c *Contracts) letterhead(ctx context.Context, reviewer carecontract.Reviewer, record ContractRecord) (carecontract.Letterhead, *carecontract.Issuer, error) {
	head, err := c.letterheads.Letterhead(ctx, reviewer)
	if err != nil {
		return carecontract.Letterhead{}, nil, fmt.Errorf("care contract: letterhead: %w", err)
	}
	issuer, err := contractIssuer(ctx, c.issuers, reviewer.OrganizationID, record)
	if err != nil {
		return carecontract.Letterhead{}, nil, err
	}
	return issuedLetterhead(head, issuer), issuer, nil
}

// SendContracts sends every contract of the list once. A contract that
// cannot be sent is left out with its reason; the others go.
func (c *Contracts) SendContracts(ctx context.Context, reviewer carecontract.Reviewer, contractIDs []int64) (carecontract.SendResult, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.SendResult{}, err
	}
	ids := uniqueIDs(contractIDs)
	if len(ids) == 0 || len(ids) > maxSendBatch {
		return carecontract.SendResult{}, carecontract.InvalidSelection("contract_ids", "count")
	}
	return c.sendContracts(ctx, reviewer, ids, "")
}

// ResendContract changes the delivery destination only after a failed send.
func (c *Contracts) ResendContract(ctx context.Context, reviewer carecontract.Reviewer, contractID int64, email string) (carecontract.SendResult, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.SendResult{}, err
	}
	if contractID <= 0 {
		return carecontract.SendResult{}, carecontract.InvalidSelection("contract_ids", "count")
	}
	address := strings.TrimSpace(email)
	parsed, err := mail.ParseAddress(address)
	if err != nil || address == "" || len(address) > 320 || strings.ContainsAny(email, "\r\n") || parsed.Address != address {
		return carecontract.SendResult{}, &carecontract.ValidationError{Fields: map[string]string{"recipient_email": "invalid"}}
	}
	return c.sendContracts(ctx, reviewer, []int64{contractID}, address)
}

func (c *Contracts) sendContracts(ctx context.Context, reviewer carecontract.Reviewer, ids []int64, destination string) (carecontract.SendResult, error) {
	result := carecontract.SendResult{Sent: []ident.ID{}, Skipped: []carecontract.SendSkip{}}
	// The send holds its transaction, so the whole batch shares the provider's limits.
	ctx = c.post.ShareMailBlockLimit(ctx)
	for _, id := range ids {
		err := c.send(ctx, reviewer, id, destination)
		if err == nil {
			result.Sent = append(result.Sent, ident.ID(id))
			continue
		}
		reason, skipped := sendSkipReason(err)
		if !skipped {
			return carecontract.SendResult{}, err
		}
		result.Skipped = append(result.Skipped, carecontract.SendSkip{ID: ident.ID(id), Reason: reason})
	}
	return result, nil
}

var sendSkips = []struct {
	err    error
	reason string
}{
	{carecontract.ErrRecipientMissing, carecontract.SkipRecipientMissing},
	{carecontract.ErrMailPending, carecontract.SkipMailPending},
	{carecontract.ErrMailDelayed, carecontract.SkipMailDelayed},
	{carecontract.ErrMailBlocked, carecontract.SkipMailBlocked},
	{carecontract.ErrMailBlockUnreadable, carecontract.SkipMailBlockUnreadable},
	{carecontract.ErrContractNotSendable, carecontract.SkipNotSendable},
}

// sendSkipReason names a send failure that the Träger-Büro or the parents can
// fix; any other error is no skip.
func sendSkipReason(err error) (string, bool) {
	if missingContractPartner(err) {
		return carecontract.SkipPartnerMissing, true
	}
	for _, skip := range sendSkips {
		if errors.Is(err, skip.err) {
			return skip.reason, true
		}
	}
	return "", false
}

func missingContractPartner(err error) bool {
	var invalid *carecontract.ValidationError
	return errors.As(err, &invalid) && invalid.Fields["contract_partner"] == "required"
}

// send freezes the PDF of a draft and sends it, or sends the stored PDF of
// a sent contract again. The contract row is locked first, so two sends of
// one contract run one after the other and freeze one PDF.
func (c *Contracts) send(ctx context.Context, reviewer carecontract.Reviewer, contractID int64, destination string) error {
	record, err := c.store.Contract(ctx, reviewer.OrganizationID, contractID, true)
	if err != nil {
		return err
	}
	// A changed version that waits for the signature goes out again with a
	// new link (#4816); any other send repeats the PDF the parents have.
	purpose, err := c.waitingPurpose(ctx, reviewer.OrganizationID, &record)
	if err != nil {
		return err
	}
	if purpose == carecontract.MailPurposeContract {
		if record, err = c.sentVersionRecord(ctx, reviewer.OrganizationID, record); err != nil {
			return err
		}
	}
	return c.deliver(ctx, reviewer, record, destination, purpose)
}

// waitingPurpose points the record of an active contract at its changed
// version that waits for a signature and answers the mail that asks for it;
// MailPurposeContract when none waits.
func (c *Contracts) waitingPurpose(ctx context.Context, organizationID int64, record *ContractRecord) (string, error) {
	if record.Summary.Status != carecontract.StatusActive {
		return carecontract.MailPurposeContract, nil
	}
	waits, err := c.store.WaitingVersion(ctx, organizationID, record)
	if err != nil || !waits {
		return carecontract.MailPurposeContract, err
	}
	return carecontract.MailPurposeAmendment, nil
}

// deliverChange brings a changed version to the parents (#4816): it freezes
// its PDF and sends it the way the contract went out before, by mail and
// into the inbox, with a one-time link when the version waits for the
// signature. A contract that never went out by mail (handed over on paper,
// taken over from a file) and one whose address takes no mail (none, or
// blocked) keep the frozen PDF only, and the trail names why: the
// Träger-Büro hands it over or sends it again. A mail the provider delays
// or cannot be asked about is an error: the caller leaves the change for
// its next run. It acts for no account, like the run that calls it.
func (c *Contracts) deliverChange(ctx context.Context, organizationID int64, record ContractRecord, purpose string) error {
	reviewer := carecontract.Reviewer{OrganizationID: organizationID}
	held := "not_mailed"
	mailings, err := c.store.Mailings(ctx, organizationID, record.Summary.ID.Int64())
	if err != nil {
		return err
	}
	if len(mailings) > 0 {
		err := c.deliver(ctx, reviewer, record, "", purpose)
		reason, _ := sendSkipReason(err)
		if reason != carecontract.SkipRecipientMissing && reason != carecontract.SkipMailBlocked {
			return err
		}
		held = reason
	}
	documentID, err := c.paperDocument(ctx, reviewer, record)
	if err != nil {
		return err
	}
	return trailContract(ctx, c.store, organizationID, 0, record, ActionSend, map[string]any{
		"document_id": documentID, "version_number": record.Version.Number, "purpose": purpose, "mail_held_back": held,
	})
}

// deliver sends the contract read under its row lock: it freezes the PDF of
// a draft, enqueues the mail and records the send. purpose picks the mail:
// the contract itself, or a changed version (#4816), whose PDF is frozen
// here too.
func (c *Contracts) deliver(ctx context.Context, reviewer carecontract.Reviewer, record ContractRecord, destination, purpose string) error {
	contractID := record.Summary.ID
	if !sendable(record, purpose) {
		return carecontract.ErrContractNotSendable
	}
	// The run that follows the bookings sends a changed version although the
	// mail before is still on its way: another PDF, and the old link must not
	// stay the only one (#4816). An office send still waits for it.
	queuedAllowed := purpose != carecontract.MailPurposeContract && reviewer.AccountID == 0
	party, previousSends, err := c.deliveryParty(ctx, reviewer.OrganizationID, record, destination, queuedAllowed)
	if err != nil {
		return err
	}
	head, _, err := c.letterhead(ctx, reviewer, record)
	if err != nil {
		return err
	}
	// The withdrawal notice of the contract and of its signing page takes
	// the Träger's address from the letterhead (#7177).
	if letterheadMissing(head.SenderText) {
		return carecontract.ErrLetterheadMissing
	}
	file, documentID, err := c.frozenDocument(ctx, reviewer, record)
	if err != nil {
		return err
	}
	link, err := c.signingLinkFor(ctx, reviewer.OrganizationID, record, documentID)
	if err != nil {
		return err
	}
	outboxID, err := c.post.EnqueueContractMail(ctx, carecontract.ContractMail{
		OrganizationID: reviewer.OrganizationID, ContractID: contractID.Int64(), Recipient: party.Email,
		GuardianName: fullName(party.FirstName, party.LastName), TraegerName: traegerName(head.SenderText, record.Version.Terms),
		ChildName: fullName(record.Version.ChildFirstName, record.Version.ChildLastName),
		Modules:   carecontract.JoinNames(ModuleNames(record.Version.Services)), Filename: file.Filename, PDF: file.Data,
		IdempotencyKey: fmt.Sprintf("care-contract:%d:%d", contractID, previousSends+1),
		SigningURL:     link.url, LinkExpiresOn: link.expiresOn,
		Concluded: record.Concluded != nil, Purpose: purpose, EffectiveFrom: germanDate(record.Version.EffectiveFrom),
	})
	if err != nil {
		return fmt.Errorf("care contract: enqueue mail: %w", err)
	}
	if err := c.enqueueDocumentNotice(ctx, reviewer.OrganizationID, contractID.Int64(), party.Email); err != nil {
		return err
	}
	now := c.clock.now()
	if err := c.store.InsertMailing(ctx, reviewer.OrganizationID, reviewer.AccountID, contractID.Int64(), documentID, outboxID, party.Email, now); err != nil {
		return err
	}
	if record.Summary.Status == carecontract.StatusDraft {
		if err := c.store.MarkSent(ctx, reviewer.OrganizationID, contractID.Int64(), now); err != nil {
			return err
		}
	}
	return trailContract(ctx, c.store, reviewer.OrganizationID, reviewer.AccountID, record, ActionSend, map[string]any{
		"document_id": documentID, "again": previousSends > 0, "version_number": record.Version.Number, "purpose": purpose,
	})
}

// sendable tells whether the contract goes out: a draft, a sent or an
// active one. An active contract repeats its stored PDF; only a changed
// version (#4816) gets its PDF frozen with the send.
func sendable(record ContractRecord, purpose string) bool {
	switch record.Summary.Status {
	case carecontract.StatusDraft, carecontract.StatusSent:
		return true
	case carecontract.StatusActive:
		return record.DocumentID != nil || purpose != carecontract.MailPurposeContract
	}
	return false
}

// deliveryParty keeps delivery corrections separate from the frozen party.
// A failed destination is corrected by a new mailing, never by editing history.
func (c *Contracts) deliveryParty(ctx context.Context, organizationID int64, record ContractRecord, destination string, queuedAllowed bool) (carecontract.Party, int, error) {
	party, ok := recipient(record.Parties)
	if !ok {
		return carecontract.Party{}, 0, carecontract.ErrRecipientMissing
	}
	mailings, err := c.mailings(ctx, organizationID, record.Summary.ID.Int64())
	if err != nil {
		return carecontract.Party{}, 0, err
	}
	if len(mailings) > 0 && mailings[0].State == carecontract.MailQueued && !queuedAllowed {
		return carecontract.Party{}, 0, carecontract.ErrMailPending
	}
	if destination != "" && ((record.Summary.Status != carecontract.StatusSent && record.Summary.Status != carecontract.StatusActive) || record.DocumentID == nil || len(mailings) == 0 || mailings[0].State != carecontract.MailFailed) {
		return carecontract.Party{}, 0, carecontract.ErrContractNotSendable
	}
	if len(mailings) > 0 {
		party.Email = mailings[0].Recipient
	}
	if destination != "" {
		party.Email = destination
	}
	if err := c.refuseHeldMail(ctx, organizationID, party.Email, mailings); err != nil {
		return carecontract.Party{}, 0, err
	}
	return party, len(mailings), nil
}

// refuseHeldMail stops a mail that would stay back or arrive twice. The state of the
// address now decides, not what became of an older mail: an address without a mail
// has no history of its own, and one the contract already went to keeps it, however
// the correction spells it.
func (c *Contracts) refuseHeldMail(ctx context.Context, organizationID int64, address string, mailings []carecontract.Mailing) error {
	block, err := c.mailBlock(ctx, organizationID, address, mailings)
	if err != nil {
		return fmt.Errorf("care contract: mail block: %w", err)
	}
	switch block {
	case "":
		return nil
	case carecontract.MailBlockDelayed:
		return carecontract.ErrMailDelayed
	case carecontract.MailBlockUnreadable:
		return carecontract.ErrMailBlockUnreadable
	default:
		return carecontract.ErrMailBlocked
	}
}

// mailBlock reads the block of the address with the result of its newest mail. The
// newest mailing of all already holds its block.
func (c *Contracts) mailBlock(ctx context.Context, organizationID int64, address string, mailings []carecontract.Mailing) (string, error) {
	for i, mailing := range mailings {
		if !sameMailAddress(mailing.Recipient, address) {
			continue
		}
		if i == 0 {
			return mailing.SendBlock, nil
		}
		return c.post.ContractMailBlock(ctx, organizationID, address, mailing.Outcome)
	}
	return c.post.ContractMailBlock(ctx, organizationID, address, "")
}

func sameMailAddress(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}

// frozenDocument is the stored PDF, rendered and stored at the first send
// or the handover on paper (#8030).
func (c *Contracts) frozenDocument(ctx context.Context, reviewer carecontract.Reviewer, record ContractRecord) (carecontract.File, int64, error) {
	if record.DocumentID != nil {
		// The PDF of the record's version: a changed version that waits has
		// one of its own next to the PDF of the version in force (#4816).
		file, _, err := c.store.VersionDocument(ctx, reviewer.OrganizationID, record.Version.ID.Int64())
		return file, *record.DocumentID, err
	}
	// The PDF keeps the body that issued it (#4811): the one it prints.
	file, templateVersion, issuer, err := c.renderIssued(ctx, reviewer, record, false)
	if err != nil {
		return carecontract.File{}, 0, err
	}
	id, err := c.store.InsertDocument(ctx, reviewer.OrganizationID, reviewer.AccountID, record, templateVersion, file, issuer)
	return file, id, err
}

// paperDocument freezes the PDF of a contract handed over on paper and
// answers its ID; a frozen one stays. Like a send, a new PDF needs the
// letterhead: its withdrawal notice names the Träger's address (#7177).
func (c *Contracts) paperDocument(ctx context.Context, reviewer carecontract.Reviewer, record ContractRecord) (int64, error) {
	if record.DocumentID != nil {
		return *record.DocumentID, nil
	}
	// The letterhead of the body that concludes the school's contracts.
	head, _, err := c.letterhead(ctx, reviewer, record)
	if err != nil {
		return 0, err
	}
	if letterheadMissing(head.SenderText) {
		return 0, carecontract.ErrLetterheadMissing
	}
	_, documentID, err := c.frozenDocument(ctx, reviewer, record)
	return documentID, err
}

// DiscardContract removes a draft. The trail keeps the entry.
func (c *Contracts) DiscardContract(ctx context.Context, reviewer carecontract.Reviewer, contractID int64) error {
	if err := checkReviewer(reviewer); err != nil {
		return err
	}
	record, err := c.store.Contract(ctx, reviewer.OrganizationID, contractID, true)
	if err != nil {
		return err
	}
	if record.Summary.Status != carecontract.StatusDraft {
		return carecontract.ErrContractNotDraft
	}
	deleted, err := c.store.DeleteDraft(ctx, reviewer.OrganizationID, contractID)
	if err != nil {
		return err
	}
	if !deleted {
		return carecontract.ErrContractNotDraft
	}
	return trailContract(ctx, c.store, reviewer.OrganizationID, reviewer.AccountID, record, ActionDiscard, map[string]any{"status": record.Summary.Status})
}

func recipient(parties []carecontract.Party) (carecontract.Party, bool) {
	for _, party := range parties {
		if strings.TrimSpace(party.Email) != "" {
			return party, true
		}
	}
	return carecontract.Party{}, false
}

func checkReviewer(reviewer carecontract.Reviewer) error {
	if reviewer.OrganizationID <= 0 || reviewer.AccountID <= 0 {
		return errors.New("care contract: the reviewer needs a Träger and an account")
	}
	return nil
}

// knownSelection refuses a status or a column of the order the list does
// not know.
func knownSelection(filter carecontract.ContractFilter) error {
	if filter.Status != "" && !knownStatus(filter.Status) {
		return carecontract.InvalidSelection("status", "unknown")
	}
	if filter.Sort != "" && !slices.Contains(carecontract.ContractSorts, filter.Sort) {
		return carecontract.InvalidSelection("sort", "unknown")
	}
	return nil
}

func knownStatus(status string) bool {
	return slices.Contains(carecontract.Statuses, status)
}

// uniqueIDs keeps every positive ID once, in ascending order. A send locks
// each contract row until its transaction ends; the fixed order keeps two
// overlapping batches, [1, 2] and [2, 1], from waiting on each other.
func uniqueIDs(ids []int64) []int64 {
	result := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id > 0 && !slices.Contains(result, id) {
			result = append(result, id)
		}
	}
	slices.Sort(result)
	return result
}

// contractEnd is the last day of the contract: the end of its newest
// effective version, by effective date. A version ends the day before a
// module switch, which is no end of the contract (#4681).
func contractEnd(versions []carecontract.Version, current carecontract.Version) *calendar.Date {
	var newest *carecontract.Version
	for i, version := range versions {
		if version.Status != carecontract.VersionEffective && version.Status != carecontract.VersionSuperseded {
			continue
		}
		if newest == nil || version.EffectiveFrom.After(newest.EffectiveFrom) {
			newest = &versions[i]
		}
	}
	if newest == nil {
		return current.EndsOn
	}
	return newest.EndsOn
}
