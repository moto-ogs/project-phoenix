package application

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The school list marks a school whose replies bounce (#7174): the address is
// missing only when neither the setting nor the contact address yields one
// the mail identity would use (a bare mailbox, #1936).
func TestProvisioningListSchoolRequiredDetails(t *testing.T) {
	t.Parallel()

	t.Run("marks a missing reply address of undeleted schools", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)
		seedDashboard(h)
		h.engine.schools[10].Email = "gs@burbach.test"
		h.engine.schools[20].Email = ""
		h.engine.schools[30].Email = "Schule <gs@kreuztal.test>"
		h.settings.replyTo = map[int64]string{20: " eltern@schule.test ", 30: "kein-postfach"}

		details, err := h.svc.ListSchoolRequiredDetails(context.Background())

		require.NoError(t, err)
		byID := map[int64]organizationtenancy.SchoolRequiredDetails{}
		for _, detail := range details {
			byID[detail.SchoolID.Int64()] = detail
		}
		require.Len(t, byID, 3, "the deleted school 50 is not listed")
		assert.False(t, byID[10].ReplyAddressMissing, "the contact address answers")
		assert.False(t, byID[20].ReplyAddressMissing, "the setting answers without a contact address")
		assert.True(t, byID[30].ReplyAddressMissing, "neither a display-name contact nor a broken setting is used")
		assert.ElementsMatch(t, []int64{10, 20, 30}, h.settings.replyToSchools)
		assert.True(t, h.settings.replyToInAdmin, "the batch read joins the administrative unit")
	})

	t.Run("no school reads no settings", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)

		details, err := h.svc.ListSchoolRequiredDetails(context.Background())

		require.NoError(t, err)
		assert.NotNil(t, details)
		assert.Empty(t, details)
		assert.Nil(t, h.settings.replyToSchools)
	})

	t.Run("a failed settings read fails the list", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)
		seedDashboard(h)
		h.settings.replyToErr = errBoom

		details, err := h.svc.ListSchoolRequiredDetails(context.Background())

		require.ErrorIs(t, err, errBoom)
		assert.Nil(t, details)
	})
}
