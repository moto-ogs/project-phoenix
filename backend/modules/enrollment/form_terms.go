package enrollment

import "github.com/moto-ogs/project-phoenix/sharedkernel/readstate"

// FormTermsFingerprint is the read-state token of a form as a family or the
// office sees it (ADR 0311): the form version and the legal blocks in force
// for it, the school-wide texts included when the form has no blocks of its
// own. Form versions never change, so the version stands for the fields; the
// blocks carry wording, PDF references and attachments. A form read returns
// it as terms_fingerprint and every write of that form sends it back, so a
// consent is never stored for a text the family did not see.
func FormTermsFingerprint(schema *FormSchema, blocks []LegalBlock) string {
	var schemaID int64
	if schema != nil {
		schemaID = schema.ID
	}
	pdfs := make([]string, len(blocks))
	for i, block := range blocks {
		pdfs[i] = block.PDFURL
	}
	return readstate.Fingerprint(struct {
		FormSchemaID int64
		Blocks       []LegalBlock
		PDFURLs      []string
	}{schemaID, blocks, pdfs})
}
