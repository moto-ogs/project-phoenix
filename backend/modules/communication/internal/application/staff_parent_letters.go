package application

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/modules/communication/ports"
)

// Serienbriefe (#4813): an Elternbrief that names each child is written once
// per reached child when it is published (ParentLetterCopy). The mail, the
// parent portal and the printed letters read those copies, so a letter stays
// as it went out. A letter that names nobody reads the same for everybody
// and has no copies.

// ParentLetterChildren reads the values a letter names for each child, in
// one read for the whole set. A child of another school or an unknown child
// is missing from the answer.
type ParentLetterChildren interface {
	ParentLetterChildren(ctx context.Context, studentIDs []int64) ([]communication.ParentLetterChild, error)
}

// ParentLetters are the ports the personalised letters use: the copies, the
// owners' child values, the school's logo and the data access log. A school
// without them still sends letters that name nobody; a personalised letter
// refuses.
type ParentLetters struct {
	Copies   communication.ParentLetterCopyRecords
	Children ParentLetterChildren
	Logos    communication.ParentLetterLogos
	Access   communication.ParentLetterAccessLog
}

// ParentLetterPorts are what the personalised letters read outside
// Communication: the child values of the owners, the school's logo and the
// data access log. The copies live in the announcements' repository.
type ParentLetterPorts struct {
	Sources ports.ParentLetterSources
	Logos   communication.ParentLetterLogos
	Access  communication.ParentLetterAccessLog
}

// Bind gives the service its letter ports over the announcements'
// repository; without sources it previews and personalises nothing.
func (p ParentLetterPorts) Bind(repo communication.ParentLetterCopyRecords, now func() time.Time) ParentLetters {
	letters := ParentLetters{Copies: repo, Logos: p.Logos, Access: p.Access}
	if p.Sources.Students != nil {
		letters.Children = NewParentLetterChildren(p.Sources, now)
	}
	return letters
}

var errParentLettersNotWired = errors.New("announcement: personalised letters are not wired")

func (a *StaffParentAnnouncement) IsPersonalLetter() bool {
	return communication.IsPersonalParentLetter(a.DeliveryMode, a.Body)
}

// freezeLetterCopies writes the letter of every child the publication
// reached and logs that read. It needs the recorded recipients, so publish
// runs it after recordAnnouncementRecipients.
func (s *service) freezeLetterCopies(ctx context.Context, a *StaffParentAnnouncement) error {
	if !a.IsPersonalLetter() {
		return nil
	}
	tenantID := a.GetTenantID()
	reached, err := s.repo.LetterChildStatuses(ctx, tenantID, a.ID)
	if err != nil {
		return fmt.Errorf("announcement: letter children for copies: %w", err)
	}
	values, err := s.letterChildValues(ctx, letterChildIDs(reached))
	if err != nil {
		return err
	}
	copies := make([]communication.ParentLetterCopy, 0, len(reached))
	for _, child := range reached {
		values, ok := values[child.StudentID]
		if !ok {
			values = communication.ParentLetterChild{StudentID: child.StudentID, FirstName: child.FirstName, LastName: child.LastName, SchoolClass: child.SchoolClass}
		}
		copies = append(copies, communication.ParentLetterCopy{
			AnnouncementID: a.ID, StudentID: child.StudentID, FirstName: values.FirstName, LastName: values.LastName,
			SchoolClass: values.SchoolClass, Body: communication.FillParentLetter(a.Body, values),
		})
	}
	if err := s.letters.Copies.ReplaceParentLetterCopies(ctx, tenantID, a.ID, copies); err != nil {
		return fmt.Errorf("announcement: write letter copies: %w", err)
	}
	if len(copies) > 0 {
		if err := s.recordLetterAccess(ctx, communication.ParentLetterAccess{
			Kind: communication.ParentLetterAccessPublish, AnnouncementID: &a.ID, ChildCount: len(copies),
		}); err != nil {
			return err
		}
	}
	s.logger.Info("parent letter copies written",
		slog.Int64("announcement_id", a.ID),
		slog.Int("child_count", len(copies)),
	)
	return nil
}

func letterChildIDs(children []*StaffAnnouncementLetterChildStatus) []int64 {
	ids := make([]int64, 0, len(children))
	for _, child := range children {
		ids = append(ids, child.StudentID)
	}
	return ids
}

