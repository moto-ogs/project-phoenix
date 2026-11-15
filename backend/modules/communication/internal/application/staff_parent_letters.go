package application

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/communication"
)

// Serienbriefe (#4813): a published Elternbrief is one letter per reached
// child. Publishing writes each child's letter once (ParentLetterCopy); the
// mail, the parent portal and the printed letters read those copies, so a
// letter stays as it went out.

// freezeLetterCopies writes the letter of every child the publication
// reached. It runs in the publish transaction after the children were
// recorded, so the copies are exactly the recorded children.
func (s *service) freezeLetterCopies(ctx context.Context, a *StaffParentAnnouncement) error {
	if !a.IsLetter() || s.letters.Copies == nil {
		return nil
	}
	tenantID := a.GetTenantID()
	reached, err := s.repo.LetterChildStatuses(ctx, tenantID, a.ID)
	if err != nil {
		return fmt.Errorf("announcement: letter children for copies: %w", err)
	}
	copies := make([]communication.ParentLetterCopy, 0, len(reached))
	byStudent := map[int64]communication.ParentLetterChild{}
	if communication.HasParentLetterPlaceholders(a.Body) {
		if byStudent, err = s.letterChildValues(ctx, letterChildIDs(reached)); err != nil {
			return err
		}
	}
	publishedAt := s.now()
	if a.PublishedAt != nil {
		publishedAt = *a.PublishedAt
	}
	for _, child := range reached {
		values, ok := byStudent[child.StudentID]
		if !ok {
			values = communication.ParentLetterChild{StudentID: child.StudentID, FirstName: child.FirstName, LastName: child.LastName, SchoolClass: child.SchoolClass}
		}
		copies = append(copies, communication.ParentLetterCopy{
			AnnouncementID: a.ID, StudentID: child.StudentID, FirstName: child.FirstName, LastName: child.LastName,
			SchoolClass: child.SchoolClass, Body: communication.FillParentLetter(a.Body, values), PublishedAt: publishedAt,
		})
	}
	if err := s.letters.Copies.ReplaceParentLetterCopies(ctx, tenantID, a.ID, copies); err != nil {
		return fmt.Errorf("announcement: write letter copies: %w", err)
	}
	if len(copies) > 0 && s.letters.Access != nil {
		// The publication froze a letter with each reached child's data (#4813).
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

// letterChildValues reads the placeholder values of a set of children in
// one read.
func (s *service) letterChildValues(ctx context.Context, studentIDs []int64) (map[int64]communication.ParentLetterChild, error) {
	out := make(map[int64]communication.ParentLetterChild, len(studentIDs))
	if len(studentIDs) == 0 {
		return out, nil
	}
	if s.letters.Children == nil {
		return nil, fmt.Errorf("announcement: letter placeholders need the child values, which are not wired")
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
	if !a.IsLetter() || !communication.HasParentLetterPlaceholders(a.Body) || s.letters.Copies == nil {
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
		c, ok := b[id]
		if !ok {
			continue
		}
		parts = append(parts, c)
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
	if err := communication.CheckParentLetterPlaceholders(true, "", body); err != nil {
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
	if !a.IsLetter() || !a.IsPublished() || s.letters.Copies == nil {
		return nil, communication.ErrParentLetterNotPrintable
	}
	tenantID := a.GetTenantID()
	copies, err := s.printCopies(ctx, a)
	if err != nil {
		return nil, err
	}
	if len(copies) == 0 {
		return nil, communication.ErrParentLetterNotPrintable
	}
	schoolName, err := s.repo.SchoolName(ctx, tenantID)
	if err != nil {
		return nil, fmt.Errorf("announcement: resolve school name: %w", err)
	}
	var logo []byte
	if s.letters.Logos != nil && s.settings != nil {
		if raw, err := s.settings.GetLoginImageURL(ctx, tenantID); err == nil && raw != "" {
			logo = s.letters.Logos.ParentLetterLogo(ctx, raw)
		}
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

func (s *service) recordLetterAccess(ctx context.Context, access communication.ParentLetterAccess) error {
	if s.letters.Access == nil {
		return fmt.Errorf("announcement: letter access needs the data access log, which is not wired")
	}
	access.AccessedAt = s.now()
	if err := s.letters.Access.RecordParentLetterAccess(ctx, access); err != nil {
		return fmt.Errorf("announcement: record letter access: %w", err)
	}
	return nil
}

// checkReminderPlaceholders refuses placeholders in the wording of a
// reminder: it goes to every family alike and is never filled per child.
func checkReminderPlaceholders(text *string) error {
	if text == nil {
		return nil
	}
	return communication.CheckParentLetterPlaceholders(false, "", *text)
}

// inLetterClasses reports whether a child's class is one of classes; nil
// classes admit every child of the school.
func inLetterClasses(class string, classes []string) bool {
	if classes == nil {
		return true
	}
	wanted := strings.TrimSpace(class)
	for _, reached := range classes {
		if wanted != "" && strings.EqualFold(strings.TrimSpace(reached), wanted) {
			return true
		}
	}
	return false
}

// printCopies are the letters of a dispatch: the frozen copies, or for a
// letter published before the copies existed (#4813) and naming nobody, its
// one text for every child the publication recorded.
func (s *service) printCopies(ctx context.Context, a *StaffParentAnnouncement) ([]communication.ParentLetterCopy, error) {
	tenantID := a.GetTenantID()
	copies, err := s.letters.Copies.ParentLetterCopies(ctx, tenantID, a.ID)
	if err != nil {
		return nil, fmt.Errorf("announcement: read letter copies for print: %w", err)
	}
	if len(copies) > 0 || communication.HasParentLetterPlaceholders(a.Body) {
		return copies, nil
	}
	reached, err := s.repo.LetterChildStatuses(ctx, tenantID, a.ID)
	if err != nil {
		return nil, fmt.Errorf("announcement: letter children for print: %w", err)
	}
	for _, child := range reached {
		copies = append(copies, communication.ParentLetterCopy{
			AnnouncementID: a.ID, StudentID: child.StudentID, FirstName: child.FirstName, LastName: child.LastName,
			SchoolClass: child.SchoolClass, Body: a.Body, PublishedAt: *a.PublishedAt,
		})
	}
	return copies, nil
}
