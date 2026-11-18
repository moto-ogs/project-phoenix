package application

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
)

func (s *Intake) snapshotLegalEvidence(ctx context.Context, blocks []enrollment.LegalBlock, flags map[string]any, forms snapshotForms, at time.Time) (enrollment.LegalBlocksSnapshotEntry, error) {
	entry, err := legalBlocksSnapshotEntry(blocks, flags, forms, at, s.deps.Fingerprint)
	if err != nil || s.deps.LegalPDFFingerprint == nil {
		return entry, err
	}
	fingerprints := make(map[string]string)
	for i, block := range blocks {
		hashes, err := s.snapshotPDFHashes(ctx, block, fingerprints)
		if err != nil {
			return enrollment.LegalBlocksSnapshotEntry{}, fmt.Errorf("fingerprint enrollment legal PDF: %w", err)
		}
		entry.Blocks[i].PDFSHA256 = hashes
	}
	return entry, nil
}

func (s *Intake) snapshotPDFHashes(ctx context.Context, block enrollment.LegalBlock, fingerprints map[string]string) (map[string]string, error) {
	urls := make([]string, 0, len(block.Attachments)+1)
	if block.PDFURL != "" {
		urls = append(urls, block.PDFURL)
	}
	for _, attachment := range block.Attachments {
		urls = append(urls, attachment.DocumentURL)
	}
	var hashes map[string]string
	for _, url := range urls {
		hash, seen := fingerprints[url]
		if !seen {
			var err error
			hash, err = s.deps.LegalPDFFingerprint(ctx, s.deps.Runtime.TenantID(ctx), url)
			if err != nil {
				return nil, err
			}
			fingerprints[url] = hash
		}
		if hash == "" {
			continue
		}
		if hashes == nil {
			hashes = make(map[string]string)
		}
		hashes[url] = hash
	}
	return hashes, nil
}

// proposedLegalEvidence records changed answers from the family when it
// proposes them. An offering change in a renewal cannot re-answer its
// required terms, which have their own confirmation.
func (s *ChangeRequests) proposedLegalEvidence(ctx context.Context, prepared *proposal, base map[string]any, submitted map[string]any, renewal bool) (*enrollment.LegalBlocksSnapshotEntry, error) {
	before := mapFromAny(base["consent_flags"])
	after := prepared.request.ConsentFlags
	var blocks []enrollment.LegalBlock
	flags := make(map[string]any)
	for _, block := range prepared.legalBlocks {
		if renewal && block.Required {
			continue
		}
		if jsonEqual(before[block.Key], after[block.Key]) {
			continue
		}
		blocks = append(blocks, block)
		if answer, present := submitted[block.Key]; present {
			flags[block.Key] = answer
		}
	}
	if len(blocks) == 0 {
		return nil, nil
	}
	entry, err := s.intake.snapshotLegalEvidence(ctx, blocks, flags, formsOf(prepared.schema, prepared.request.DisplayedFormSchemaID), s.deps.Now())
	if err != nil {
		return nil, err
	}
	entry.ChangeRequest = true
	return &entry, nil
}

// approvalLegalEvidence carries over the parts of the proposal that were
// applied. A school may remove a block while a proposal waits for review.
func approvalLegalEvidence(run *approval) (*enrollment.LegalBlocksSnapshotEntry, error) {
	proposed := mapFromAny(run.row.ProposedSnapshot["consent_flags"])
	entry := enrollment.LegalBlocksSnapshotEntry{}
	submitted := proposed
	if run.row.LegalEvidence != nil {
		entry = *run.row.LegalEvidence
		submitted = nil
		if err := json.Unmarshal(entry.ConsentFlags, &submitted); err != nil {
			return nil, fmt.Errorf("decode submitted consent evidence: %w", err)
		}
	} else if run.row.Origin == enrollment.ChangeRequestOriginParent {
		// Legacy pending proposals still have the submitted answers.
		// Current labels identify the questions; the wording was never kept.
		entry.SnapshotAt = run.row.CreatedAt
		entry.ChangeRequest = true
		entry.WordingUnavailable = true
		for _, block := range run.prepared.legalBlocks {
			entry.Blocks = append(entry.Blocks, enrollment.LegalBlockSnapshot{Key: block.Key, Kind: block.Kind, Title: block.Title})
		}
	}
	before := formMap(run.req.ConsentFlags)
	applied := run.prepared.request.ConsentFlags
	blocks := make([]enrollment.LegalBlockSnapshot, 0, len(entry.Blocks))
	flags := make(map[string]any)
	for _, block := range entry.Blocks {
		if jsonEqual(before[block.Key], applied[block.Key]) || !jsonEqual(proposed[block.Key], applied[block.Key]) {
			continue
		}
		blocks = append(blocks, block)
		if answer, present := submitted[block.Key]; present {
			flags[block.Key] = answer
		}
	}
	if len(blocks) == 0 {
		return nil, nil
	}
	frozen, err := json.Marshal(flags)
	if err != nil {
		return nil, fmt.Errorf("encode approved consent evidence: %w", err)
	}
	entry.Blocks, entry.ConsentFlags = blocks, frozen
	return &entry, nil
}
