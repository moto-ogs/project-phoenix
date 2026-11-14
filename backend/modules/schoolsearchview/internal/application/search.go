// Package application runs one school search (ADR 0231): it reads the query
// once, asks the reader only for the kinds the Scope opens and joins the
// notes People Directory matched (ADR 0234) and the registration answers
// Enrollment matched to the child rows.
package application

import (
	"context"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/schoolsearchview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Reader is the projection's SQL side. Every read runs in the caller's tenant
// transaction and returns bounded lists.
type Reader interface {
	// Search reads every kind the scope opens in one statement: children by
	// name, class or group and with ChildDetails also by their parent note
	// (Elternnotizen); contact persons of a child at the school by name or
	// e-mail address, or by the phone key and its alternative reading when
	// phoneKey is not empty; staff, rooms and groups by name.
	Search(ctx context.Context, text, phoneKey, alternativeKey string, scope schoolsearchview.Scope) (schoolsearchview.Result, error)
	// ChildrenByID reads the first limit of the given children that are
	// still at the school, in the order of ids, with their OGS group.
	ChildrenByID(ctx context.Context, ids []int64, limit int) ([]schoolsearchview.Child, error)
}

// Search is the projection's search capability.
type Search struct {
	reader     Reader
	answers    schoolsearchview.StudentAnswerSearch
	notes      schoolsearchview.StudentNoteSearch
	activities schoolsearchview.ActivityEnrollments
	today      func() calendar.Date
}

// New builds the search; every port is required.
func New(reader Reader, answers schoolsearchview.StudentAnswerSearch, notes schoolsearchview.StudentNoteSearch, activities schoolsearchview.ActivityEnrollments) (*Search, error) {
	if reader == nil || answers == nil || notes == nil || activities == nil {
		return nil, errors.New("school search: reader, answer, note and activity searches are required")
	}
	return &Search{reader: reader, answers: answers, notes: notes, activities: activities, today: calendar.TodayDate}, nil
}

// SearchSchool answers one query within its Scope. Contact persons match a
// phone query by its key; every other field compares the text as typed, so
// digits still find a room "1012" or a parent note that names a number.
func (s *Search) SearchSchool(ctx context.Context, query schoolsearchview.Query) (schoolsearchview.Result, error) {
	empty := schoolsearchview.Result{
		Children: []schoolsearchview.Child{}, Contacts: []schoolsearchview.Contact{},
		Staff: []schoolsearchview.Staff{}, Rooms: []schoolsearchview.Room{}, Groups: []schoolsearchview.Group{},
		Scope: query.Scope,
	}
	text, err := schoolsearchview.ValidateQueryText(query.Text)
	if err != nil {
		return empty, err
	}
	scope := query.Scope
	result, err := s.reader.Search(ctx, text, schoolsearchview.PhoneSearchKey(text), schoolsearchview.PhoneSearchAlternativeKey(text), scope)
	if err != nil {
		return empty, fmt.Errorf("school search: %w", err)
	}
	result.Scope = scope
	withNoteSnippets(result.Children, text)
	if scope.Children && scope.ChildDetails {
		result.Children, err = s.withDetailHits(ctx, text, result.Children, query.Notes)
		if err != nil {
			return empty, err
		}
	}
	return result, nil
}

// detailHit is the reason a child is found beyond its own row: its newest
// matching note the reader reaches (one that needs no care team first) or its
// registration answer. A note that reaches the caller
// only through the child's care team keeps the answer as a fallback.
type detailHit struct {
	match        schoolsearchview.Match
	careTeamOnly bool
	fallback     *schoolsearchview.Match
}

// detailHits are the children found through a note or an answer, in the
// order they were found, without the children the direct hits name.
type detailHits struct {
	found map[int64]bool
	hits  map[int64]*detailHit
	order []int64
}

func newDetailHits(children []schoolsearchview.Child) *detailHits {
	found := make(map[int64]bool, len(children))
	for _, child := range children {
		found[child.ID] = true
	}
	return &detailHits{found: found, hits: map[int64]*detailHit{}}
}

// addNote takes a child's newest note; the first note of a child counts.
func (d *detailHits) addNote(hit schoolsearchview.NoteHit, text string) {
	if d.found[hit.StudentID] || d.hits[hit.StudentID] != nil {
		return
	}
	d.hits[hit.StudentID] = &detailHit{
		match:        schoolsearchview.Match{Field: schoolsearchview.MatchStudentNote, Text: matchSnippet(hit.Body, text)},
		careTeamOnly: hit.CareTeamOnly,
	}
	d.order = append(d.order, hit.StudentID)
}

// addAnswer takes a child's answer: as its reason, or as the fallback of a
// note that waits for the care team.
func (d *detailHits) addAnswer(studentID int64, match schoolsearchview.Match) {
	if d.found[studentID] {
		return
	}
	if hit := d.hits[studentID]; hit != nil {
		if hit.careTeamOnly && hit.fallback == nil {
			hit.fallback = &match
		}
		return
	}
	d.hits[studentID] = &detailHit{match: match}
	d.order = append(d.order, studentID)
}

// withDetailHits appends the children found through a note or a
// registration answer after the direct hits, up to the child limit: notes
// first, newest first, then answers, newest registrations first. A child
// already found directly keeps its direct reason. Both owners may name
// children who have left the school, so the search asks for every hit and
// keeps the first ones still at the school: former pupils never leave a free
// place empty.
func (s *Search) withDetailHits(ctx context.Context, text string, children []schoolsearchview.Child, notes *schoolsearchview.NoteReader) ([]schoolsearchview.Child, error) {
	if len(children) >= schoolsearchview.ChildLimit {
		return children, nil
	}
	found := newDetailHits(children)
	if err := s.findNotes(ctx, text, notes, found); err != nil {
		return nil, err
	}
	answers, err := s.answers.SearchStudentAnswers(ctx, text, 0)
	if err != nil {
		return nil, fmt.Errorf("school search: registration answers: %w", err)
	}
	for _, answer := range answers {
		found.addAnswer(answer.StudentID, schoolsearchview.Match{Field: schoolsearchview.MatchEnrollmentAnswer, Label: answer.Label, Text: matchSnippet(answer.Answer, text)})
	}
	if len(found.order) == 0 {
		return children, nil
	}
	rows, err := s.reader.ChildrenByID(ctx, found.order, len(found.order))
	if err != nil {
		return nil, fmt.Errorf("school search: detail children: %w", err)
	}
	if err := s.resolveCareTeam(ctx, rows, found.hits, notes); err != nil {
		return nil, err
	}
	return found.appendTo(children, rows), nil
}

// appendTo fills the free places with the rows that kept a reason: note hits
// first, then answer hits, each in the order they were found. A child whose
// care team note fell back to its answer moves to the answers.
func (d *detailHits) appendTo(children, rows []schoolsearchview.Child) []schoolsearchview.Child {
	for _, notes := range []bool{true, false} {
		for _, row := range rows {
			if len(children) == schoolsearchview.ChildLimit {
				return children
			}
			hit := d.hits[row.ID]
			if hit == nil || (hit.match.Field == schoolsearchview.MatchStudentNote) != notes {
				continue
			}
			row.Match = hit.match
			children = append(children, row)
		}
	}
	return children
}

// findNotes asks People Directory for the notes the reader's audience
// reaches; nil reads no note.
func (s *Search) findNotes(ctx context.Context, text string, notes *schoolsearchview.NoteReader, found *detailHits) error {
	if notes == nil {
		return nil
	}
	hits, err := s.notes.SearchNotes(ctx, schoolsearchview.NoteSearch{
		Text: text, ReaderAccountID: notes.AccountID, Admin: notes.Admin,
		LedActivityGroupIDs: notes.LedActivityGroupIDs, LedEducationGroupIDs: notes.LedEducationGroupIDs,
	})
	if err != nil {
		return fmt.Errorf("school search: notes: %w", err)
	}
	for _, hit := range hits {
		found.addNote(hit, text)
	}
	return nil
}

// resolveCareTeam answers the care team question for the children found only
// through a care team note, with the card's rule: the child's group, class
// and today's activities against the caller's. A child outside the caller's
// care team keeps its answer hit, or is no hit at all. The activities of all
// those children come in one read.
func (s *Search) resolveCareTeam(ctx context.Context, rows []schoolsearchview.Child, hits map[int64]*detailHit, notes *schoolsearchview.NoteReader) error {
	pending := make([]int64, 0)
	for _, row := range rows {
		if hit := hits[row.ID]; hit != nil && hit.careTeamOnly {
			pending = append(pending, row.ID)
		}
	}
	if len(pending) == 0 {
		return nil
	}
	activities, err := s.activities.ActivityGroupIDs(ctx, pending, s.today())
	if err != nil {
		return fmt.Errorf("school search: activities of note children: %w", err)
	}
	for _, row := range rows {
		hit := hits[row.ID]
		if hit == nil || !hit.careTeamOnly {
			continue
		}
		child := schoolsearchview.NoteChild{GroupID: row.GroupID, SchoolClass: row.SchoolClass, ActivityGroupIDs: activities[row.ID]}
		switch {
		case notes.HasChildOf(child):
		case hit.fallback != nil:
			hits[row.ID] = &detailHit{match: *hit.fallback}
		default:
			delete(hits, row.ID)
		}
	}
	return nil
}

// withNoteSnippets cuts the parent note of a note hit to the part around the
// match.
func withNoteSnippets(children []schoolsearchview.Child, text string) {
	for i := range children {
		if children[i].Match.Field == schoolsearchview.MatchParentNote {
			children[i].Match.Text = matchSnippet(children[i].Match.Text, text)
		}
	}
}
