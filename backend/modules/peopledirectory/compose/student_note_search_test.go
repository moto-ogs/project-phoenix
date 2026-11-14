package compose

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// TestStudentNoteSearchAppliesTheCardsAudience searches every child's note
// card (#7012, ADR 0234) with the card's predicate: the team note for
// everybody, a care team note marked for the caller's care team question,
// a leadership note for the leadership of its group, every own note, and
// everything for an administrator. Deleted notes and other schools' notes
// never match; each child comes once, with its newest note.
func TestStudentNoteSearchAppliesTheCardsAudience(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	directory, err := New(Dependencies{
		StudentDirectory: testpkg.StudentDirectory{}, DB: db, StudentNoteDeletionAudit: testStudentNoteDeletionAudit{Db: db},
		Observe: func(Observation) {},
	}, nil)
	require.NoError(t, err)
	module, search := directory.Owner, directory.StudentNotes
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	author := noteAuthor(t, db, "Ana", "Autorin")
	reader := noteAuthor(t, db, "Leo", "Leser")
	group := testpkg.CreateTestEducationGroupForTenant(t, db, tenantID, "Suche-Gruppe")
	date := calendar.NewDate(2026, 9, 9)

	write := func(child int64, writer int64, visibility, body string, educationGroupID *int64) int64 {
		t.Helper()
		note, err := module.CreateStudentNote(ctx, peopledirectory.CreateStudentNote{
			StudentID: child, AuthorAccountID: writer,
			Kind: peopledirectory.StudentNoteKindJournal, Visibility: visibility, Body: body,
			Subject: peopledirectory.StudentNoteSubject{Date: &date, EducationGroupID: educationGroupID},
		})
		require.NoError(t, err)
		return note.ID
	}
	team := testpkg.CreateTestStudent(t, db, "Tia", "Team", "2a")
	care := testpkg.CreateTestStudent(t, db, "Cora", "Care", "2a")
	lead := testpkg.CreateTestStudent(t, db, "Lio", "Lead", "2a")
	own := testpkg.CreateTestStudent(t, db, "Oda", "Own", "2a")
	gone := testpkg.CreateTestStudent(t, db, "Gil", "Gone", "2a")
	write(team.ID, author, peopledirectory.StudentNoteVisibilityAllStaff, "Älterer Eintrag zum Zoobesuch", nil)
	newest := write(team.ID, author, peopledirectory.StudentNoteVisibilityAllStaff, "Beim ZOO-Besuch müde", nil)
	write(care.ID, author, peopledirectory.StudentNoteVisibilityCareTeam, "Im Zoo geweint", nil)
	write(lead.ID, author, peopledirectory.StudentNoteVisibilityGroupLeads, "Zoo: Gespräch mit Eltern", &group.ID)
	write(own.ID, reader, peopledirectory.StudentNoteVisibilityCareTeam, "Zoo-Ticket vergessen", nil)
	deleted := write(gone.ID, author, peopledirectory.StudentNoteVisibilityAllStaff, "Zoo", nil)
	_, err = db.NewRaw(`UPDATE users.student_notes SET deleted_at = now(), deleted_by_account_id = ? WHERE id = ?`, author, deleted).Exec(ctx)
	require.NoError(t, err)
	otherTenant := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, otherTenant)
	foreign := testpkg.CreateTestStudentForTenant(t, db, otherTenant, "Fremd", "Kind", "2a")
	_, err = db.NewRaw(`INSERT INTO users.student_notes (tenant_id, student_id, kind, visibility, body, subject_date)
		VALUES (?, ?, 'journal', 'all_staff', 'Zoo der anderen Schule', '2026-09-09')`, otherTenant, foreign.ID).Exec(ctx)
	require.NoError(t, err)

	hits := func(request peopledirectory.StudentNoteSearchRequest) map[int64]peopledirectory.StudentNoteSearchHit {
		t.Helper()
		request.Text = "zoo"
		found := searchNotes(t, db, search, request)
		byChild := map[int64]peopledirectory.StudentNoteSearchHit{}
		for _, hit := range found {
			require.NotContains(t, byChild, hit.StudentID, "one hit per child")
			byChild[hit.StudentID] = hit
		}
		return byChild
	}

	colleague := hits(peopledirectory.StudentNoteSearchRequest{ReaderAccountID: reader})
	assert.ElementsMatch(t, []int64{team.ID, care.ID, own.ID}, keys(colleague), "no leadership note, no deleted note, no other school")
	assert.Equal(t, newest, colleague[team.ID].NoteID, "the newest matching note, folded like a name search")
	assert.False(t, colleague[team.ID].CareTeamOnly)
	assert.True(t, colleague[care.ID].CareTeamOnly, "a care team note waits for the caller's care team answer")
	assert.False(t, colleague[own.ID].CareTeamOnly, "an own note needs no care team")

	leader := hits(peopledirectory.StudentNoteSearchRequest{ReaderAccountID: reader, LedEducationGroupIDs: []int64{group.ID}})
	assert.Contains(t, leader, lead.ID, "the lead of the referenced group finds its note")

	admin := hits(peopledirectory.StudentNoteSearchRequest{ReaderAccountID: reader, Admin: true})
	assert.ElementsMatch(t, []int64{team.ID, care.ID, lead.ID, own.ID}, keys(admin))
	assert.False(t, admin[care.ID].CareTeamOnly, "an administrator is in every care team")

	assert.Empty(t, searchNotes(t, db, search, peopledirectory.StudentNoteSearchRequest{Text: "%", ReaderAccountID: reader, Admin: true}),
		"a LIKE metacharacter is a character")
	_, err = search.SearchStudentNotes(ctx, peopledirectory.StudentNoteSearchRequest{Text: "zoo", ReaderAccountID: reader})
	assert.Error(t, err, "the search runs in the caller's school transaction and opens none of its own")
}

// searchNotes runs the search inside the school transaction of a request.
func searchNotes(t *testing.T, db *testpkg.DB, search peopledirectory.StudentNoteSearch, request peopledirectory.StudentNoteSearchRequest) []peopledirectory.StudentNoteSearchHit {
	t.Helper()
	var found []peopledirectory.StudentNoteSearchHit
	require.NoError(t, testpkg.WithTenantTx(t, testpkg.Ctx(t), db, testpkg.Tenant(t), func(ctx context.Context, _ bun.Tx) error {
		var err error
		found, err = search.SearchStudentNotes(ctx, request)
		return err
	}))
	return found
}

func keys(hits map[int64]peopledirectory.StudentNoteSearchHit) []int64 {
	out := make([]int64, 0, len(hits))
	for id := range hits {
		out = append(out, id)
	}
	return out
}
