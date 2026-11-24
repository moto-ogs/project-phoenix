package announcement

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/api/common"
	announcementService "github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/sharedkernel/collation"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// Serienbriefe (#4813): the placeholders a letter may name, the preview of a
// letter for one child, and every letter of a dispatch as one PDF to print.
// The letters are described here; the root binds the Document Rendering
// letter layout, which this inbound may not import.

type (
	// LetterFact is a label with its value beside the address field.
	LetterFact = struct{ Label, Value string }
	// LetterSheet is one printed letter: the school's letterhead and logo,
	// the address field, the subject and the paragraphs of the text.
	LetterSheet = struct {
		Logo       []byte
		Sender     []string
		Recipient  []string
		Facts      []LetterFact
		Subject    string
		Paragraphs []string
		Footer     []string
	}
	// LetterSheets are the letters of one dispatch, one child each.
	LetterSheets = struct {
		Title   string
		Letters []LetterSheet
	}
)

// LetterPrinter lays out the letters of a dispatch as one PDF, each letter
// starting on a page of its own.
type LetterPrinter interface {
	PrintLetters(sheets LetterSheets, filenameBase string) (ReportFile, error)
}

var errLetterPrinterMissing = errors.New("the parent letters are not configured")

type letterPlaceholderResponse struct {
	Name    string `json:"name"`
	Label   string `json:"label"`
	Example string `json:"example"`
}

func (rs *Resource) letterPlaceholders(w http.ResponseWriter, r *http.Request) {
	placeholders := announcementService.ParentLetterPlaceholders()
	out := make([]letterPlaceholderResponse, 0, len(placeholders))
	for _, p := range placeholders {
		out = append(out, letterPlaceholderResponse(p))
	}
	common.Respond(w, r, http.StatusOK, out, "Letter placeholders retrieved")
}

type letterPreviewRequest struct {
	Body      string `json:"body"`
	StudentID string `json:"student_id"`
}

type letterPreviewChild struct {
	StudentID   string `json:"student_id"`
	FirstName   string `json:"first_name"`
	LastName    string `json:"last_name"`
	SchoolClass string `json:"school_class"`
}

type letterPreviewResponse struct {
	Body  string             `json:"body"`
	Child letterPreviewChild `json:"child"`
}

func decodeLetterPreview(w http.ResponseWriter, r *http.Request) (string, int64, bool) {
	var req letterPreviewRequest
	if err := wire.Decode(r.Body, &req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid request body")))
		return "", 0, false
	}
	studentID, err := strconv.ParseInt(strings.TrimSpace(req.StudentID), 10, 64)
	if err != nil || studentID <= 0 {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid student_id")))
		return "", 0, false
	}
	return req.Body, studentID, true
}

func (rs *Resource) letterPreview(w http.ResponseWriter, r *http.Request) {
	rs.respondLetterPreview(w, r, nil)
}

// respondLetterPreview answers the preview; classes, when set, narrows the
// children to the classes the caller reaches: the service answers any other
// child as not found before it reads or logs anything about it.
func (rs *Resource) respondLetterPreview(w http.ResponseWriter, r *http.Request, classes []string) {
	body, studentID, ok := decodeLetterPreview(w, r)
	if !ok {
		return
	}
	if rs.ParentLetters == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errLetterPrinterMissing))
		return
	}
	claims := sessiontoken.ClaimsFromCtx(r.Context())
	preview, err := rs.ParentLetters.PreviewParentLetter(r.Context(), int64(claims.ID), body, studentID, classes)
	if err != nil {
		renderAnnouncementError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, letterPreviewResponse{
		Body: preview.Body,
		Child: letterPreviewChild{
			StudentID: strconv.FormatInt(preview.Child.StudentID, 10), FirstName: preview.Child.FirstName,
			LastName: preview.Child.LastName, SchoolClass: preview.Child.SchoolClass,
		},
	}, "Letter preview rendered")
}

// lettersPDF answers every letter of a published Elternbrief as one PDF to
// print, one child per letter.
func (rs *Resource) lettersPDF(w http.ResponseWriter, r *http.Request) {
	id, ok := parseAnnouncementID(w, r)
	if !ok {
		return
	}
	if rs.Letters == nil || rs.ParentLetters == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errLetterPrinterMissing))
		return
	}
	claims := sessiontoken.ClaimsFromCtx(r.Context())
	letters, err := rs.ParentLetters.PrintParentLetters(r.Context(), int64(claims.ID), id)
	if err != nil {
		renderAnnouncementError(w, r, err)
		return
	}
	file, err := rs.Letters.PrintLetters(letterSheets(letters), "elternbriefe-"+strconv.FormatInt(id, 10))
	if err != nil {
		renderAnnouncementError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", file.ContentType)
	w.Header().Set("Content-Disposition", textnorm.ContentDisposition("attachment", file.Filename))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(file.Data)
}

// letterSheets writes the printed letters of a dispatch: the school as
// letterhead, the child's family as addressee, the day the letter went out,
// the title as subject and the frozen text of each child.
func letterSheets(letters *announcementService.ParentLetterPrint) LetterSheets {
	sender := []string{letters.SchoolName}
	if letters.SenderName != "" {
		sender = append(sender, letters.SenderName)
	}
	date := letters.PublishedAt.In(berlin).Format("02.01.2006")
	footer := []string{letters.SchoolName + " · Elternbrief vom " + date}
	out := LetterSheets{Title: letters.Title, Letters: make([]LetterSheet, 0, len(letters.Copies))}
	for _, letter := range letters.Copies {
		recipient := []string{"An die Eltern von", strings.TrimSpace(letter.FirstName + " " + letter.LastName)}
		if letter.SchoolClass != "" {
			recipient = append(recipient, collation.SchoolClassLabel(letter.SchoolClass))
		}
		out.Letters = append(out.Letters, LetterSheet{
			Logo: letters.Logo, Sender: sender, Recipient: recipient,
			Facts:      []LetterFact{{Label: "Datum", Value: date}},
			Subject:    letters.Title,
			Paragraphs: letterParagraphs(letter.Body),
			Footer:     footer,
		})
	}
	return out
}

// letterParagraphs splits a letter text at its empty lines; line breaks in a
// paragraph stay.
func letterParagraphs(body string) []string {
	var paragraphs []string
	for _, part := range strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n\n") {
		if part = strings.TrimSpace(part); part != "" {
			paragraphs = append(paragraphs, part)
		}
	}
	return paragraphs
}
