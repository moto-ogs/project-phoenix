package api

import (
	"context"
	"fmt"
)

// seedBillingKeyDateCountsStep gives every fresh demo a synthetic current-day
// billing snapshot through the local-only operator route. It keeps the report
// reviewable without changing the worker-only production capture path. It
// also gives the profile's Träger and school their own key day (#7301), so
// the operator page shows both levels: the school's day wins.
type seedBillingKeyDateCountsStep struct{}

func (seedBillingKeyDateCountsStep) Name() string { return "Seeding billing key-date counts" }

func (seedBillingKeyDateCountsStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil {
		return fmt.Errorf("billing demo prerequisites not available")
	}
	previousAuth := rt.Client.auth
	rt.Client.BindAuth(rt.OperatorAuth)
	defer rt.Client.BindAuth(previousAuth)
	if _, err := rt.Client.PostWithHeaders("/operator/billing/key-date-counts/seed", nil, map[string]string{
		seedTokenHeader: "true",
	}); err != nil {
		return fmt.Errorf("seed billing key-date counts: %w", err)
	}
	fmt.Println("  billing key-date counts captured")
	if rt.Bootstrap == nil || rt.Bootstrap.OrganizationID <= 0 || rt.Bootstrap.SchoolID <= 0 {
		return nil
	}
	for _, own := range []struct {
		path   string
		keyDay int
	}{
		{fmt.Sprintf("/operator/billing/key-day-overrides/organizations/%d", rt.Bootstrap.OrganizationID), 20},
		{fmt.Sprintf("/operator/billing/key-day-overrides/schools/%d", rt.Bootstrap.SchoolID), 25},
	} {
		if _, err := rt.Client.Put(own.path, map[string]int{"key_day": own.keyDay}); err != nil {
			return fmt.Errorf("seed own billing key day: %w", err)
		}
	}
	fmt.Println("  own billing key days set")
	return nil
}
