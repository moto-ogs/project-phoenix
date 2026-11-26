package application

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The paper contract (#4679, option D): parents without internet, or a
// contract that exists only on paper, sign the printed PDF. The Träger-Büro
// uploads the signed PDF, names who signed and when; that concludes the
// contract like an online signature. The upload stays with the version.

var pdfMagic = []byte("%PDF-")

// HandOverOnPaper freezes the PDF the Träger-Büro prints and hands to the
// parents (#8030), in the caller's Träger transaction and under the
// contract's row lock. A draft becomes versendet without a mail: no mailing
// means no link and no reminder. A sent contract keeps its frozen PDF, which
// the office prints again; only the handover itself enters the trail. The
// paper signature then binds this PDF, whatever
// letterhead, template or master data change before the scan is uploaded.
func (s *Signatures) HandOverOnPaper(ctx context.Context, reviewer carecontract.Reviewer, contractID int64) error {
	if err := checkReviewer(reviewer); err != nil {
		return err
	}
	if s.contracts == nil {
		return errors.New("care contract: the paper handover needs the contracts")
	}
	record, err := s.store.Contract(ctx, reviewer.OrganizationID, contractID, true)
	if err != nil {
		return err
	}
	if record.Summary.Status != carecontract.StatusDraft && record.Summary.Status != carecontract.StatusSent {
		return carecontract.ErrContractNotSignable
	}
	documentID, err := s.contracts.paperDocument(ctx, reviewer, record)
	if err != nil {
		return err
	}
	// Printing a handed-over or mailed contract again changes nothing: the
	// trail holds the handover once, the read of its PDF holds the print.
	if record.Summary.Status != carecontract.StatusDraft && record.DocumentID != nil {
		return nil
	}
	if record.Summary.Status == carecontract.StatusDraft {
		if err := s.store.MarkSent(ctx, reviewer.OrganizationID, contractID, s.clock.now()); err != nil {
			return err
		}
	}
	return trailContract(ctx, s.store, reviewer.OrganizationID, reviewer.AccountID, record, ports.ActionSend,
		map[string]any{"via": carecontract.ChannelOffice, "document_id": documentID})
}

// RecordPaperSignature stores the signed paper PDF of a sent contract and
// concludes it, or of the changed version of an active contract, which then
// takes effect (#4816), in the caller's Träger transaction. The parents signed the
// PDF frozen when the contract was handed over on paper or sent by mail
// (#8030): a draft, or a current version without its frozen PDF, is not
// signable, and the upload never renders the contract again.
func (s *Signatures) RecordPaperSignature(ctx context.Context, reviewer carecontract.Reviewer, contractID int64, input carecontract.PaperInput) error {
	if err := checkReviewer(reviewer); err != nil {
		return err
	}
	if err := checkPaper(&input, calendar.DateFromTime(s.clock.now())); err != nil {
		return err
	}
	record, err := s.store.Contract(ctx, reviewer.OrganizationID, contractID, true)
	if err != nil {
		return err
	}
	// The scan signs the version that waits: a sent contract's, or the
	// changed version of an active one (#4816).
	waits, err := waitingRecord(ctx, s.store, reviewer.OrganizationID, &record)
	if err != nil {
		return err
	}
	if !waits || record.DocumentID == nil {
		return carecontract.ErrContractNotSignable
	}
	document, err := s.store.CurrentDocument(ctx, reviewer.OrganizationID, contractID, record.Version.ID.Int64())
	if err != nil {
		return err
	}
	now := s.clock.now()
	checksum, err := versionChecksum(s.ports.Links.Fingerprint, record.Version)
	if err != nil {
		return err
	}
	documentID, recorder := document.ID, reviewer.AccountID
	if err := s.store.InsertSignature(ctx, reviewer.OrganizationID, NewSignature{
		ContractID: contractID, VersionID: record.Version.ID.Int64(), DocumentID: &documentID, Method: carecontract.SignaturePaper,
		Channel: carecontract.ChannelOffice, SignerName: input.SignerName, VersionSHA256: checksum,
		DocumentSHA256: document.SHA256, PaperFilename: input.Filename, PaperPDF: input.PDF, SignedOn: input.SignedOn,
		SignedAt: now, RecordedByAccountID: &recorder, PaperSHA256: s.ports.Links.Fingerprint(input.PDF),
	}); err != nil {
		return err
	}
	status, err := s.takeEffect(ctx, reviewer.OrganizationID, reviewer.AccountID, record, carecontract.SignaturePaper, now)
	if err != nil {
		return err
	}
	return trailContract(ctx, s.store, reviewer.OrganizationID, reviewer.AccountID, record, ports.ActionSign, map[string]any{
		"via": carecontract.ChannelOffice, "method": carecontract.SignaturePaper, "document_sha256": document.SHA256,
		"version_sha256": checksum, "signed_on": input.SignedOn.String(), "status": status, "version_number": record.Version.Number,
	})
}

// PaperDocument answers the uploaded PDF and logs the read in its school's
// access log after the Träger transaction has committed.
func (s *Signatures) PaperDocument(ctx context.Context, reviewer carecontract.Reviewer, contractID int64) (carecontract.File, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.File{}, err
	}
	if s.contracts == nil {
		return carecontract.File{}, errors.New("care contract: the paper document needs the contracts")
	}
	var file carecontract.File
	var schoolID int64
	err := s.contracts.runtime.WithinTraeger(ctx, reviewer.OrganizationID, func(txCtx context.Context) error {
		record, err := s.store.Contract(txCtx, reviewer.OrganizationID, contractID, false)
		if err != nil {
			return err
		}
		schoolID = record.Summary.SchoolID.Int64()
		file, err = s.store.PaperDocument(txCtx, reviewer.OrganizationID, contractID)
		if err != nil {
			return err
		}
		return trailContract(txCtx, s.store, reviewer.OrganizationID, reviewer.AccountID, record, ports.ActionRead, map[string]any{"view": "paper"})
	})
	if err != nil {
		return carecontract.File{}, err
	}
	if err := s.contracts.logSchools(ctx, reviewer, "care_contract_paper_document", map[int64][]int64{schoolID: {contractID}}); err != nil {
		return carecontract.File{}, err
	}
	return file, nil
}

// checkPaper validates the upload like every upload (size, extension and
// content): a PDF of at most PaperMaxBytes, a signer and a signing day that
// is not in the future.
func checkPaper(input *carecontract.PaperInput, today calendar.Date) error {
	fields := map[string]string{}
	input.SignerName = strings.TrimSpace(input.SignerName)
	if input.SignerName == "" || utf8.RuneCountInString(input.SignerName) > 300 {
		fields["signer_name"] = "required"
	}
	if input.SignedOn.IsZero() || input.SignedOn.After(today) || input.SignedOn.Before(calendar.NewDate(2000, 1, 1)) {
		fields["signed_on"] = "invalid"
	}
	if len(fields) > 0 {
		return &carecontract.ValidationError{Fields: fields}
	}
	input.Filename = filepath.Base(strings.TrimSpace(input.Filename))
	if len(input.PDF) == 0 || len(input.PDF) > carecontract.PaperMaxBytes || !bytes.HasPrefix(input.PDF, pdfMagic) ||
		!strings.EqualFold(filepath.Ext(input.Filename), ".pdf") || utf8.RuneCountInString(input.Filename) > 255 {
		return carecontract.ErrPaperDocumentInvalid
	}
	return nil
}
