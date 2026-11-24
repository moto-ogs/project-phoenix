package httpintegration_test

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	activityContract "github.com/moto-ogs/project-phoenix/modules/timetable/activitycontract"
	"github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	"github.com/stretchr/testify/require"
)

// editorTemplates drives the owner's template writes as the editor does:
// every update and split carries the version of the segment read just before
// it (ADR 0311). The suites here test what the writes do, not the read-state
// check; TestTemplateWritesRefuseAnOlderRead covers the refusal.
type editorTemplates struct {
	timetable.TemplateAdministration
	reads timetable.TimetableDataCapability
}

// withEditorReads binds the planning's template writes to the version its
// planner reads answer.
func withEditorReads(planning compose.Planning) compose.Planning {
	planning.Templates = editorTemplates{TemplateAdministration: planning.Templates, reads: planning.Data}
	return planning
}

func (e editorTemplates) UpdateTemplate(ctx context.Context, cmd timetable.UpdateTemplateCommand) error {
	if cmd.ExpectedVersion == "" {
		version, err := readTemplateVersion(ctx, e.reads, cmd.TemplateID)
		if err != nil {
			return err
		}
		cmd.ExpectedVersion = version
	}
	return e.TemplateAdministration.UpdateTemplate(ctx, cmd)
}

func (e editorTemplates) SplitTemplate(ctx context.Context, cmd timetable.SplitTemplateCommand) (*timetable.SplitTemplateResult, error) {
	if cmd.ExpectedVersion == "" {
		version, err := readTemplateVersion(ctx, e.reads, cmd.TemplateID)
		if err != nil {
			return nil, err
		}
		cmd.ExpectedVersion = version
	}
	return e.TemplateAdministration.SplitTemplate(ctx, cmd)
}

// readTemplateVersion is the version GET /templates/{id} answers: the owner's
// ReadTemplateSeriesVersion.
func readTemplateVersion(ctx context.Context, reads timetable.TimetableDataCapability, templateID int64) (string, error) {
	version, _, err := timetable.ReadTemplateSeriesVersion(ctx, reads, templateID)
	return version, err
}

// TestTemplateWritesRefuseAnOlderRead: the Timetable owner compares the
// editor's version under the recurrence gate its update and split write
// under (ADR 0311), so a caller that skips the route cannot save over a
// colleague's change either. The version the template read answers is the
// one the owner accepts.
func TestTemplateWritesRefuseAnOlderRead(t *testing.T) {
	t.Parallel()
	effective := futureMonday(1)
	s := makeScenario(t, activityContract.WeekdayMonday, effective)
	defer s.runCleanup(t)
	editor, ok := s.timetableData.Templates.(editorTemplates)
	require.True(t, ok)
	owner := editor.TemplateAdministration
	opened, err := readTemplateVersion(s.ctx, editor.reads, s.template.ID)
	require.NoError(t, err)

	// A colleague renames the series after the editor opened.
	require.NoError(t, editor.UpdateTemplate(s.ctx, linkedTemplateUpdateInput(t, s, nil)))
	renamed := reloadSplitGroup(t, s, s.template.ID).Name

	for name, version := range map[string]string{"older read": opened, "no read": ""} {
		update := linkedTemplateUpdateInput(t, s, nil)
		update.ExpectedVersion = version
		require.ErrorIs(t, owner.UpdateTemplate(s.ctx, update), readstate.ErrChanged, name)

		split := baseSplitInput(s, effective, "Veraltet-"+name)
		split.ExpectedVersion = version
		_, err := owner.SplitTemplate(s.ctx, split)
		require.ErrorIs(t, err, readstate.ErrChanged, name)

		require.Equal(t, renamed, reloadSplitGroup(t, s, s.template.ID).Name, "%s: the refused update writes nothing", name)
		successors, err := s.db.NewSelect().TableExpr("activities.groups").Where("name = ?", split.Name).Count(s.ctx)
		require.NoError(t, err)
		require.Zero(t, successors, "%s: the refused split creates no successor", name)
	}

	current, err := readTemplateVersion(s.ctx, editor.reads, s.template.ID)
	require.NoError(t, err)
	update := linkedTemplateUpdateInput(t, s, nil)
	update.ExpectedVersion = current
	require.NoError(t, owner.UpdateTemplate(s.ctx, update), "the version of the current read is accepted")
}
