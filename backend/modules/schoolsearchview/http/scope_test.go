package schoolsearchviewhttp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/schoolsearchview"
	"github.com/stretchr/testify/require"
)

type staffCheck struct {
	staff bool
	err   error
}

func (s staffCheck) HasCurrentStaff(context.Context) (bool, error) { return s.staff, s.err }

func scopeFor(t *testing.T, staff staffCheck, granted ...string) schoolsearchview.Scope {
	t.Helper()
	resource := &Resource{staff: staff}
	scope, err := resource.scope(context.WithValue(context.Background(), sessiontoken.CtxPermissions, granted))
	require.NoError(t, err)
	return scope
}

func TestScopeOpensEachKindWithThePermissionOfItsPage(t *testing.T) {
	t.Parallel()
	staff := staffCheck{staff: true}
	require.Equal(t, schoolsearchview.Scope{Children: true, ChildDetails: true, Contacts: true, Staff: true},
		scopeFor(t, staff, permissions.UsersRead), "users:read opens children, their details, contacts and the staff list")
	require.Equal(t, schoolsearchview.Scope{Children: true},
		scopeFor(t, staff, permissions.StudentsRead), "the guest reads names, never contact data or answers")
	require.Equal(t, schoolsearchview.Scope{Rooms: true},
		scopeFor(t, staff, permissions.RoomsRead))
	require.Equal(t, schoolsearchview.Scope{},
		scopeFor(t, staff, permissions.GroupsRead), "a group hit leads to the child list, so it needs a child read")
	require.Equal(t, schoolsearchview.Scope{Children: true, Groups: true},
		scopeFor(t, staff, permissions.StudentsRead, permissions.GroupsRead))
	require.Equal(t, schoolsearchview.Scope{Staff: true},
		scopeFor(t, staff, permissions.StaffStammdaten))
	require.Equal(t, schoolsearchview.Scope{Children: true, ChildDetails: true, Contacts: true, Staff: true, Rooms: true, Groups: true},
		scopeFor(t, staffCheck{}, permissions.AdminWildcard), "an administrator reads everything without a staff record")
}

func TestScopeClosesChildDataToAccountsWithoutAStaffRecord(t *testing.T) {
	t.Parallel()
	require.Equal(t, schoolsearchview.Scope{Staff: true}, scopeFor(t, staffCheck{}, permissions.UsersRead))
	resource := &Resource{staff: staffCheck{err: errors.New("lookup failed")}}
	_, err := resource.scope(context.WithValue(context.Background(), sessiontoken.CtxPermissions, []string{permissions.UsersRead}))
	require.Error(t, err, "an unknown staff check never widens the scope")
}

// recordingSearch answers every query with its scope and hands the query on.
type recordingSearch func(schoolsearchview.Query)

func (record recordingSearch) SearchSchool(_ context.Context, query schoolsearchview.Query) (schoolsearchview.Result, error) {
	record(query)
	return schoolsearchview.Result{Scope: query.Scope}, nil
}

// fixedNotes answers the note audience and reports each question.
type fixedNotes func() (*schoolsearchview.NoteReader, error)

func (answer fixedNotes) NoteReader(context.Context) (*schoolsearchview.NoteReader, error) {
	return answer()
}

// TestNoteCardsOpenWithTheChildDetails resolves the note audience only for a
// caller who reads the child details, hands it to the search, and fails the
// search when the audience cannot be read (ADR 0234).
func TestNoteCardsOpenWithTheChildDetails(t *testing.T) {
	t.Parallel()
	direct := func(r chi.Router, mount func(chi.Router, func(http.Handler) http.Handler)) {
		mount(r, func(next http.Handler) http.Handler { return next })
	}
	post := func(resource *Resource, granted ...string) int {
		rr := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"query":"zoo"}`))
		request = request.WithContext(context.WithValue(request.Context(), sessiontoken.CtxPermissions, granted))
		resource.Router(direct).ServeHTTP(rr, request)
		return rr.Code
	}
	reader := &schoolsearchview.NoteReader{AccountID: 7}
	run := func(notes fixedNotes, granted ...string) (int, []schoolsearchview.Query) {
		var queries []schoolsearchview.Query
		code := post(NewResource(recordingSearch(func(query schoolsearchview.Query) { queries = append(queries, query) }), staffCheck{staff: true}, notes), granted...)
		return code, queries
	}
	asked := 0
	answer := func() (*schoolsearchview.NoteReader, error) { asked++; return reader, nil }

	code, queries := run(answer, permissions.UsersRead)
	require.Equal(t, http.StatusOK, code)
	require.Same(t, reader, queries[0].Notes)

	asked = 0
	code, queries = run(answer, permissions.StudentsRead)
	require.Equal(t, http.StatusOK, code)
	require.Nil(t, queries[0].Notes, "the guest reads names, never notes")
	require.Zero(t, asked)

	code, queries = run(func() (*schoolsearchview.NoteReader, error) { return nil, errors.New("lookup failed") }, permissions.UsersRead)
	require.Equal(t, http.StatusInternalServerError, code)
	require.Empty(t, queries, "an unknown audience never searches")
}
