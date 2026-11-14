package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/collation"
	"github.com/uptrace/bun"
)

// searchNotesSQL: care_team, admin, reader, text, tenant, visibilities,
// reader, group_leads, led activities, group_leads, led groups.
//
// It is applyAudience for every child at once, with the care_team audience
// granted to all of them: whether the reader has a child follows from
// groups, activities and classes of other owners, so the caller answers it
// for the hits that need it (care_team_only). Per child the statement keeps
// the newest note, one that needs no care team before one that does, so a
// child the reader reaches anyway is never dropped by that answer.
//
// The statement carries the typed text, so it opens with the marker that
// keeps its literals out of the query log (ADR 0231 point 5).
const searchNotesSQL = collation.RedactLiteralsInLog + `SELECT hit.student_id, hit.id, hit.body, hit.care_team_only FROM (
	SELECT DISTINCT ON (note.student_id) note.student_id, note.id, note.body, note.created_at,
		(note.visibility = ? AND NOT ? AND note.author_account_id IS DISTINCT FROM ?) AS care_team_only
	FROM users.student_notes AS note
	CROSS JOIN (SELECT '%' || ` + collation.UnaccentLikePatternSQL + ` || '%' AS p) AS q
	WHERE note.tenant_id = ? AND note.deleted_at IS NULL
		AND public.f_unaccent(note.body) ILIKE q.p ESCAPE '\'
		AND (note.visibility IN (?)
			OR note.author_account_id = ?
			OR (note.visibility = ? AND note.activity_group_id = ANY(ARRAY[?]::bigint[]))
			OR (note.visibility = ? AND note.education_group_id = ANY(ARRAY[?]::bigint[])))
	ORDER BY note.student_id, care_team_only, note.created_at DESC, note.id DESC
) AS hit
ORDER BY hit.created_at DESC, hit.id DESC`

type noteSearchRow struct {
	StudentID    int64  `bun:"student_id"`
	ID           int64  `bun:"id"`
	Body         string `bun:"body"`
	CareTeamOnly bool   `bun:"care_team_only"`
}

// Search finds the newest matching note of every child the search audience
// reaches. Like List it only turns the caller's answer into SQL.
func (s *StudentNoteStore) Search(ctx context.Context, search domain.StudentNoteSearch) ([]domain.StudentNoteSearchHit, domain.OperationStats, error) {
	db, scope, err := s.tenantDatabase(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	visibilities := []string{domain.StudentNoteVisibilityAllStaff, domain.StudentNoteVisibilityCareTeam}
	if search.Admin {
		visibilities = append(visibilities, domain.StudentNoteVisibilityGroupLeads)
	}
	var rows []noteSearchRow
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	err = db.NewRaw(searchNotesSQL,
		domain.StudentNoteVisibilityCareTeam, search.Admin, search.ReaderAccountID,
		search.Text, scope.TenantID, bun.List(visibilities), search.ReaderAccountID,
		domain.StudentNoteVisibilityGroupLeads, bun.List(idsOrNone(search.LedActivityGroupIDs)),
		domain.StudentNoteVisibilityGroupLeads, bun.List(idsOrNone(search.LedEducationGroupIDs)),
	).Scan(ctx, &rows)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return nil, stats, fmt.Errorf("search student notes: %w", err)
	}
	stats.Rows = int64(len(rows))
	hits := make([]domain.StudentNoteSearchHit, 0, len(rows))
	for _, row := range rows {
		hits = append(hits, domain.StudentNoteSearchHit{
			StudentID: row.StudentID, NoteID: row.ID, Body: row.Body, CareTeamOnly: row.CareTeamOnly,
		})
	}
	return hits, stats, nil
}

// idsOrNone keeps ARRAY[...] well formed for a reader who leads no group:
// an ID is positive, so 0 matches no note.
func idsOrNone(ids []int64) []int64 {
	if len(ids) == 0 {
		return []int64{0}
	}
	return ids
}
