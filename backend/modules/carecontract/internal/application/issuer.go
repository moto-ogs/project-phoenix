package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
)

// The body that concludes the contracts of a school (#4811). The settings
// name the Träger, the Schulträger or the Gemeinde; the roots bind the read
// as carecontract.SchoolIssuers. A contract whose PDF is frozen keeps the
// body that issued it: mails, reminders, the signing page and declarations
// of a sent contract name that body, whatever the school is set to now.

// issuedBy is the body a contract with a stored PDF was issued by, nil for
// the Träger; frozen is false while no PDF of the contract is stored. A
// later version without a PDF of its own (an amendment) stays with the body
// of the newest stored PDF: a contract does not change its party.
func issuedBy(record ContractRecord) (issuer *carecontract.Issuer, frozen bool) {
	if record.DocumentID != nil {
		return record.Issuer, true
	}
	if record.SentDocument != nil {
		return record.SentDocument.Issuer, true
	}
	return nil, false
}

// contractIssuer is the body the contract names in place of the Träger,
// nil for the Träger: the body its stored PDF froze with, else the body the
// school is set to now. A composition without issuers knows only the Träger.
func contractIssuer(ctx context.Context, issuers carecontract.SchoolIssuers, organizationID int64, record ContractRecord) (*carecontract.Issuer, error) {
	if issuer, frozen := issuedBy(record); frozen {
		return issuer, nil
	}
	if issuers == nil {
		return nil, nil
	}
	schoolID := record.Summary.SchoolID.Int64()
	bySchool, err := issuers.SchoolIssuers(ctx, organizationID, []int64{schoolID})
	if err != nil {
		return nil, fmt.Errorf("care contract: issuer of the school: %w", err)
	}
	if issuer, ok := bySchool[schoolID]; ok {
		return &issuer, nil
	}
	return nil, nil
}

// issuedLetterhead is the Träger's letterhead, or the issuer's on it.
func issuedLetterhead(head carecontract.Letterhead, issuer *carecontract.Issuer) carecontract.Letterhead {
	if issuer == nil {
		return head
	}
	return issuer.Letterhead(head)
}

// issuedSender is the sender text of a sent contract: the Träger's, or that
// of the body that issued its PDF.
func issuedSender(traeger string, record ContractRecord) string {
	if issuer, _ := issuedBy(record); issuer != nil {
		return issuer.SenderText
	}
	return traeger
}

// schoolIssuers reads, in one call for all schools, the bodies that conclude
// their contracts in place of the Träger (#4811).
func (in *Intake) schoolIssuers(ctx context.Context, organizationID int64, schools []carecontract.School) (map[int64]carecontract.Issuer, error) {
	if in.issuers == nil || len(schools) == 0 {
		return nil, nil
	}
	ids := make([]int64, 0, len(schools))
	for _, school := range schools {
		ids = append(ids, school.ID)
	}
	issuers, err := in.issuers.SchoolIssuers(ctx, organizationID, ids)
	if err != nil {
		return nil, fmt.Errorf("care contract: issuers of the schools: %w", err)
	}
	return issuers, nil
}

// issuedSchoolLetterhead reads the Träger's letterhead, puts the body that
// concludes the contracts of the school on it and names that body, empty
// for the Träger.
func (in *Intake) issuedSchoolLetterhead(ctx context.Context, reviewer carecontract.Reviewer, school carecontract.School) (carecontract.Letterhead, string, error) {
	head, err := in.letterheads.Letterhead(ctx, reviewer)
	if err != nil {
		return carecontract.Letterhead{}, "", fmt.Errorf("care contract: letterhead: %w", err)
	}
	issuers, err := in.schoolIssuers(ctx, reviewer.OrganizationID, []carecontract.School{school})
	if err != nil {
		return carecontract.Letterhead{}, "", err
	}
	return schoolLetterhead(head, issuers, school.ID), issuerName(issuers, school.ID), nil
}

// issuerName is the name of the body that concludes the contracts of the
// school in place of the Träger, empty for the Träger.
func issuerName(issuers map[int64]carecontract.Issuer, schoolID int64) string {
	return firstLine(textLines(issuers[schoolID].SenderText))
}

// schoolLetterhead is the letterhead the contracts of the school print.
func schoolLetterhead(head carecontract.Letterhead, issuers map[int64]carecontract.Issuer, schoolID int64) carecontract.Letterhead {
	if issuer, ok := issuers[schoolID]; ok {
		return issuer.Letterhead(head)
	}
	return head
}