func (s *service) letterChildValues(ctx context.Context, studentIDs []int64) (map[int64]communication.ParentLetterChild, error) {
	out := make(map[int64]communication.ParentLetterChild, len(studentIDs))
	if len(studentIDs) == 0 {
		return out, nil
	}
	if s.letters.Children == nil {
		return nil, errParentLettersNotWired
	}
	children, err := s.letters.Children.ParentLetterChildren(ctx, studentIDs)
	if err != nil {
		return nil, fmt.Errorf("announcement: read letter child values: %w", err)
	}
	for _, child := range children {
		out[child.StudentID] = child
	}
	return out, nil
}

// letterMailBodies are the frozen letters of a personalised Elternbrief by
// child, or nil for a letter whose text is the same for everybody.
type letterMailBodies map[int64]communication.ParentLetterCopy

func (s *service) personalLetterBodies(ctx context.Context, a *StaffParentAnnouncement) (letterMailBodies, error) {
	if !a.IsPersonalLetter() {
		return nil, nil
	}
	copies, err := s.letters.Copies.ParentLetterCopies(ctx, a.GetTenantID(), a.ID)
	if err != nil {
		return nil, fmt.Errorf("announcement: read letter copies for mail: %w", err)
	}
	bodies := make(letterMailBodies, len(copies))
	for _, c := range copies {
		bodies[c.StudentID] = c
	}
	return bodies, nil
}

// bodyFor is the mail text for one address: the letter of each of its own
// children, one after the other. Children of other families never appear.
func (b letterMailBodies) bodyFor(studentIDs []int64, fallback string) string {
	if b == nil {
		return fallback
	}
	parts := make([]communication.ParentLetterCopy, 0, len(studentIDs))
	for _, id := range studentIDs {
		if c, ok := b[id]; ok {
			parts = append(parts, c)
		}
	}
	switch len(parts) {
	case 0:
		// The address belongs to no reached child any more (a link changed
		// after publication): the letter without any child's values.
		return communication.FillParentLetter(fallback, communication.ParentLetterChild{})
	case 1:
		return parts[0].Body
	}
	texts := make([]string, 0, len(parts))
	for _, c := range parts {
		name := strings.TrimSpace(c.FirstName + " " + c.LastName)
		texts = append(texts, "Brief für "+name+":\n\n"+c.Body)
	}
	return strings.Join(texts, "\n\n— — —\n\n")
}

// addressChildren merges the children of every recipient that shares an
// address, in the order the letter status lists them.
func addressChildren(recipients []*letterRecipient) map[string][]int64 {
	out := map[string][]int64{}
	seen := map[string]map[int64]bool{}
	for _, r := range recipients {
		address := strings.ToLower(strings.TrimSpace(r.src.Email))
		if address == "" {
			continue
		}
		if seen[address] == nil {
			seen[address] = map[int64]bool{}
		}
		for _, id := range r.src.StudentIDs {
			if !seen[address][id] {
				seen[address][id] = true
				out[address] = append(out[address], id)
			}
		}
	}
	return out
}

// PreviewParentLetter fills a letter text for one child of the school,
// before it is saved or sent. The read is written to the data access log.
func (s *service) PreviewParentLetter(ctx context.Context, actorAccountID int64, body string, studentID int64, classes []string) (*communication.ParentLetterPreview, error) {
	preview, err := s.previewLetter(ctx, actorAccountID, body, studentID, classes)
	return preview, mapParentAnnouncementError(err)
}

func (s *service) previewLetter(ctx context.Context, actorAccountID int64, body string, studentID int64, classes []string) (*communication.ParentLetterPreview, error) {
	if len([]rune(body)) > maxBodyLen {
		return nil, fmt.Errorf("%w: body", ErrValidation)
	}
	if err := communication.CheckParentLetterText("", body); err != nil {
		return nil, err
	}
	values, err := s.letterChildValues(ctx, []int64{studentID})
	if err != nil {
		return nil, err
	}
	child, ok := values[studentID]
	if !ok || !inLetterClasses(child.SchoolClass, classes) {
		return nil, ErrNotFound
	}
	if err := s.recordLetterAccess(ctx, communication.ParentLetterAccess{
		ActorAccountID: actorAccountID, Kind: communication.ParentLetterAccessPreview, StudentID: &studentID, ChildCount: 1,
	}); err != nil {
		return nil, err
	}
	return &communication.ParentLetterPreview{Child: child, Body: communication.FillParentLetter(body, child)}, nil
}

// inLetterClasses reports whether a child's class is one of classes; nil
// classes admit every child of the school.
func inLetterClasses(class string, classes []string) bool {
	if classes == nil {
		return true
	}
	for _, reached := range classes {
		if communication.SameSchoolClass(class, reached) {
			return true
		}
	}
	return false
}

