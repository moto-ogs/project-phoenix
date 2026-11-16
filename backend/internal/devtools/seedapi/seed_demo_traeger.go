package api

import (
	"context"
	"errors"
	"fmt"
)

// A demo order's school gets a Träger of its own (#6193, ADR 0271): the
// visitor enters its Träger-Büro, and two neighbour schools make the
// Träger's comparisons and lists worth looking at. The neighbour schools are
// small: two groups, twelve children with contacts and weekly times, and
// today's attendance through the web (the manual profile's contents).
var demoNeighbourSchools = []struct {
	key  string
	name string
}{
	{"n1", "OGS Am Lindenhof"},
	{"n2", "OGS Rheinblick"},
}

// demoNeighbourAdminPosition is the position of a neighbour school's admin.
const demoNeighbourAdminPosition = "OGS-Leitung"

// seedVisitorTraegerBueroStep makes the visitor's caregiver a member of the
// Träger-Büro of the order's own Träger, with every role the seeded office
// holds, so the demo role Träger-Büro signs the visitor in with their own
// name. Only an own Träger has a visitor in its office; the shared one never
// does (ADR 0233 point 9).
type seedVisitorTraegerBueroStep struct{ seeder *Seeder }

func (seedVisitorTraegerBueroStep) Name() string { return "Seeding the visitor's Träger-Büro" }

func (s seedVisitorTraegerBueroStep) Run(_ context.Context, rt *Runtime) error {
	if !s.seeder.options.OwnTraeger || rt.seedVisitor().empty() {
		return nil
	}
	if rt.Bootstrap == nil || rt.Bootstrap.OrganizationID <= 0 || rt.FixedSeeder == nil {
		return fmt.Errorf("the visitor's Träger-Büro seed prerequisites are not available")
	}
	email, accountID, err := visitorCaregiver(rt.FixedSeeder)
	if err != nil {
		return err
	}
	previousAuth := rt.Client.auth
	rt.Client.BindAuth(rt.OperatorAuth)
	defer rt.Client.BindAuth(previousAuth)
	path := fmt.Sprintf("/operator/organizations/%d/traeger-members", rt.Bootstrap.OrganizationID)
	if _, err := rt.Client.Post(path, map[string]any{"email": email, "roles": seedTraegerAdminRoles}); err != nil {
		return fmt.Errorf("assign the visitor to the Träger-Büro: %w", err)
	}
	// The office knows its people by the name of their membership (#4693);
	// the header shows the visitor's own name instead of the account.
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	visitor := rt.seedVisitor()
	namePath := fmt.Sprintf("/traeger/accounts/%d/name", accountID)
	if _, err := rt.Client.PutWithAuth(auth, namePath, map[string]any{"name": visitor.first + " " + visitor.last}); err != nil {
		return fmt.Errorf("name the visitor in the Träger-Büro: %w", err)
	}
	fmt.Println("  Träger-Büro: the visitor's caregiver joined with every role of the office")
	return nil
}

// visitorCaregiver is the account of the caregiver the visitor's name
// replaced, with its synthetic address; the visitor's real address never
// becomes one.
func visitorCaregiver(fs *FixedSeeder) (string, int64, error) {
	staff := DemoStaff[visitorStaffIndex]
	key := staff.FirstName + " " + staff.LastName
	for _, credential := range fs.staffCredentials {
		if credential.Name == key && credential.Email != "" && credential.AccountID > 0 {
			return credential.Email, credential.AccountID, nil
		}
	}
	return "", 0, errors.New("the visitor's caregiver account was not created")
}

// seedDemoNeighbourSchoolsStep adds the neighbour schools to the order's own
// Träger. Each is recorded on the order as soon as it exists, so a seed that
// fails later still retires and erases it with the order.
type seedDemoNeighbourSchoolsStep struct{ seeder *Seeder }

func (seedDemoNeighbourSchoolsStep) Name() string { return "Seeding the neighbour schools" }

func (s seedDemoNeighbourSchoolsStep) Run(ctx context.Context, rt *Runtime) error {
	if !s.seeder.options.OwnTraeger {
		return nil
	}
	if rt.Bootstrap == nil || rt.Bootstrap.OrganizationID <= 0 {
		return fmt.Errorf("the neighbour schools need the Träger first")
	}
	primary, primaryAuth := rt.Bootstrap, rt.TenantAuth
	defer func() {
		rt.Bootstrap = primary
		rt.SetTenantAuth(primaryAuth)
	}()
	for _, neighbour := range demoNeighbourSchools {
		if err := s.seedNeighbour(ctx, rt, primary, neighbour.key, neighbour.name); err != nil {
			return fmt.Errorf("neighbour school %s: %w", neighbour.name, err)
		}
	}
	return nil
}

func (s seedDemoNeighbourSchoolsStep) seedNeighbour(ctx context.Context, rt *Runtime, primary *bootstrapSeedState, key, name string) error {
	rt.Client.BindAuth(rt.OperatorAuth)
	slug := truncateSeedSubdomain(primary.SchoolSlug + "-" + key)
	schoolID, tenantSlug, err := s.seeder.createSeedSchool(primary.OrganizationID, name, slug, slug)
	if err != nil && s.seeder.options.ReplaceAbandoned && isConflictError(err) {
		if err = s.seeder.retireAbandonedSchool(slug); err == nil {
			schoolID, tenantSlug, err = s.seeder.createSeedSchool(primary.OrganizationID, name, slug, slug)
		}
	}
	if err != nil {
		return wrapConflictError(err, "school")
	}
	if s.seeder.options.SaveSchool != nil {
		if err := s.seeder.options.SaveSchool(ctx, schoolID); err != nil {
			return err
		}
	}
	definition := manualProfileDefinition()
	definition.SchoolAdminEmail = fmt.Sprintf("nachbarschule-%s-admin@example.test", key)
	email, password, err := s.seeder.profileAdminCredentialsFor(definition)
	if err != nil {
		return err
	}
	if err := s.seeder.inviteSeedAdmin(schoolID, email, password, demoNeighbourAdminPosition); err != nil {
		return err
	}
	auth, err := rt.Adapter.LoginTenant(ctx, email, password, tenantSlug)
	if err != nil {
		return fmt.Errorf("login as neighbour school admin: %w", err)
	}
	rt.Bootstrap = &bootstrapSeedState{
		OrganizationID: primary.OrganizationID, OrganizationName: primary.OrganizationName,
		OrganizationSlug: primary.OrganizationSlug, SchoolID: schoolID, SchoolName: name,
		SchoolSlug: slug, TenantSlug: tenantSlug, AdminEmail: email, AdminPassword: password,
		AdminName: seedAdminFirstName + " " + seedAdminLastName, AdminPosition: demoNeighbourAdminPosition,
	}
	rt.SetTenantAuth(auth)
	if err := (configureProfileStep{definition: definition}).Run(ctx, rt); err != nil {
		return err
	}
	if _, err := seedManualProfileData(rt); err != nil {
		return err
	}
	fmt.Printf("  Träger: neighbour school %s with two groups and twelve children\n", name)
	return nil
}
