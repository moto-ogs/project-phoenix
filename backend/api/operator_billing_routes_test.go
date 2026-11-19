package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	provisioningAPI "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/inbound/operator"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type operatorKeyDay struct {
	KeyDay    int `json:"key_day"`
	Overrides []struct {
		Scope  string `json:"scope"`
		ID     string `json:"id"`
		KeyDay int    `json:"key_day"`
	} `json:"overrides"`
}

func (k operatorKeyDay) own(scope string, id int64) int {
	for _, override := range k.Overrides {
		if override.Scope == scope && override.ID == fmt.Sprint(id) {
			return override.KeyDay
		}
	}
	return 0
}

// The operator sets the key day of every school, gives a Träger and a school
// a day of their own, takes both back and reads the captured figures, all
// through the routes under /operator/billing with the real billing report.
func TestOperatorBillingRoutesKeepTheKeyDayAndTheOwnDays(t *testing.T) {
	t.Parallel()
	// The key day of every school is one platform-wide value.
	db := testpkg.SetupIsolatedTestDB(t)
	billing, err := owners.NewOperatorBilling(slog.Default())
	require.NoError(t, err)
	operator := chi.NewRouter()
	mountOperatorBillingRoutes(operator, provisioningAPI.NewBillingResource(billing, nil, nil, time.Now))
	router := chi.NewRouter()
	router.Mount("/operator", operator)
	f := operatorProvisioningRoutes{db: db, router: router, ctx: provisioningContext(t, db), operatorID: testpkg.CreateTestOperator(t, db).ID}
	traeger := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: "Träger Stichtag", Slug: fmt.Sprintf("stichtag-%d", f.operatorID), Active: true})
	school := testpkg.CreateTestSchoolInOrganization(t, db, traeger.ID, "OGS Stichtag")

	var keyDay operatorKeyDay
	f.call(t, http.MethodPut, "/operator/billing/key-day", map[string]int{"key_day": 20}, &keyDay)
	assert.Equal(t, 20, keyDay.KeyDay)
	f.call(t, http.MethodPut, fmt.Sprintf("/operator/billing/key-day-overrides/organizations/%d", traeger.ID), map[string]int{"key_day": 5}, &keyDay)
	f.call(t, http.MethodPut, fmt.Sprintf("/operator/billing/key-day-overrides/schools/%d", school), map[string]int{"key_day": 10}, &keyDay)
	assert.Equal(t, 20, keyDay.KeyDay, "the day of every school stays")

	var read operatorKeyDay
	f.call(t, http.MethodGet, "/operator/billing/key-day", nil, &read)
	assert.Equal(t, 20, read.KeyDay)
	assert.Equal(t, 5, read.own("organization", traeger.ID))
	assert.Equal(t, 10, read.own("school", school))

	f.call(t, http.MethodDelete, fmt.Sprintf("/operator/billing/key-day-overrides/schools/%d", school), nil, &keyDay)
	assert.Zero(t, keyDay.own("school", school), "the school follows its Träger again")
	f.call(t, http.MethodDelete, fmt.Sprintf("/operator/billing/key-day-overrides/organizations/%d", traeger.ID), nil, &keyDay)
	assert.Empty(t, keyDay.Overrides)

	_, err = billing.SeedBillingKeyDateCounts(f.ctx, time.Now())
	require.NoError(t, err)
	report, err := billing.ListBillingKeyDateCounts(f.ctx)
	require.NoError(t, err)
	var listed []struct {
		SchoolID string `json:"school_id"`
	}
	f.call(t, http.MethodGet, "/operator/billing/key-date-counts", nil, &listed)
	assert.Len(t, listed, len(report), "the route lists the operator report")
}
