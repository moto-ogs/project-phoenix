package application

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The guards of the signature (#4679) over the real store: the Träger
// filter of the paper contract beneath RLS, the single use of a link, and
// the races of a paper signature against the acceptance (#4680) and of the
// paper handover against the discard of the draft (#8030), in two real
// Träger transactions.

type guardSender struct{}

func (guardSender) TraegerLetterhead(context.Context, int64) (string, error) {
	return "Ganztag im Quartier e.V.\nAm Markt 4", nil
}

func (guardSender) WithdrawalReach(context.Context, int64) (carecontract.WithdrawalReach, error) {
	return carecontract.WithdrawalReach{}, nil
}

// signatures binds the paper signature of the fixture's contracts.
func (f raceFixture) signatures() *Signatures {
	return NewSignatures(postgres.NewStore(calendar.TodayDate), SignaturePorts{
		Ledger: struct{ carecontract.SignatureLedger }{}, Links: f.contracts.links, Sender: guardSender{},
		Post: &racePost{next: time.Now().UnixNano()}, Runtime: raceRuntime{}, Holidays: schoolHolidays{}, Families: familyNumbersDouble{},
	}, f.contracts.clock, f.contracts)
}

func paperOf(name string) carecontract.PaperInput {
	return carecontract.PaperInput{SignerName: name, Filename: "vertrag.pdf", PDF: []byte("%PDF-1.4 unterschrieben"),
		SignedOn: calendar.NewDate(2026, 11, 2)}
}

// handOver hands the fixture's draft over on paper (#8030): its PDF is
// frozen and it is versendet without a mail.
func (f raceFixture) handOver(t *testing.T) {
	t.Helper()
	require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
		return f.signatures().HandOverOnPaper(txCtx, f.reviewer, f.contract)
	}))
}

func (f raceFixture) signedPapers(t *testing.T) int {
	t.Helper()
	var n int
	require.NoError(t, f.db.NewRaw(`SELECT COUNT(*) FROM care_contract.contract_signatures WHERE contract_id = ?`, f.contract).
		Scan(context.Background(), &n))
	return n
}

// TestPaperSignatureOfAnotherTraegerFindsNothingBeneathRLS pins the Träger
// filter of the paper contract in the application and the store, beneath
// RLS: Träger B hands a draft of Träger A over on paper or records its paper
// contract and finds nothing; A's draft keeps no PDF and no signature. It
// goes red when the store reads the contract without its organization.
func TestPaperSignatureOfAnotherTraegerFindsNothingBeneathRLS(t *testing.T) {
	t.Parallel()
	f := newRaceFixture(t, "Träger Papier A")
	other := testpkg.CreateTestOrganization(t, f.db, &testpkg.Organization{
		Name: "Träger Papier B", Slug: fmt.Sprintf("traeger-papier-b-%d", testpkg.UniqueTestTenantID(t)),
	}).ID
	testpkg.OwnTraegerCareContracts(t, f.db, other)
	foreign := carecontract.Reviewer{OrganizationID: other, AccountID: f.reviewer.AccountID}

	for name, write := range map[string]func(context.Context) error{
		"handover": func(txCtx context.Context) error { return f.signatures().HandOverOnPaper(txCtx, foreign, f.contract) },
		"signature": func(txCtx context.Context) error {
			return f.signatures().RecordPaperSignature(txCtx, foreign, f.contract, paperOf("Fremde Person"))
		},
	} {
		err := testpkg.WithinTraeger(f.ctx, other, func(txCtx context.Context) error {
			// As the owner of the tables, beneath RLS: only the store's own
			// Träger filter keeps A's contract out.
			require.NoError(t, testpkg.WithoutRequestRole(txCtx))
			return write(txCtx)
		})
		require.ErrorIs(t, err, carecontract.ErrContractNotFound, "%s: another Träger's contract is not found", name)
	}
	s := f.state(t)
	assert.Equal(t, carecontract.StatusDraft, s.status, "A's draft stays a draft")
	assert.Zero(t, s.documents, "no PDF frozen for another Träger")
	assert.Zero(t, f.signedPapers(t), "no signature for another Träger")
}

