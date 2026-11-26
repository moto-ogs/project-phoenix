package api

import (
	"fmt"
	"net/http"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
)

func TestHolidayAllocationRankingReordersPendingAndWaitingBookings(t *testing.T) {
	t.Parallel()
	a := newAllocationFixture(t, "Träger Kriterienwertung")
	list, ids := a.rankingFixtureCriteria(t)
	// Deliberately submit A before C, but give C the earlier timestamp.
	// Equal scores must fall to submitted_at, not directly to the ID.
	first := a.submitRankedHoliday(t, "a@example.org", ids, ids[0])
	b := a.submitRankedHoliday(t, "b@example.org", ids, ids[1], ids[3])
	c := a.submitRankedHoliday(t, "c@example.org", ids, ids[0], ids[2], ids[4], ids[5])
	a.prepareRankingFixture(t, c, b, first, ids[0])

	// Existing answers to criteria 5 and 6 are now inactive and archived,
	// respectively. A new active criterion is unknown for everyone.
	list[4]["active"] = false
	list = append(list[:5], rankingCriterion("Nachträglich ergänzt", 8))

	current := a.saveRanking(t, "priority", list)
	require.Len(t, current.Criteria, len(list))
	list[5]["id"] = fmt.Sprint(current.Criteria[5].ID)
	a.assertPendingScores(t, "priority", 5, []wireID{first, b, c}, []int{1, 2, 1})
	a.saveRanking(t, "equal", list)
	a.assertPendingScores(t, "equal", 5, []wireID{b, c, first}, []int{2, 1, 1})
	a.saveRanking(t, "points", list)
	pending := a.assertPendingScores(t, "points", 16, []wireID{c, b, first}, []int{5, 2, 1})
	assert.Equal(t, "yes", pending[0].Criteria[0].Value, "the wish is shown, but adds no points")
	assert.Equal(t, "no", pending[0].Criteria[1].Value, "the office overrides the parent's yes")
	assert.Equal(t, "office", pending[0].Criteria[1].Source)
	assert.Equal(t, "unknown", pending[0].Criteria[5].Value, "the criterion added after submission is unknown")

	rec := a.decide(t, decision(pending[0], "waitlisted", "Wartet auf Rückmeldung"),
		decision(pending[1], "waitlisted", ""), decision(pending[2], "waitlisted", ""))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	a.assertRankingWaitlist(t, c, b, first)

	a.saveRanking(t, "equal", list)
	a.assertRankingWaitlist(t, b, c, first)
	list[2]["points"] = 1
	a.saveRanking(t, "priority", list)
	a.assertRankingWaitlist(t, first, b, c)
	a.assertDecisionScores(t, map[wireID]int{c: 5, b: 2, first: 1})
}

func rankingCriterion(name string, points int) map[string]any {
	return map[string]any{"name": name, "question": name + "?", "scope": "family", "active": true, "points": points}
}

func (a allocationFixture) rankingFixtureCriteria(t *testing.T) ([]map[string]any, []wireID) {
	t.Helper()
	list := []map[string]any{
		rankingCriterion("Erstes Merkmal", 1), rankingCriterion("Zweites Merkmal", 1),
		rankingCriterion("Hohes Gewicht", 5), rankingCriterion("Weiteres Merkmal", 1),
		rankingCriterion("Später inaktiv", 100), rankingCriterion("Später archiviert", 100),
	}
	saved := a.saveRanking(t, "priority", list)
	require.Len(t, saved.Criteria, len(list))
	ids := make([]wireID, len(list))
	for i, criterion := range saved.Criteria {
		ids[i] = criterion.ID
		list[i]["id"] = fmt.Sprint(criterion.ID)
	}
	return list, ids
}

func (a allocationFixture) saveRanking(t *testing.T, ranking string, list []map[string]any) criteriaBody {
	t.Helper()
	version := criteriaVersion(t, a.traeger, a.office.token)
	return decodeSavedCriteria(t, a, version, map[string]any{"ranking": ranking, "criteria": list})
}

