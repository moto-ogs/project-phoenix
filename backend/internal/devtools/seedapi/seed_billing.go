package api

import (
	"context"
	"fmt"
)

// seedBillingKeyDateCountsStep gives every fresh school a synthetic
// current-day billing snapshot through Organisation & Tenancy's billing
// report, bound by the dev tools (ADR 0298). It keeps the report reviewable
// without changing the worker-only production capture path. The public demo
// binds none: only an operator sees the figures. The step also gives the
// profile's Träger and school their own key day (#7301), so the operator
// page shows both levels: the school's day wins.
type seedBillingKeyDateCountsStep struct{ seeder *Seeder }

func (seedBillingKeyDateCountsStep) Name() string { return "Seeding billing key-date counts" }

func (s seedBillingKeyDateCountsStep) Run(ctx context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil {
		return fmt.Errorf("billing demo prerequisites not available")
	}
	capture := s.seeder.options.BillingKeyDateCounts
	if capture == nil {
		fmt.Println("  no database for the billing snapshot, the key-date counts are skipped")
	} else if _, err := capture(ctx); err != nil {
		return fmt.Errorf("seed billing key-date counts: %w", err)
	}
	previousAuth := rt.Client.auth
	rt.Client.BindAuth(rt.OperatorAuth)
	defer rt.Client.BindAuth(previousAuth)
	if capture != nil {
		fmt.Println("  billing key-date counts captured")
	}
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
