package owners

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	peopleValues "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	educationRepo "github.com/moto-ogs/project-phoenix/modules/schoolstructure/compose"
	presenceCompose "github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
)

type navigationGroups map[int64]*educationRepo.Group

func (g navigationGroups) FindByIDs(_ context.Context, ids []int64) (map[int64]*educationRepo.Group, error) {
	if g == nil {
		return nil, errors.New("groups down")
	}
	result := map[int64]*educationRepo.Group{}
	for _, id := range ids {
		if group := g[id]; group != nil {
			result[id] = group
		}
	}
	return result, nil
}

type navigationStaff struct{ staffRows }

func (navigationStaff) FindByID(_ context.Context, id any) (*peopleValues.Staff, error) {
	at := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	notes := "<b>Früh & spät</b>"
	return &peopleValues.Staff{ID: id.(int64), CreatedAt: at, UpdatedAt: at, TenantID: 7, PersonID: 41, EmploymentType: &notes}, nil
}

type navigationSessions struct {
	callerSessionRows
	rows []*presenceCompose.SessionRow
	err  error
}

func (s navigationSessions) SessionRows(context.Context, []int64) (any, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.rows, nil
}

// legacyNavigationJSON renders a navigation the way GET /api/me/navigation did
// before the route had a response type (#7563): the root's row with any-typed
// members, re-encoded as a map with the school switches added, inside the
// shared envelope, through go-chi/render's HTML-escaping encoder.
func legacyNavigationJSON(t *testing.T, row *CallerNavigationRow) []byte {
	t.Helper()
	legacy := struct {
		EducationalGroups   []*CallerGroupRow `json:"educational_groups"`
		SupervisedGroups    any               `json:"supervised_groups"`
		CurrentStaff        any               `json:"current_staff"`
		Incomplete          bool              `json:"incomplete"`
		UnavailableSections []string          `json:"unavailable_sections"`
	}{row.EducationalGroups, row.SupervisedGroups, row.CurrentStaff, row.Incomplete, row.UnavailableSections}
	encoded, err := json.Marshal(legacy)
	require.NoError(t, err)
	fields := map[string]json.RawMessage{}
	require.NoError(t, json.Unmarshal(encoded, &fields))
	fields["school_switches"], err = json.Marshal(row.SchoolSwitches)
	require.NoError(t, err)
	return envelopeJSON(t, fields)
}

func envelopeJSON(t *testing.T, data any) []byte {
	t.Helper()
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(true)
	require.NoError(t, encoder.Encode(map[string]any{"status": "success", "data": data, "message": "Navigation context retrieved successfully"}))
	return buf.Bytes()
}

// The typed navigation response sends the same bytes as the map the route
// rendered before (#7563): same keys in the same order, same nulls, same
// escaping, for a complete, an incomplete and a staff-less navigation.
func TestCallerNavigationRowSendsTheBytesOfTheFormerMap(t *testing.T) {
	t.Parallel()

	at := time.Date(2026, 9, 2, 9, 30, 0, 0, time.UTC)
	roomID := int64(5)
	groups := navigationGroups{
		3: {ID: 3, CreatedAt: at, UpdatedAt: at, TenantID: 7, Name: "Rot & <Blau>", RoomID: &roomID},
		4: {ID: 4, CreatedAt: at, UpdatedAt: at, TenantID: 7, Name: "Grün"},
	}
	sessions := []*presenceCompose.SessionRow{{ID: 9, CreatedAt: at, UpdatedAt: at, TenantID: 7, StartTime: at, LastActivity: at, TimeoutMinutes: 30, RoomID: 5}}
	switches := identityaccess.SchoolSwitches{ParentNewsEnabled: true, ParentInviteMode: "staff_approval", TimetableDayStartTime: "07:30", TimetableDayEndTime: "16:00"}

	check := func(name string, groups groupRows, sessions navigationSessions, navigation identityaccess.CallerNavigation) {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			rows := &CallerRows{groups: groups, staff: navigationStaff{}, sessions: sessions, logger: slog.New(slog.DiscardHandler)}
			answer, err := rows.NavigationRow(context.Background(), navigation, switches)
			require.NoError(t, err)
			row, ok := answer.(*CallerNavigationRow)
			require.True(t, ok, "the navigation answers its registered type, got %T", answer)

			require.Equal(t, string(legacyNavigationJSON(t, row)), string(envelopeJSON(t, row)))
		})
	}
	check("complete", groups, navigationSessions{rows: sessions}, identityaccess.CallerNavigation{
		Groups: []identityaccess.CallerGroup{{ID: 3, ViaSubstitution: true}, {ID: 4}}, SupervisedSessionIDs: []int64{9}, StaffID: 12, UnavailableSections: []string{},
	})
	check("incomplete", navigationGroups(nil), navigationSessions{err: errors.New("sessions down")}, identityaccess.CallerNavigation{
		Groups: []identityaccess.CallerGroup{{ID: 3}}, SupervisedSessionIDs: []int64{9}, StaffID: 12,
	})
	check("without staff", groups, navigationSessions{rows: []*presenceCompose.SessionRow{}}, identityaccess.CallerNavigation{UnavailableSections: []string{}})
	check("nil sections", groups, navigationSessions{rows: []*presenceCompose.SessionRow{}}, identityaccess.CallerNavigation{})
}
