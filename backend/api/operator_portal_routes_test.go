package api

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/communication/http/operatorannouncements"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	identityoperator "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/operator"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	provisioningAPI "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/inbound/operator"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The operator portal reaches these routes through its catalog proxy
// (#2352): each test mounts the production mount functions under /operator,
// so every answer is held to the contract of its full pattern.

// operatorPortalRoutes mounts the given mount functions under /operator for
// one operator, over the provisioning of the same composition.
func operatorPortalRoutes(t *testing.T, db *bun.DB, provisioning organizationtenancy.OperatorProvisioning, mount func(chi.Router)) operatorProvisioningRoutes {
	t.Helper()
	inner := chi.NewRouter()
	mount(inner)
	router := chi.NewRouter()
	router.Mount("/operator", inner)
	return operatorProvisioningRoutes{
		db: db, service: provisioning, router: router,
		ctx: provisioningContext(t, db), operatorID: testpkg.CreateTestOperator(t, db).ID,
	}
}

// operatorIdentityRoutesOf binds the operator's Identity & Access routes as
// the root does.
func operatorIdentityRoutesOf(identity identityaccess.Owner) operatorIdentityRoutes {
	return operatorIdentity{
		account:     identityoperator.NewResource(identity, provisioningAPI.ProvisioningErrorRenderer),
		access:      identity,
		passkeys:    identity,
		mfa:         identity,
		invitations: identity,
		accountMFA:  identity,
		caterers:    identity.Caterers(),
	}.routes()
}

// ownOutboxMailTo removes the school-less mails to address when the test
// ends: operator invitations and notices to caterers belong to no tenant.
func ownOutboxMailTo(t *testing.T, db *bun.DB, address string) {
	t.Helper()
	t.Cleanup(func() {
		_, err := db.ExecContext(context.Background(), `DELETE FROM platform.email_outbox
			WHERE tenant_id IS NULL AND lower(recipient->>'address') = lower(?)`, address)
		assert.NoError(t, err)
	})
}

// The operator changes and removes a Träger, a school and a person, and
// reads the PWA use of a school.
func TestOperatorRoutesUpdateAndRemoveOrganizationsSchoolsAndPersons(t *testing.T) {
	t.Parallel()
	f := newOperatorProvisioningRoutes(t)
	inner := chi.NewRouter()
	resource := provisioningAPI.NewProvisioningResource(provisioningAPI.ProvisioningConfig{Service: f.service, RequiredDetails: f.service.RequiredDetails})
	mountOperatorProvisioningRoutes(inner, resource, nil)
	mountOperatorSchoolRoutes(inner, resource, nil, nil, demoOperatorRoutes{})
	mountOperatorPersonRoutes(inner, resource)
	f.router = chi.NewRouter()
	f.router.Mount("/operator", inner)
	organizationID, schoolID := provisionTestSchool(t, f.db, f.service, f.operatorID, "route-removal")

	var usage struct {
		WindowDays int `json:"window_days"`
	}
	f.call(t, http.MethodGet, fmt.Sprintf("/operator/schools/%d/pwa-usage", schoolID), nil, &usage)
	assert.Positive(t, usage.WindowDays)

	person := testpkg.CreateTestPerson(t, f.db, "Route", "Entfernt")
	f.call(t, http.MethodDelete, fmt.Sprintf("/operator/persons/%d", person.ID), nil, nil)
	assert.NotNil(t, f.deletedAt(t, "users.persons", person.ID), "the person is removed")

	assert.Equal(t, http.StatusNoContent, f.call(t, http.MethodDelete, fmt.Sprintf("/operator/schools/%d", schoolID), nil, nil))
	assert.NotNil(t, f.deletedAt(t, "platform.schools", schoolID), "the school is removed")
	assert.Equal(t, http.StatusNoContent, f.call(t, http.MethodDelete, fmt.Sprintf("/operator/organizations/%d", organizationID), nil, nil))
	assert.NotNil(t, f.deletedAt(t, "platform.organizations", organizationID), "the Träger is removed")
}

