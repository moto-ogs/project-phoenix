package application

import (
	"context"
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
		urls := make([]string, 0, len(block.Attachments)+1)
		if block.PDFURL != "" {
			urls = append(urls, block.PDFURL)
		}
		for _, attachment := range block.Attachments {
			urls = append(urls, attachment.DocumentURL)
		}
		for _, url := range urls {
			hash, seen := fingerprints[url]
			if !seen {
				hash, err = s.deps.LegalPDFFingerprint(ctx, s.deps.Runtime.TenantID(ctx), url)
				if err != nil {
					return enrollment.LegalBlocksSnapshotEntry{}, fmt.Errorf("fingerprint enrollment legal PDF: %w", err)
				}
				fingerprints[url] = hash
			}
			if hash == "" {
				continue
			}
			if entry.Blocks[i].PDFSHA256 == nil {
				entry.Blocks[i].PDFSHA256 = make(map[string]string)
			}
			entry.Blocks[i].PDFSHA256[url] = hash
		}
	}
	return entry, nil
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