// TestSigningLinkClosesOnce pins the single use of a link in the store: a
// link once used can never be used again, even while its contract could
// still be signed. It goes red when the update closes a used link again.
func TestSigningLinkClosesOnce(t *testing.T) {
	t.Parallel()
	f := newRaceFixture(t, "Träger Link einmal")
	store := postgres.NewStore(calendar.TodayDate)
	require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
		_, err := f.contracts.SendContracts(txCtx, f.reviewer, []int64{f.contract})
		return err
	}))
	err := testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
		link, found, err := store.LatestSigningLink(txCtx, f.org, f.contract)
		if err != nil || !found {
			return fmt.Errorf("the send made no link: %w", err)
		}
		now := f.contracts.clock.now()
		if err := store.UseSigningLink(txCtx, f.org, link.ID, now); err != nil {
			return fmt.Errorf("first use: %w", err)
		}
		return store.UseSigningLink(txCtx, f.org, link.ID, now.Add(time.Second))
	})
	require.ErrorIs(t, err, carecontract.ErrSigningLinkInvalid, "the second use of the same link fails")
}

// paperLoss reports an error a losing paper signature may end with.
func paperLoss(err error) bool {
	return errors.Is(err, carecontract.ErrContractNotSignable) || errors.Is(err, carecontract.ErrContractNotFound)
}

// TestPaperSignatureAgainstAcceptanceLetsOneWin is the paper contract of a
// contract handed over on paper that the conclusion at the acceptance
// concludes at the same time. The acceptance holds the contract; the paper
// signature waits on its lock and then finds a concluded contract: one
// conclusion, mit_anmeldung, no signature, chk_contracts_active_concluded
// kept. It goes red when the paper signature reads the contract without its
// row lock.
func TestPaperSignatureAgainstAcceptanceLetsOneWin(t *testing.T) {
	t.Parallel()
	f := newRaceFixture(t, "Träger Rennen Papier Annahme")
	f.handOver(t)
	paper := func(txCtx context.Context) error {
		return f.signatures().RecordPaperSignature(txCtx, f.reviewer, f.contract, paperOf("Erika Muster"))
	}
	won, lost := f.race(t, f.conclude, paper)

	require.NoError(t, won, "the acceptance wins")
	require.Error(t, lost)
	assert.True(t, paperLoss(lost), "the paper signature gets a defined error, got %v", lost)
	s := f.state(t)
	assert.Equal(t, raceState{found: true, status: carecontract.StatusActive, concluded: true, effective: 1, versions: 1,
		documents: 1, mailings: 1, conclusions: 1}, s)
	assert.Zero(t, f.signedPapers(t), "the acceptance concluded it; no paper signature")
	var method string
	require.NoError(t, f.db.NewRaw(`SELECT conclusion_method FROM care_contract.contracts WHERE id = ?`, f.contract).
		Scan(context.Background(), &method))
	assert.Equal(t, carecontract.MethodWithApplication, method)
}

// TestPaperHandoverAgainstDiscardLetsOneWin is the paper handover of a
// draft the Träger-Büro discards at the same time (#8030): since only a
// handed-over contract takes a paper signature, the handover is the write
// that freezes a draft's PDF. The discard holds the contract; the handover
// waits on its lock and then finds nothing: no PDF, signature or conclusion
// of a discarded draft. It goes red when the handover reads the contract
// without its row lock.
func TestPaperHandoverAgainstDiscardLetsOneWin(t *testing.T) {
	t.Parallel()
	f := newRaceFixture(t, "Träger Rennen Papier Verwerfen")
	discard := func(txCtx context.Context) error { return f.contracts.DiscardContract(txCtx, f.reviewer, f.contract) }
	handOver := func(txCtx context.Context) error {
		return f.signatures().HandOverOnPaper(txCtx, f.reviewer, f.contract)
	}
	won, lost := f.race(t, discard, handOver)

	require.NoError(t, won, "the discard wins")
	require.Error(t, lost)
	assert.True(t, paperLoss(lost), "the handover gets a defined error, got %v", lost)
	s := f.state(t)
	assert.False(t, s.found, "the draft is gone")
	assert.Zero(t, s.documents+s.mailings+s.conclusions, "no PDF, mail or conclusion of a discarded draft")
	assert.Zero(t, f.signedPapers(t), "no signature of a discarded draft")
	assert.Zero(t, s.broken)
}