// PrintParentLetters returns every letter of a published Elternbrief with
// the school that sends them. The read is written to the data access log.
func (s *service) PrintParentLetters(ctx context.Context, actorAccountID, id int64) (*communication.ParentLetterPrint, error) {
	letters, err := s.printLetters(ctx, actorAccountID, id)
	return letters, mapParentAnnouncementError(err)
}

func (s *service) printLetters(ctx context.Context, actorAccountID, id int64) (*communication.ParentLetterPrint, error) {
	a, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("announcement: load for print: %w", err)
	}
	if a == nil || isSurveyCarrier(a) {
		return nil, ErrNotFound
	}
	if !a.IsLetter() || !a.IsPublished() {
		return nil, communication.ErrParentLetterNotPrintable
	}
	copies, err := s.printCopies(ctx, a)
	if err != nil {
		return nil, err
	}
	if len(copies) == 0 {
		return nil, communication.ErrParentLetterNotPrintable
	}
	tenantID := a.GetTenantID()
	schoolName, err := s.repo.SchoolName(ctx, tenantID)
	if err != nil {
		return nil, fmt.Errorf("announcement: resolve school name: %w", err)
	}
	logo, err := s.letterLogo(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	if err := s.recordLetterAccess(ctx, communication.ParentLetterAccess{
		ActorAccountID: actorAccountID, Kind: communication.ParentLetterAccessPrint, AnnouncementID: &id, ChildCount: len(copies),
	}); err != nil {
		return nil, err
	}
	out := &communication.ParentLetterPrint{Title: a.Title, SchoolName: schoolName, Logo: logo, Copies: copies, PublishedAt: *a.PublishedAt}
	if a.SenderName != nil {
		out.SenderName = *a.SenderName
	}
	return out, nil
}

// printCopies are the letters of a dispatch: the frozen copies of a letter
// that names each child, or the one text for every recorded child.
func (s *service) printCopies(ctx context.Context, a *StaffParentAnnouncement) ([]communication.ParentLetterCopy, error) {
	if a.IsPersonalLetter() {
		copies, err := s.letters.Copies.ParentLetterCopies(ctx, a.GetTenantID(), a.ID)
		if err != nil {
			return nil, fmt.Errorf("announcement: read letter copies for print: %w", err)
		}
		return copies, nil
	}
	reached, err := s.repo.LetterChildStatuses(ctx, a.GetTenantID(), a.ID)
	if err != nil {
		return nil, fmt.Errorf("announcement: letter children for print: %w", err)
	}
	copies := make([]communication.ParentLetterCopy, 0, len(reached))
	for _, child := range reached {
		copies = append(copies, communication.ParentLetterCopy{
			AnnouncementID: a.ID, StudentID: child.StudentID, FirstName: child.FirstName, LastName: child.LastName,
			SchoolClass: child.SchoolClass, Body: a.Body,
		})
	}
	return copies, nil
}

// letterLogo is the school's login image as the printed letters show it; a
// school without one, or without a logo reader, prints none.
func (s *service) letterLogo(ctx context.Context, tenantID int64) ([]byte, error) {
	if s.letters.Logos == nil || s.settings == nil {
		return nil, nil
	}
	raw, err := s.settings.GetLoginImageURL(ctx, tenantID)
	if err != nil {
		return nil, fmt.Errorf("announcement: read the school logo: %w", err)
	}
	if raw == "" {
		return nil, nil
	}
	return s.letters.Logos.ParentLetterLogo(ctx, raw), nil
}

func (s *service) recordLetterAccess(ctx context.Context, access communication.ParentLetterAccess) error {
	if s.letters.Access == nil {
		return errParentLettersNotWired
	}
	access.AccessedAt = s.now()
	if err := s.letters.Access.RecordParentLetterAccess(ctx, access); err != nil {
		return fmt.Errorf("announcement: record letter access: %w", err)
	}
	return nil
}

// checkPlaceholders accepts the placeholders of a letter's body and refuses
// any in a Mitteilung, which goes to every family alike.
func checkPlaceholders(in *Input) error {
	if in.DeliveryMode == StaffParentAnnouncementDeliveryLetter {
		return communication.CheckParentLetterText(in.Title, in.Body)
	}
	return communication.CheckNoParentLetterPlaceholders(in.Title, in.Body)
}

// checkReminderPlaceholders refuses placeholders in the wording of a
// reminder: it goes to every family alike and is never filled per child.
func checkReminderPlaceholders(text *string) error {
	if text == nil {
		return nil
	}
	return communication.CheckNoParentLetterPlaceholders(*text)
}