// The operator switches the caregiver role of a school account off and on.
func TestOperatorRoutesSwitchTheCaregiverCapabilityOfASchoolAccount(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	_, _, _, _, _, _, _, _, _, _, services, _, _, _, _, _, _, _, provisioning, _, _, _, _, _, _, _, _, err := composeTestRoot(testpkg.NewDatabase(t, db), slog.Default(), currentTestServiceConfig())
	require.NoError(t, err)
	config, err := newProvisioningConfig(provisioning, caregiverCapabilityViews(testpkg.NewDatabase(t, db), services.CaregiverCapability))
	require.NoError(t, err)
	resource := provisioningAPI.NewProvisioningResource(config)
	f := operatorPortalRoutes(t, db, provisioning, func(r chi.Router) { mountOperatorSchoolRoutes(r, resource, nil, nil, demoOperatorRoutes{}) })
	_, schoolID := provisionTestSchool(t, f.db, f.service, f.operatorID, "route-caregiver")
	password := testpkg.NewTestPassword()
	var account struct {
		ID wireID `json:"id"`
	}
	f.call(t, http.MethodPost, fmt.Sprintf("/operator/schools/%d/create-account", schoolID), map[string]any{
		"email": fmt.Sprintf("route-caregiver-%d@example.test", schoolID), "first_name": "Clara", "last_name": "Care",
		"password": password, "confirm_password": password,
	}, &account)
	path := fmt.Sprintf("/operator/schools/%d/accounts/%d/caregiver-capability", schoolID, account.ID)
	type state struct {
		AccountID wireID  `json:"account_id"`
		FirstName string  `json:"first_name"`
		StaffID   *wireID `json:"staff_id"`
	}

	var read state
	f.call(t, http.MethodGet, path, nil, &read)
	assert.Equal(t, account.ID, read.AccountID)
	var enabled state
	f.call(t, http.MethodPost, path, map[string]string{"first_name": "Clara", "last_name": "Care", "position": "Erzieherin"}, &enabled)
	assert.Equal(t, "Clara", enabled.FirstName)
	assert.NotNil(t, enabled.StaffID, "the account works as caregiver")
	var disabled state
	f.call(t, http.MethodDelete, path, nil, &disabled)
	assert.Equal(t, account.ID, disabled.AccountID)
}

// The operator manages the schools of an account, reads its account-wide
// second-factor switch and resets a caterer's second factor.
func TestOperatorRoutesManageTheSchoolsAndSecondFactorsOfAccounts(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	provisioning, identity := buildOperatorProvisioningWithIdentity(t, db)
	routes := operatorIdentityRoutesOf(identity)
	resource := provisioningAPI.NewProvisioningResource(provisioningAPI.ProvisioningConfig{Service: provisioning})
	f := operatorPortalRoutes(t, db, provisioning, func(r chi.Router) {
		routes.mountAccountTenantAccessRoutes(r, resource)
		routes.mountAccountMFARoutes(r, resource)
		routes.mountCatererMFARoutes(r, resource)
	})
	_, schoolID := provisionTestSchool(t, f.db, f.service, f.operatorID, "route-access")
	account := testpkg.CreateTestAccount(t, f.db, "route-access")
	base := fmt.Sprintf("/operator/accounts/%d/tenants", account.ID)
	var roles []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	f.call(t, http.MethodGet, fmt.Sprintf("%s/%d/roles", base, schoolID), nil, &roles)
	// Access with the role user ends through its own flow; these two end here.
	others := roles[:0]
	for _, role := range roles {
		if role.Name != "user" {
			others = append(others, role)
		}
	}
	roles = others
	require.GreaterOrEqual(t, len(roles), 2, "a school offers several roles")
	type access struct {
		TenantID wireID `json:"tenant_id"`
		Status   string `json:"status"`
		Roles    []struct {
			ID string `json:"id"`
		} `json:"roles"`
	}
	find := func(entries []access) access {
		for _, entry := range entries {
			if int64(entry.TenantID) == schoolID {
				return entry
			}
		}
		t.Fatalf("no access to school %d in %v", schoolID, entries)
		return access{}
	}

	var granted []access
	assert.Equal(t, http.StatusCreated, f.call(t, http.MethodPost, base, map[string]any{"school_id": schoolID, "role_id": roles[0].ID, "first_name": "Anna", "last_name": "Zugang"}, &granted))
	assert.Equal(t, roles[0].ID, find(granted).Roles[0].ID)
	var changed []access
	f.call(t, http.MethodPut, fmt.Sprintf("%s/%d", base, schoolID), map[string]any{"role_id": roles[1].ID}, &changed)
	assert.Equal(t, roles[1].ID, find(changed).Roles[0].ID)
	var revoked []access
	f.call(t, http.MethodDelete, fmt.Sprintf("%s/%d", base, schoolID), nil, &revoked)
	assert.NotEqual(t, "active", find(revoked).Status, "the school access ends")

	var override struct {
		Enrolled bool   `json:"enrolled"`
		Override string `json:"override"`
	}
	f.call(t, http.MethodGet, fmt.Sprintf("/operator/accounts/%d/mfa/global-override", account.ID), nil, &override)
	assert.False(t, override.Enrolled)
	assert.Equal(t, identityaccess.MFAAdminOverrideNone, override.Override)

	caterer := testpkg.CreateTestAccount(t, f.db, "route-caterer-mfa")
	testpkg.OwnAccountSecurityNotices(t, f.db, caterer.ID)
	ownOutboxMailTo(t, f.db, caterer.Email)
	var catererID int64
	require.NoError(t, f.db.NewRaw(`INSERT INTO auth.caterers (name) VALUES ('Routenküche MFA') RETURNING id`).Scan(testpkg.Ctx(t), &catererID))
	t.Cleanup(func() {
		_, err := f.db.ExecContext(context.Background(), `DELETE FROM auth.caterers WHERE id = ?`, catererID)
		assert.NoError(t, err)
	})
	_, err := f.db.ExecContext(testpkg.Ctx(t), `INSERT INTO auth.caterer_accounts (account_id, caterer_id) VALUES (?, ?)`, caterer.ID, catererID)
	require.NoError(t, err)
	require.NoError(t, enrollMFA(f.ctx, t, f.db, identity, caterer.ID))
	assert.Equal(t, http.StatusNoContent, f.call(t, http.MethodDelete,
		fmt.Sprintf("/operator/caterers/%d/accounts/%d/mfa", catererID, caterer.ID), map[string]string{"reason": "Telefon verloren"}, nil))
	enrolled, err := identity.HasMFAEnrollment(f.ctx, caterer.ID)
	require.NoError(t, err)
	assert.False(t, enrolled, "the caterer's second factor is reset")
}