// TestSignatureStaysVisibleAfterAnApprovedChange pins that an approved
// change (#4681) never hides the proof of the signature: after a newer
// version follows the signed one, the detail still shows the signature,
// checked against the version and PDF it signed. It goes red when the
// detail looks the signature up by the newest version.
func TestSignatureStaysVisibleAfterAnApprovedChange(t *testing.T) {
	t.Parallel()
	f := newRaceFixture(t, "Träger Unterschrift nach Änderung")
	store := postgres.NewStore(calendar.TodayDate)
	// The contract began on 01.01.2026, before anything was signed.
	_, err := f.db.ExecContext(context.Background(), `UPDATE care_contract.contract_versions SET effective_from = '2026-01-01'
		WHERE contract_id = ?`, f.contract)
	require.NoError(t, err)
	f.handOver(t)
	require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
		return f.signatures().RecordPaperSignature(txCtx, f.reviewer, f.contract, paperOf("Erika Muster"))
	}))
	require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
		record, err := store.Contract(txCtx, f.org, f.contract, true)
		if err != nil {
			return err
		}
		next := record.Version
		next.Number, next.Status, next.Source = 2, carecontract.VersionEffective, carecontract.SourceBookingChange
		// Any day the version guard accepts as not in the past; the test
		// moves it below. A fixed far day keeps that true (#4027).
		next.EffectiveFrom = calendar.NewDate(2099, 9, 1)
		_, err = store.InsertVersion(txCtx, f.org, f.contract,
			VersionStep{Supersede: record.Version.ID.Int64(), Status: carecontract.VersionEffective}, next)
		return err
	}))

	// The change began on 01.02.2026, so it is the version in force today.
	// The guard of 1.15.787 refuses a new version that starts in the past,
	// so the test moves its day as owner of the table; the signed first
	// version keeps every value it was signed with.
	_, err = f.db.ExecContext(context.Background(), `UPDATE care_contract.contract_versions SET effective_from = '2026-02-01'
		WHERE contract_id = ? AND version_number = 2`, f.contract)
	require.NoError(t, err)

	detail, err := f.contracts.Contract(f.ctx, f.reviewer, f.contract)
	require.NoError(t, err)
	require.Len(t, detail.Versions, 2, "the approved change made a second version")
	assert.Equal(t, 2, detail.Version.Number, "the change is the version in force")
	require.NotNil(t, detail.Signature, "the signature stays visible after the change")
	assert.Equal(t, carecontract.SignaturePaper, detail.Signature.Method)
	assert.True(t, detail.Signature.Intact, "checked against the version and PDF it signed")
}

// TestOnlyTheDraftPreviewSaysItIsNotForSigning pins the preview note of
// #8030: the PDF of a draft is a preview that changes with the letterhead,
// so it says on every page that it is not for signing. The PDF frozen at the
// handover is the one the parents sign and never carries the note. It goes
// red when the preview looks like the contract, or the note is frozen.
func TestOnlyTheDraftPreviewSaysItIsNotForSigning(t *testing.T) {
	t.Parallel()
	f := newRaceFixture(t, "Träger Vorschau Vermerk")
	preview, err := f.contracts.ContractDocument(f.ctx, f.reviewer, f.contract)
	require.NoError(t, err)
	assert.Contains(t, string(preview.Data), previewNote, "the draft's preview names itself")
	version, err := f.contracts.VersionDocument(f.ctx, f.reviewer, f.contract, 1)
	require.NoError(t, err)
	assert.Contains(t, string(version.Data), previewNote, "the draft's version preview too")

	f.handOver(t)
	frozen, err := f.contracts.ContractDocument(f.ctx, f.reviewer, f.contract)
	require.NoError(t, err)
	assert.NotContains(t, string(frozen.Data), previewNote, "the frozen PDF is for signing")
	var stored []byte
	require.NoError(t, f.db.NewRaw(`SELECT pdf FROM care_contract.contract_documents WHERE contract_id = ?`, f.contract).
		Scan(context.Background(), &stored))
	assert.NotContains(t, string(stored), previewNote, "the stored PDF carries no note")
}

// TestPaperHandoverTrailsOnlyTheHandover pins the trail of #8030: handing a
// draft over on paper is one send via the office. Printing the contract
// again, or handing over a contract mailed before, changes nothing and adds
// no send to the trail. It goes red when every call writes a send.
func TestPaperHandoverTrailsOnlyTheHandover(t *testing.T) {
	t.Parallel()
	sends := func(f raceFixture) int {
		t.Helper()
		var n int
		require.NoError(t, f.db.NewRaw(`SELECT COUNT(*) FROM care_contract.contract_events WHERE contract_id = ? AND action = 'send'`,
			f.contract).Scan(context.Background(), &n))
		return n
	}

	onPaper := newRaceFixture(t, "Träger Übergabe Spur")
	onPaper.handOver(t)
	onPaper.handOver(t)
	assert.Equal(t, 1, sends(onPaper), "one handover, one send")

	mailed := newRaceFixture(t, "Träger Übergabe nach Mail")
	require.NoError(t, testpkg.WithinTraeger(mailed.ctx, mailed.org, func(txCtx context.Context) error {
		_, err := mailed.contracts.SendContracts(txCtx, mailed.reviewer, []int64{mailed.contract})
		return err
	}))
	mailed.handOver(t)
	assert.Equal(t, 1, sends(mailed), "a mailed contract handed over again is no second send")
}

