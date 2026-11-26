package enrollment

import (
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// FormAttachment is a named PDF in an immutable form version. Replacing a
// document creates a new URL; saved versions retain their original reference.
type FormAttachment struct {
	DocumentID  ident.ID `json:"document_id,omitempty"`
	Label       string   `json:"label"`
	DocumentURL string   `json:"document_url"`
}

// MarshalJSON preserves the existing quoted document ID in saved form
// versions as well as HTTP responses.
func (attachment FormAttachment) MarshalJSON() ([]byte, error) {
	type formAttachment FormAttachment
	return wire.Marshal(formAttachment(attachment))
}

func ValidateFormAttachments(attachments []FormAttachment) error {
	seen := make(map[string]bool, len(attachments))
	for i := range attachments {
		attachment := &attachments[i]
		attachment.Label = strings.TrimSpace(attachment.Label)
		attachment.DocumentURL = strings.TrimSpace(attachment.DocumentURL)
		if attachment.Label == "" {
			return invalidInputf(CodeFormAttachmentInvalid, fmt.Sprintf("attachments.%d.label", i), "attachment %d requires a label", i)
		}
		if attachment.DocumentURL == "" {
			return invalidInputf(CodeFormAttachmentInvalid, fmt.Sprintf("attachments.%d.document_url", i), "attachment %d requires a document URL", i)
		}
		if seen[attachment.DocumentURL] {
			return invalidInputf(CodeFormAttachmentInvalid, fmt.Sprintf("attachments.%d.document_url", i), "attachment %d repeats a document URL", i)
		}
		seen[attachment.DocumentURL] = true
	}
	return nil
}

// PublicFormAttachments copies the version's references for anonymous readers.
func PublicFormAttachments(attachments []FormAttachment) []FormAttachment {
	if len(attachments) == 0 {
		return nil
	}
	result := append([]FormAttachment(nil), attachments...)
	for i := range result {
		result[i].DocumentURL = PublicEnrollmentLegalDocumentURL(result[i].DocumentURL)
	}
	return result
}
