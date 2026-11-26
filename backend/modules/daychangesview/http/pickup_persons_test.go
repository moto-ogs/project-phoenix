package daychangesviewhttp_test

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type wirePickupPerson struct {
	Name    string `json:"name"`
	OneTime bool   `json:"one_time"`
}

// pickupPersonLines renders the pickup persons of a raw answer as
// "section first-name person (einmalig)" for single children and as
// "school @group pickup_person=n [first-name person]" for the summaries.
func pickupPersonLines(t *testing.T, body string) []string {
	t.Helper()
	type child struct {
		FirstName    string            `json:"first_name"`
		PickupPerson *wirePickupPerson `json:"pickup_person"`
	}
	var envelope struct {
		Data struct {
			Entries []struct {
				Kind    string `json:"kind"`
				Section string `json:"section"`
				Child   *child `json:"child"`
				Group   *struct {
					Name string `json:"name"`
				} `json:"group"`
				ChildSummary *struct {
					Counts map[string]int `json:"counts"`
					Items  []struct {
						Kind  string `json:"kind"`
						Child child  `json:"child"`
					} `json:"items"`
				} `json:"child_summary"`
			} `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &envelope))
	text := func(c child) string {
		line := c.FirstName + " " + c.PickupPerson.Name
		if c.PickupPerson.OneTime {
			line += " (einmalig)"
		}
		return line
	}
	lines := []string{}
	for _, entry := range envelope.Data.Entries {
		if entry.Kind == "child_pickup_person" && entry.Child != nil {
			lines = append(lines, entry.Section+" "+text(*entry.Child))
		}
		if entry.ChildSummary == nil || entry.ChildSummary.Counts["pickup_person"] == 0 {
			continue
		}
		rows := []string{}
		for _, item := range entry.ChildSummary.Items {
			if item.Kind == "child_pickup_person" {
				rows = append(rows, text(item.Child))
			}
		}
		name, _, _ := strings.Cut(entry.Group.Name, "-")
		lines = append(lines, fmt.Sprintf("%s @%s pickup_person=%d [%s]", entry.Section, name, entry.ChildSummary.Counts["pickup_person"], strings.Join(rows, "; ")))
	}
	return lines
}

// TestDayChangesPickupPersons is Seam 1 for the pickup person of a day
// (#7655) in the Kinder source: the care staff sees it for each child of its
// group, the rest of the school summed up per group, nothing without
// users:read, nothing of another school, and a person of another day never.
func TestDayChangesPickupPersons(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)

	carer, carerAccount := testpkg.CreateTestTeacherWithAccount(t, db, "Anna", "Betreuung")
	igel := testpkg.CreateTestEducationGroup(t, db, "Igel")
	testpkg.CreateTestGroupTeacher(t, db, igel.ID, carer.ID)
	fuchs := testpkg.CreateTestEducationGroup(t, db, "Fuchs")
	child := func(first string, groupID int64) int64 {
		student := testpkg.CreateTestStudent(t, db, first, "Kind", "2a")
		testpkg.AssignStudentToGroup(t, db, student.ID, groupID)
		return student.ID
	}
	mia := child("Mia", igel.ID)
	grandma := testpkg.CreateTestGuardianProfileNamed(t, db, "Oma", "Berta", "pickup-oma")
	testpkg.CreateTestStudentGuardianLink(t, db, mia, grandma.ID, "pickup_only")
	testpkg.CreateTestPickupPerson(t, db, mia, day, carer.StaffID, "Oma Berta", grandma.ID)
	leo := child("Leo", igel.ID)
	testpkg.CreateTestPickupPerson(t, db, leo, day, carer.StaffID, "Tante Frieda", 0)
	testpkg.CreateTestPickupPerson(t, db, leo, day.AddDays(1), carer.StaffID, "Onkel Morgen", 0)
	emil := child("Emil", igel.ID)
	testpkg.CreateTestPickupPerson(t, db, emil, day.AddDays(-1), carer.StaffID, "Onkel Gestern", 0)
	testpkg.CreateTestPickupPerson(t, db, child("Pia", fuchs.ID), day, carer.StaffID, "Nachbarin Uta", 0)

	t.Run("other school", func(t *testing.T) {
		testpkg.OwnTenant(t)
		foreign := testpkg.CreateTestStudent(t, db, "Xaver", "Fremd", "2a")
		testpkg.CreateTestPickupPerson(t, db, foreign.ID, day, 0, "Fremde Person", 0)
	})

	router := newRouter(t, db, day)
	tenantID := testpkg.Tenant(t)

	overview, body := read(t, router, carerAccount.ID, tenantID, "users:read")
	assert.Equal(t, "loaded", sourceStatus(overview, "children"))
	assert.Equal(t, []string{
		"you Leo Tante Frieda (einmalig)",
		"you Mia Oma Berta",
		"school @Fuchs pickup_person=1 [Pia Nachbarin Uta (einmalig)]",
	}, pickupPersonLines(t, body))
	for _, leak := range []string{"Onkel Gestern", "Onkel Morgen", "Fremde Person"} {
		assert.NotContains(t, body, leak)
	}

	overview, body = read(t, router, carerAccount.ID, tenantID)
	assert.Empty(t, pickupPersonLines(t, body), "without users:read")
	assert.Equal(t, "loaded", sourceStatus(overview, "children"))

	// The next day shows that day's person only.
	_, body = read(t, newRouter(t, db, day.AddDays(1)), carerAccount.ID, tenantID, "users:read")
	assert.Equal(t, []string{"you Leo Onkel Morgen (einmalig)"}, pickupPersonLines(t, body))
}