// TestWithdrawalPeriodKeepsTheFirstAcknowledgementAfterAChange pins the
// withdrawal evidence of the contract across its versions (#4816): the
// parents acknowledged the notice when they signed the first version
// online, and a changed version signed on paper later hides nothing of it.
// It goes red when the period follows the newest signature alone.
func TestWithdrawalPeriodKeepsTheFirstAcknowledgementAfterAChange(t *testing.T) {
	t.Parallel()
	f := newRaceFixture(t, "Träger Belehrung nach Änderung")
	store := postgres.NewStore(calendar.TodayDate)
	f.handOver(t)
	require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
		return f.signatures().RecordPaperSignature(txCtx, f.reviewer, f.contract, paperOf("Erika Muster"))
	}))
	// The first version was signed online: the test rewrites its signature
	// as owner of the tables, with the ledger row the proof constraint asks for.
	acknowledged := time.Date(2026, 11, 2, 9, 30, 0, 0, time.UTC)
	hash := fmt.Sprintf("%064x", 1)
	_, err := f.db.ExecContext(context.Background(), `WITH ledger AS (
			INSERT INTO audit.traeger_signatures (organization_id, purpose, care_contract_version_id, signer_name, method,
				typed_name, image_png, image_sha256, document_sha256, record_hash, signed_at)
			SELECT s.organization_id, 'care_contract', s.contract_version_id, s.signer_name, 'typed', s.signer_name,
				'\x89'::bytea, ?, ?, ?, ? FROM care_contract.contract_signatures AS s WHERE s.contract_id = ?
			RETURNING id)
		UPDATE care_contract.contract_signatures AS s SET method = 'typed', channel = 'parent_account',
			audit_signature_id = ledger.id, paper_pdf = NULL, paper_pdf_sha256 = NULL, paper_filename = NULL,
			withdrawal_notice_at = ?, early_start_requested = true
		FROM ledger WHERE s.contract_id = ?`, hash, hash, hash, acknowledged, f.contract, acknowledged, f.contract)
	require.NoError(t, err)
	require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
		record, err := store.Contract(txCtx, f.org, f.contract, true)
		if err != nil {
			return err
		}
		next := record.Version
		next.Number, next.Status, next.Source = 2, carecontract.VersionEffective, carecontract.SourceBookingChange
		next.EffectiveFrom = calendar.NewDate(2099, 9, 1)
		id, err := store.InsertVersion(txCtx, f.org, f.contract,
			VersionStep{Supersede: record.Version.ID.Int64(), Status: carecontract.VersionEffective}, next)
		if err != nil {
			return err
		}
		paper := paperOf("Erika Muster")
		return store.InsertSignature(txCtx, f.org, NewSignature{
			ContractID: f.contract, VersionID: id, Method: carecontract.SignaturePaper, Channel: "office",
			SignerName: paper.SignerName, VersionSHA256: hash, DocumentSHA256: hash, PaperFilename: paper.Filename,
			PaperPDF: paper.PDF, PaperSHA256: hash, SignedOn: paper.SignedOn.AddDays(30), SignedAt: acknowledged.AddDate(0, 0, 30),
		})
	}))
	notices := NewNotices(store, store, NoticePorts{Holidays: schoolHolidays{}, Templates: noticeTemplates{}, Post: &noticePost{}, Sender: noticeSender{}},
		f.contracts.clock, f.contracts)
	require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(txCtx context.Context) error {
		state, err := notices.noticeState(txCtx, f.org, f.contract)
		require.NoError(t, err)
		require.NotNil(t, state.InformedAt, "the paper signature of the change hides no earlier acknowledgement")
		assert.WithinDuration(t, acknowledged, *state.InformedAt, time.Second)
		assert.True(t, state.EarlyStart, "the wish to begin early stays with the contract")
		return nil
	}))
}
