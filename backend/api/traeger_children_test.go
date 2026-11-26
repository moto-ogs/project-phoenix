package api

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/collation"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// traegerChildrenSignIn signs a new member of the Träger with role in and
// returns its token and account.
func traegerChildrenSignIn(t *testing.T, db *bun.DB, router *traegerPortalHandler, organization int64, role string) (string, int64) {
	t.Helper()
	password := testpkg.NewTestPassword()
	account := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, account.ID, role)
	code, answer := traegerSignIn(t, router, account.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	return answer.AccessToken, account.ID
}

func traegerChildren(t *testing.T, router http.Handler, token, query string) traegerview.TraegerChildren {
	t.Helper()
	rec := traegerOccupancyRequest(t, router, "/traeger/schools/children"+query, token, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[traegerview.TraegerChildren](t, rec.Body.Bytes())
}

func childNames(children []traegerview.TraegerChild) []string {
	names := make([]string, 0, len(children))
	for _, child := range children {
		names = append(names, child.LastName+", "+child.FirstName)
	}
	return names
}

// #8137: the Träger-Büro sees the children of all its schools in one list,
// each with its school, its class and its group, and narrows it to one
// school or by a part of the name.
func TestTraegerChildrenListTheChildrenOfEverySchoolByName(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	organization := traegerOrganization(t, db, "Träger Kinderliste", true)
	bach := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Am Bach")
	linde := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Zur Linde")
	foreign := testpkg.CreateTestSchoolInOrganization(t, db, traegerOrganization(t, db, "Träger Fremde Kinder", true), "OGS Fremd")
	eulen := testpkg.CreateTestEducationGroupForTenant(t, db, bach, "Eulen")
	mia := testpkg.CreateTestStudentForTenant(t, db, bach, "Mia", "Zander", "2b")
	testpkg.AssignStudentToGroup(t, db, mia.ID, eulen.ID)
	testpkg.CreateTestStudentForTenant(t, db, bach, "Ömer", "Aksoy", "1a")
	anna := testpkg.CreateTestStudentForTenant(t, db, linde, "Anna", "Berg", "3c")
	testpkg.CreateTestStudentForTenant(t, db, foreign, "Fritz", "Fremd", "4a")
	// A child that left is no child of the Stichtagszahl rule any more.
	left := testpkg.CreateTestStudentForTenant(t, db, linde, "Lars", "Fort", "4a")
	_, err := db.ExecContext(context.Background(), `UPDATE users.student_school_memberships
		SET enrolled_until = CURRENT_DATE - 1 WHERE tenant_id = ? AND student_profile_id = ?`, linde, left.ID)
	require.NoError(t, err)
	token, _ := traegerChildrenSignIn(t, db, router, organization, identityaccess.TraegerRoleAdministration)

	all := traegerChildren(t, router, token, "")
	assert.Equal(t, []string{"Aksoy, Ömer", "Berg, Anna", "Zander, Mia"}, childNames(all.Children), "every counted child of the Träger, by last name")
	assert.Equal(t, 3, all.Total)
	assert.Equal(t, 3, all.Matched)
	assert.False(t, all.HasMore)
	require.Len(t, all.Schools, 2)
	assert.Equal(t, "OGS Am Bach", all.Schools[0].Name)
	assert.Equal(t, 2, all.Schools[0].Children)
	assert.Equal(t, "OGS Zur Linde", all.Schools[1].Name)
	assert.Equal(t, 1, all.Schools[1].Children)
	assert.Equal(t, traegerview.TraegerChild{
		StudentID: ident.ID(mia.ID), SchoolID: ident.ID(bach), SchoolName: "OGS Am Bach",
		FirstName: "Mia", LastName: "Zander", SchoolClass: "2b", GroupName: eulen.Name,
	}, all.Children[2])
	assert.Empty(t, all.Children[0].GroupName, "a child without a group names none")

	one := traegerChildren(t, router, token, fmt.Sprintf("?school_id=%d", linde))
	require.Len(t, one.Children, 1)
	assert.Equal(t, ident.ID(anna.ID), one.Children[0].StudentID)
	assert.Equal(t, 1, one.Total, "the children of the chosen school")
	assert.Len(t, one.Schools, 2, "every school keeps its tab")

	for search, want := range map[string]string{"omer": "Aksoy, Ömer", "zander mi": "Zander, Mia", "ANNA BE": "Berg, Anna"} {
		found := traegerChildren(t, router, token, "?search="+url.QueryEscape(search))
		assert.Equal(t, []string{want}, childNames(found.Children), "search %q", search)
		assert.Equal(t, 1, found.Matched)
		assert.Equal(t, 3, found.Total, "the search does not change the number of children")
	}
	none := traegerChildren(t, router, token, "?search=%25")
	assert.Empty(t, none.Children, "a percent sign matches no name")

	outside := traegerOccupancyRequest(t, router, fmt.Sprintf("/traeger/schools/children?school_id=%d", foreign), token, nil)
	assert.Equal(t, http.StatusNotFound, outside.Code, outside.Body.String())
	assert.Contains(t, outside.Body.String(), "traeger.school_not_found")
	for _, bad := range []string{"school_id=abc", "school_id=0", "offset=-1", "offset=x", "search=" + strings.Repeat("a", traegerview.ChildrenSearchMaxLength+1)} {
		rec := traegerOccupancyRequest(t, router, "/traeger/schools/children?"+bad, token, nil)
		assert.Equal(t, http.StatusBadRequest, rec.Code, "%s: %s", bad, rec.Body.String())
	}
}

// The names are personal data: they need "Verträge verwalten", and every
// read stands in the access log of each school it showed (ADR 0084 section
// 7).
func TestTraegerChildrenNeedTheirRightAndAreLogged(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	organization := traegerOrganization(t, db, "Träger Kinder Protokoll", true)
	shown := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Gezeigt")
	empty := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Ohne Kind")
	testpkg.CreateTestStudentForTenant(t, db, shown, "Jule", "Sommer", "1b")
	testpkg.CreateTestStudentForTenant(t, db, shown, "Paul", "Winter", "1b")
	readOnly, readOnlyID := traegerChildrenSignIn(t, db, router, organization, identityaccess.TraegerRoleReadOnly)
	admin, adminID := traegerChildrenSignIn(t, db, router, organization, identityaccess.TraegerRoleAdministration)

	logged := func(school, account int64, resource string) []int {
		var rows []int
		require.NoError(t, db.NewRaw(`SELECT (metadata->>'rows')::int FROM audit.data_access_log
			WHERE tenant_id = ? AND actor_account_id = ? AND resource_type = ? AND actor_role = 'traeger'`,
			school, account, resource).Scan(context.Background(), &rows))
		return rows
	}
	for _, path := range []string{"/traeger/schools/children", "/traeger/schools/children/export"} {
		rec := traegerOccupancyRequest(t, router, path, readOnly, nil)
		assert.Equal(t, http.StatusForbidden, rec.Code, "%s without traeger_contracts:manage: %s", path, rec.Body.String())
		assert.NotContains(t, rec.Body.String(), "Sommer")
	}
	assert.Empty(t, logged(shown, readOnlyID, traegerview.ResourceTypeTraegerChildren), "a refused read reads nothing")

	require.Len(t, traegerChildren(t, router, admin, "").Children, 2)
	assert.Equal(t, []int{2}, logged(shown, adminID, traegerview.ResourceTypeTraegerChildren), "the read stands in the school's access log with its rows")
	assert.Empty(t, logged(empty, adminID, traegerview.ResourceTypeTraegerChildren), "a school without a row on the page gets no entry")

	export := traegerOccupancyRequest(t, router, "/traeger/schools/children/export?search=sommer", admin, nil)
	require.Equal(t, http.StatusOK, export.Code, export.Body.String())
	assert.Contains(t, export.Header().Get("Content-Disposition"), "kinder")
	body := export.Body.String()
	assert.Contains(t, body, "Sommer")
	assert.Contains(t, body, "OGS Gezeigt")
	assert.NotContains(t, body, "Winter", "the export follows the search")
	assert.Equal(t, []int{1}, logged(shown, adminID, traegerview.ResourceTypeTraegerChildrenExport), "the export stands in the school's access log")
}

func TestTraegerChildrenComeInPages(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	organization := traegerOrganization(t, db, "Träger Kinder Seiten", true)
	school := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Viele Kinder")
	for index := range traegerview.ChildrenPageSize + 2 {
		testpkg.CreateTestStudentForTenant(t, db, school, "Kind", fmt.Sprintf("Nummer %03d", index), "1a")
	}
	token, _ := traegerChildrenSignIn(t, db, router, organization, identityaccess.TraegerRoleAdministration)

	first := traegerChildren(t, router, token, "")
	require.Len(t, first.Children, traegerview.ChildrenPageSize)
	assert.True(t, first.HasMore)
	assert.Equal(t, traegerview.ChildrenPageSize+2, first.Matched, "the matches count beyond the page")
	assert.Equal(t, "Nummer 000", first.Children[0].LastName)

	rest := traegerChildren(t, router, token, fmt.Sprintf("?offset=%d", traegerview.ChildrenPageSize))
	assert.Equal(t, []string{"Nummer 050, Kind", "Nummer 051, Kind"}, childNames(rest.Children))
	assert.False(t, rest.HasMore)
}

func TestTraegerChildrenQueryBudgetIsFlat(t *testing.T) {
	t.Parallel()
	db, router, _, _ := newTraegerPortal(t)
	organization := traegerOrganization(t, db, "Träger Kinder Budget", true)
	addSchool := func(name string) {
		school := testpkg.CreateTestSchoolInOrganization(t, db, organization, name)
		group := testpkg.CreateTestEducationGroupForTenant(t, db, school, "Gruppe")
		for _, first := range []string{"Ada", "Ben"} {
			child := testpkg.CreateTestStudentForTenant(t, db, school, first, name, "1a")
			testpkg.AssignStudentToGroup(t, db, child.ID, group.ID)
		}
	}
	for _, name := range []string{"OGS Eins", "OGS Zwei", "OGS Drei"} {
		addSchool(name)
	}
	token, _ := traegerChildrenSignIn(t, db, router, organization, identityaccess.TraegerRoleAdministration)
	read := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		rec := traegerOccupancyRequest(t, router, "/traeger/schools/children", token, counter)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		// The reads of the list. The names statement opens with the marker
		// that keeps the search text out of the query log; the tenant binding
		// of each shown school's access log entry is no read of the list.
		return counter.Measurement(counter.Matching(func(sql string) bool {
			sql = strings.TrimSpace(strings.TrimPrefix(sql, strings.ToLower(collation.RedactLiteralsInLog)))
			return strings.HasPrefix(sql, "select") && !strings.Contains(sql, "set_config")
		}))
	}
	three := read()
	for _, name := range []string{"OGS Vier", "OGS Fünf"} {
		addSchool(name)
	}
	assert.Len(t, read().Statements, len(three.Statements), "the list reads the same statements for any number of schools and children")
	querybudgets.AssertQueryBudget(t, "api.traeger.schools_children", three)
}