func decodeSavedCriteria(t *testing.T, a allocationFixture, version string, body map[string]any) criteriaBody {
	t.Helper()
	rec := saveHolidayCriteria(t, a.traeger, a.office.token, version, body)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[criteriaBody](t, rec.Body.Bytes())
}

func (a allocationFixture) submitRankedHoliday(t *testing.T, email string, active []wireID, met ...wireID) wireID {
	t.Helper()
	body := placesRegistration(a.reviewFixture, email, map[string][]int{"Tom": {0}})
	answers := map[string]bool{}
	for _, criterion := range active {
		answers[fmt.Sprint(criterion)] = slices.Contains(met, criterion)
	}
	body["criteria"] = answers
	rec := publicJSON(t, a.public, http.MethodPost, registrationPath(a.period.PublicToken), body)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[receiptBody](t, rec.Body.Bytes()).ID
}

func (a allocationFixture) prepareRankingFixture(t *testing.T, c, b, first, checkedCriterion wireID) {
	t.Helper()
	ctx := t.Context()
	_, err := a.db.ExecContext(ctx, `UPDATE enrollment.holiday_registrations
  SET submitted_at = CASE id WHEN ? THEN '2026-12-01 00:00:00+00'::timestamptz
   WHEN ? THEN '2026-12-02 00:00:00+00'::timestamptz ELSE '2026-12-03 00:00:00+00'::timestamptz END
  WHERE id IN (?, ?, ?)`, c, b, c, b, first)
	require.NoError(t, err)
	_, err = a.db.ExecContext(ctx, `UPDATE enrollment.holiday_periods SET holiday_wish_rule = true WHERE id = ?`, a.period.ID)
	require.NoError(t, err)
	_, err = a.db.ExecContext(ctx, `UPDATE enrollment.holiday_registration_children SET holiday_wish = 'yes', holiday_wish_source = 'office'
  WHERE holiday_registration_id = ?`, c)
	require.NoError(t, err)
	rec := traegerJSON(t, a.traeger, a.office.token, http.MethodPut, a.registrationPath(int64(c), "/criteria"),
		map[string]any{"checks": []map[string]any{{"criterion_id": fmt.Sprint(checkedCriterion), "checked": "no"}}})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}

func (a allocationFixture) assertPendingScores(t *testing.T, ranking string, maxScore int, order []wireID, scores []int) []allocationCandidateBody {
	t.Helper()
	board := a.board(t)
	assert.Equal(t, ranking, board.Ranking)
	assert.Equal(t, maxScore, board.MaxScore)
	require.NotEmpty(t, board.Criteria)
	assert.Zero(t, board.Criteria[0].ID, "the wish is separate from the catalog")
	assert.Zero(t, board.Criteria[0].Points)
	pending := board.Weeks[0].Pending
	require.Len(t, pending, len(order))
	for i, candidate := range pending {
		assert.Equal(t, order[i], candidate.RegistrationID)
		assert.Equal(t, scores[i], candidate.Score, "displayed scores must agree with the effective criteria used by SQL")
		assert.Equal(t, i+1, candidate.Rank)
	}
	return pending
}

func (a allocationFixture) assertRankingWaitlist(t *testing.T, order ...wireID) {
	t.Helper()
	waiting := a.places(t)[int64(a.offer.Weeks[0].ID)].Waitlist
	require.Len(t, waiting, len(order))
	for i, registration := range order {
		assert.Equal(t, registration, waiting[i].RegistrationID)
		assert.Equal(t, i+1, waiting[i].Position)
	}
	detail := a.detail(t, traegerJSON(t, a.traeger, a.office.token, http.MethodGet, a.registrationPath(int64(order[0]), ""), nil))
	require.NotNil(t, detail.Children[0].Bookings[0].WaitlistPosition)
	assert.Equal(t, 1, *detail.Children[0].Bookings[0].WaitlistPosition)
}