// The operator team: open invitations are listed, sent again and revoked,
// and a member is deactivated and reactivated.
func TestOperatorRoutesManageTheOperatorTeam(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	provisioning, identity := buildOperatorProvisioningWithIdentity(t, db)
	f := operatorPortalRoutes(t, db, provisioning, operatorIdentityRoutesOf(identity).mountInvitationRoutes)
	email := fmt.Sprintf("route-team-%d@example.test", testpkg.UniqueTestTenantID(t))
	ownOutboxMailTo(t, f.db, email)
	f.call(t, http.MethodPost, "/operator/invitations/", map[string]string{"email": email}, nil)
	type team struct {
		Invitations []struct {
			ID    wireID `json:"id"`
			Email string `json:"email"`
		} `json:"invitations"`
		Operators []struct {
			ID     wireID `json:"id"`
			IsSelf bool   `json:"is_self"`
		} `json:"operators"`
	}
	var listed team
	f.call(t, http.MethodGet, "/operator/invitations/", nil, &listed)
	var invitationID int64
	for _, invitation := range listed.Invitations {
		if invitation.Email == email {
			invitationID = int64(invitation.ID)
		}
	}
	require.NotZero(t, invitationID, "the open invitation is listed")
	f.call(t, http.MethodPost, fmt.Sprintf("/operator/invitations/%d/resend", invitationID), nil, nil)
	assert.Equal(t, http.StatusNoContent, f.call(t, http.MethodDelete, fmt.Sprintf("/operator/invitations/%d", invitationID), nil, nil))
	var open int
	require.NoError(t, f.db.NewRaw(`SELECT count(*) FROM platform.operator_invitation_tokens WHERE id = ? AND used_at IS NULL`, invitationID).Scan(testpkg.Ctx(t), &open))
	assert.Zero(t, open, "the invitation is revoked")

	member := testpkg.CreateTestOperator(t, f.db)
	var deactivated struct {
		ID     wireID `json:"id"`
		Active bool   `json:"active"`
	}
	f.call(t, http.MethodPost, fmt.Sprintf("/operator/operators/%d/deactivate", member.ID), nil, &deactivated)
	assert.Equal(t, member.ID, int64(deactivated.ID))
	assert.False(t, deactivated.Active)
	var reactivated struct {
		Active bool `json:"active"`
	}
	f.call(t, http.MethodPost, fmt.Sprintf("/operator/operators/%d/reactivate", member.ID), nil, &reactivated)
	assert.True(t, reactivated.Active)
}

// The operator writes, changes and deletes an announcement.
func TestOperatorRoutesWriteChangeAndDeleteAnAnnouncement(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	operatorID := testpkg.CreateTestOperator(t, db).ID
	ownAnnouncementsByOperator(t, db, operatorID)
	inner := chi.NewRouter()
	mountOperatorAnnouncementRoutes(inner, operatorannouncements.NewAnnouncementsResource(buildCommunication(t, db, &auditRecorder{}), time.Now),
		provisioningAPI.NewProvisioningResource(provisioningAPI.ProvisioningConfig{Service: buildOperatorProvisioning(t, db)}))
	router := chi.NewRouter()
	router.Mount("/operator", inner)
	f := operatorProvisioningRoutes{db: db, router: router, ctx: provisioningContext(t, db), operatorID: operatorID}
	type announcement struct {
		ID              wireID   `json:"id"`
		Title           string   `json:"title"`
		TargetTenantIDs []wireID `json:"target_tenant_ids"`
	}

	var created announcement
	assert.Equal(t, http.StatusCreated, f.call(t, http.MethodPost, "/operator/announcements/", map[string]any{
		"title": "Route Wartung", "content": "Heute Abend", "type": "announcement", "severity": "info",
		"target_tenant_ids": []int64{testpkg.Tenant(t)},
	}, &created))
	assert.Equal(t, []int64{testpkg.Tenant(t)}, testpkg.IDs(created.TargetTenantIDs))
	var changed announcement
	f.call(t, http.MethodPut, fmt.Sprintf("/operator/announcements/%d", created.ID), map[string]any{
		"title": "Route Wartung verschoben", "content": "Morgen Abend", "type": "announcement", "severity": "info",
	}, &changed)
	assert.Equal(t, "Route Wartung verschoben", changed.Title)
	f.call(t, http.MethodDelete, fmt.Sprintf("/operator/announcements/%d", created.ID), nil, nil)
	var left int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM platform.announcements WHERE id = ?`, created.ID).Scan(testpkg.Ctx(t), &left))
	assert.Zero(t, left, "the announcement is deleted")
}