// The owners' reads behind the list run in the administrative transaction,
// which bypasses RLS: only the school filter of each statement keeps the
// children of another school out (ADR 0151).
func TestTraegerChildrenReadsRefuseOutsideTheAdministrativeTransaction(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	school, _ := testpkg.CreateTestTenant(t, db)
	other, _ := testpkg.CreateTestTenant(t, db)
	group := testpkg.CreateTestEducationGroupForTenant(t, db, school, "Eulen")
	child := testpkg.CreateTestStudentForTenant(t, db, school, "Ida", "Eule", "1a")
	testpkg.AssignStudentToGroup(t, db, child.ID, group.ID)
	foreign := testpkg.CreateTestStudentForTenant(t, db, other, "Fritz", "Fremd", "2a")
	membership := func(tenant, student int64) int64 {
		var id int64
		require.NoError(t, db.NewRaw(`SELECT id FROM users.student_school_memberships WHERE tenant_id = ? AND student_profile_id = ?`,
			tenant, student).Scan(context.Background(), &id))
		return id
	}
	own, foreignMembership := membership(school, child.ID), membership(other, foreign.ID)

	ports := traegerChildrenPorts()
	query := traegerview.StudentNameQuery{Students: []int64{child.ID, foreign.ID}}
	_, _, namesErr := ports.Names.StudentNamesByTenant(testpkg.TenantContext(school), []int64{school}, query)
	assert.Error(t, namesErr, "the names refuse a tenant transaction")
	_, _, placementsErr := ports.Placements.MembershipPlacementsByTenant(testpkg.TenantContext(school), []int64{school}, []int64{own})
	assert.Error(t, placementsErr, "the placements refuse a tenant transaction")

	require.NoError(t, testpkg.WithinAdminContext(t, context.Background(), db, func(adminCtx context.Context) error {
		names, matched, err := ports.Names.StudentNamesByTenant(adminCtx, []int64{school}, query)
		require.NoError(t, err)
		assert.Equal(t, []traegerview.StudentName{{SchoolID: school, StudentProfileID: child.ID, FirstName: "Ida", LastName: "Eule"}}, names, "only the given schools")
		assert.Equal(t, 1, matched)

		classes, groups, err := ports.Placements.MembershipPlacementsByTenant(adminCtx, []int64{school}, []int64{own, foreignMembership})
		require.NoError(t, err)
		assert.Equal(t, map[int64]string{own: "1a"}, classes, "only the given schools")
		assert.Equal(t, map[int64]int64{own: group.ID}, groups)
		return nil
	}))
}