func (a allocationFixture) assertDecisionScores(t *testing.T, scores map[wireID]int) {
	t.Helper()
	board := a.board(t)
	require.Len(t, board.Decisions, len(scores))
	for _, decided := range board.Decisions {
		expected, ok := scores[decided.RegistrationID]
		require.True(t, ok)
		assert.Equal(t, "points", decided.Ranking, "changing the live catalog does not change the decision")
		require.NotNil(t, decided.Score)
		require.NotNil(t, decided.MaxScore)
		assert.Equal(t, expected, *decided.Score)
		assert.Equal(t, 16, *decided.MaxScore)
	}
}

func TestHolidayAllocationRankingAndPointsShareTheCatalogVersion(t *testing.T) {
	t.Parallel()
	f := newHolidayRegistrationFixture(t)
	office := newTraegerOffice(t, f.db, f.traeger, "Träger Versionsprüfung", identityaccess.TraegerRoleAdministration)
	a := allocationFixture{reviewFixture: reviewFixture{holidayRegistrationFixture: f, office: office}}
	rec := traegerJSON(t, a.traeger, a.office.token, http.MethodGet, "/traeger/holiday-periods/criteria", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	empty := decodeSchoolPortalData[criteriaBody](t, rec.Body.Bytes())
	assert.Equal(t, "priority", empty.Ranking)
	criteria := []map[string]any{rankingCriterion("Beispiel", 1)}
	delete(criteria[0], "points")
	body := map[string]any{"criteria": criteria}
	initial := decodeSavedCriteria(t, a, empty.Version, body)
	require.Len(t, initial.Criteria, 1)
	assert.Equal(t, 1, initial.Criteria[0].Points, "omission on insert defaults to one")
	var storedRanking string
	require.NoError(t, a.db.NewRaw(`SELECT criteria_ranking FROM enrollment.holiday_allocation_rules WHERE organization_id = ?`,
		a.office.organization).Scan(t.Context(), &storedRanking))
	assert.Equal(t, "priority", storedRanking, "even a default catalog save persists a rules row for seed coverage")
	criteria[0]["id"] = fmt.Sprint(initial.Criteria[0].ID)

	body["ranking"] = "points"
	ranked := decodeSavedCriteria(t, a, initial.Version, body)
	assert.NotEqual(t, initial.Version, ranked.Version, "ranking alone changes the version")
	assert.Equal(t, "points", ranked.Ranking)

	delete(body, "ranking")
	criteria[0]["points"] = 100
	rec = saveHolidayCriteria(t, a.traeger, a.office.token, initial.Version, body)
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "general.changed_since_read")
	weighted := decodeSavedCriteria(t, a, ranked.Version, body)
	assert.NotEqual(t, ranked.Version, weighted.Version, "points alone change the version")
	assert.Equal(t, "points", weighted.Ranking, "omitted ranking is preserved")
	assert.Equal(t, 100, weighted.Criteria[0].Points)

	delete(criteria[0], "points")
	omitted := decodeSavedCriteria(t, a, weighted.Version, body)
	assert.Equal(t, weighted, omitted, "omitted ranking and points leave the catalog unchanged")
	criteria[0]["points"] = 0
	body["ranking"] = ""
	zero := decodeSavedCriteria(t, a, omitted.Version, body)
	assert.Equal(t, weighted, zero, "explicit zero points and empty ranking are also unchanged")
	a.assertInvalidRankingFields(t, zero.Version, body, criteria[0])
}

func (a allocationFixture) assertInvalidRankingFields(t *testing.T, version string, body, criterion map[string]any) {
	t.Helper()
	body["ranking"] = "random"
	rec := saveHolidayCriteria(t, a.traeger, a.office.token, version, body)
	require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	_, fields := registrationRefusalOf(t, rec)
	assert.Contains(t, fields, "ranking")
	delete(body, "ranking")
	for _, invalid := range []int{-1, 101} {
		criterion["points"] = invalid
		rec = saveHolidayCriteria(t, a.traeger, a.office.token, version, body)
		require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
		_, fields = registrationRefusalOf(t, rec)
		assert.Contains(t, fields, "criteria.0.points")
	}
	assert.Equal(t, version, criteriaVersion(t, a.traeger, a.office.token))
}
