package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/communication/http/operatorannouncements"
	devicefleetCompose "github.com/moto-ogs/project-phoenix/modules/devicefleet/compose"
	tagScanOperatorAPI "github.com/moto-ogs/project-phoenix/modules/devicefleet/inbound/operator"
	identityoperator "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/operator"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	provisioningAPI "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/inbound/operator"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The operator's provisioning writes through the routes the operator portal
// calls (#2352): the provisioning routes mounted under /operator over the
// production composition, so every answer is held to the contract of its
// full pattern.

type operatorProvisioningRoutes struct {
	db         *bun.DB
	service    organizationtenancy.OperatorProvisioning
	router     chi.Router
	ctx        context.Context
	operatorID int64
}

func newOperatorProvisioningRoutes(t *testing.T) operatorProvisioningRoutes {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	service := buildOperatorProvisioning(t, db)
	resource := provisioningAPI.NewProvisioningResource(provisioningAPI.ProvisioningConfig{
		Service: service, RequiredDetails: service.RequiredDetails, DeviceBlocking: service.DeviceBlocking,
		DeviceHistory: service.DeviceHistory, DeviceSlots: service.DeviceSlots,
	})
	operator := chi.NewRouter()
	mountOperatorProvisioningRoutes(operator, resource, nil)
	mountOperatorSchoolRoutes(operator, resource, nil, nil, nil)
	router := chi.NewRouter()
	router.Mount("/operator", operator)
	return operatorProvisioningRoutes{
		db: db, service: service, router: router,
		ctx: provisioningContext(t, db), operatorID: testpkg.CreateTestOperator(t, db).ID,
	}
}

// call sends one operator request and decodes the data of a success.
func (f operatorProvisioningRoutes) call(t *testing.T, method, path string, body any, data any) int {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	req := httptest.NewRequest(method, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(f.ctx, sessiontoken.CtxClaims, sessiontoken.AppClaims{ID: int(f.operatorID), Scope: "platform"}))
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, req)
	if data != nil && rec.Code < http.StatusMultipleChoices {
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope), rec.Body.String())
		require.NoError(t, json.Unmarshal(envelope.Data, data), rec.Body.String())
	}
	require.Less(t, rec.Code, http.StatusMultipleChoices, "%s %s: %s", method, path, rec.Body.String())
	return rec.Code
}

func (f operatorProvisioningRoutes) deletedAt(t *testing.T, table string, id int64) *string {
	t.Helper()
	var deletedAt *string
	require.NoError(t, f.db.NewSelect().TableExpr(table).Column("deleted_at").Where("id = ?", id).Scan(testpkg.Ctx(t), &deletedAt))
	return deletedAt
}

func TestOperatorRoutesCreateAndRestoreOrganizationsAndSchools(t *testing.T) {
	t.Parallel()
	f := newOperatorProvisioningRoutes(t)
	suffix := testpkg.UniqueTestTenantID(t)

	var organization struct {
		ID   int64  `json:"id"`
		Slug string `json:"slug"`
	}
	slug := fmt.Sprintf("route-org-%d", suffix)
	assert.Equal(t, http.StatusCreated, f.call(t, http.MethodPost, "/operator/organizations/", map[string]string{"name": " Route Träger ", "slug": slug}, &organization))
	assert.Equal(t, slug, organization.Slug)
	var storedName string
	require.NoError(t, f.db.NewSelect().TableExpr("platform.organizations").Column("name").Where("id = ?", organization.ID).Scan(testpkg.Ctx(t), &storedName))
	assert.Equal(t, "Route Träger", storedName)

	require.NoError(t, f.service.SoftDeleteOrganization(f.ctx, organization.ID, f.operatorID, provisioningTestClientIP))
	f.call(t, http.MethodPost, fmt.Sprintf("/operator/organizations/%d/restore", organization.ID), nil, nil)
	assert.Nil(t, f.deletedAt(t, "platform.organizations", organization.ID), "the organization is restored")

	_, schoolID := provisionTestSchool(t, f.db, f.service, f.operatorID, "route-restore")
	require.NoError(t, f.service.SoftDeleteSchool(f.ctx, schoolID, f.operatorID, provisioningTestClientIP))
	f.call(t, http.MethodPost, fmt.Sprintf("/operator/schools/%d/restore", schoolID), nil, nil)
	assert.Nil(t, f.deletedAt(t, "platform.schools", schoolID), "the school is restored")
	assert.Equal(t, 1, countOperatorAudit(t, f.db, "restore", "school", schoolID))
}

func TestOperatorRoutesInviteAnAdminAndCreateASchoolAccount(t *testing.T) {
	t.Parallel()
	f := newOperatorProvisioningRoutes(t)
	_, schoolID := provisionTestSchool(t, f.db, f.service, f.operatorID, "route-accounts")

	var invitation struct {
		ID             int64  `json:"id"`
		Email          string `json:"email"`
		RoleName       string `json:"role_name"`
		DeliveryStatus string `json:"delivery_status"`
	}
	email := fmt.Sprintf("route-admin-%d@example.test", schoolID)
	assert.Equal(t, http.StatusCreated, f.call(t, http.MethodPost, fmt.Sprintf("/operator/schools/%d/invite-admin", schoolID),
		map[string]string{"email": " " + email + " ", "first_name": "Erika"}, &invitation))
	assert.Equal(t, email, invitation.Email)
	assert.Equal(t, "admin", invitation.RoleName)
	var tenantID int64
	require.NoError(t, f.db.NewSelect().TableExpr("auth.invitation_tokens").Column("tenant_id").Where("id = ?", invitation.ID).Scan(testpkg.Ctx(t), &tenantID))
	assert.Equal(t, schoolID, tenantID)

	password := testpkg.NewTestPassword()
	var account struct {
		ID    int64  `json:"id"`
		Email string `json:"email"`
	}
	accountEmail := fmt.Sprintf("route-account-%d@example.test", schoolID)
	assert.Equal(t, http.StatusCreated, f.call(t, http.MethodPost, fmt.Sprintf("/operator/schools/%d/create-account", schoolID), map[string]string{
		"email": accountEmail, "first_name": "Rita", "last_name": "Route", "password": password, "confirm_password": password,
	}, &account))
	assert.Equal(t, accountEmail, account.Email)
	var accounts []struct {
		AccountID int64 `json:"account_id"`
	}
	f.call(t, http.MethodGet, fmt.Sprintf("/operator/schools/%d/accounts", schoolID), nil, &accounts)
	assert.Contains(t, accounts, struct {
		AccountID int64 `json:"account_id"`
	}{account.ID}, "the new account has access to the school")
}

type operatorRouteDevice struct {
	ID       int64   `json:"id"`
	SchoolID int64   `json:"school_id"`
	Status   string  `json:"status"`
	APIKey   *string `json:"api_key"`
}

func (f operatorProvisioningRoutes) storedDevice(t *testing.T, id int64) (status string, hash string) {
	t.Helper()
	var row struct {
		Status string `bun:"status"`
		Hash   string `bun:"api_key_hash"`
	}
	require.NoError(t, f.db.NewSelect().TableExpr("iot.devices").Column("status", "api_key_hash").Where("id = ?", id).Scan(testpkg.Ctx(t), &row))
	return row.Status, row.Hash
}

func TestOperatorRoutesRotateAndTransferADevice(t *testing.T) {
	t.Parallel()
	f := newOperatorProvisioningRoutes(t)
	organizationID, sourceID := provisionTestSchool(t, f.db, f.service, f.operatorID, "route-source")
	targetInput := newInput(f.service.CreateSchool)
	targetInput.OrganizationID, targetInput.FederalState, targetInput.Active = organizationID, "DE-BW", true
	targetInput.Name = fmt.Sprintf("Route Ziel %d", sourceID)
	targetInput.Slug = fmt.Sprintf("route-ziel-%d", sourceID)
	targetInput.Subdomain = targetInput.Slug
	target, err := f.service.CreateSchool(f.ctx, targetInput, f.operatorID, provisioningTestClientIP)
	require.NoError(t, err)

	var created operatorRouteDevice
	f.call(t, http.MethodPost, "/operator/devices/", map[string]any{"school_id": sourceID, "device_id": fmt.Sprintf("route-device-%d", sourceID), "device_type": "rfid_terminal"}, &created)
	_, firstHash := f.storedDevice(t, created.ID)

	var rotated operatorRouteDevice
	f.call(t, http.MethodPost, fmt.Sprintf("/operator/devices/%d/set-api-key", created.ID), map[string]string{}, &rotated)
	require.NotNil(t, rotated.APIKey, "a rotation shows the new key once")
	_, rotatedHash := f.storedDevice(t, created.ID)
	assert.NotEqual(t, firstHash, rotatedHash, "the rotation stores a new key")

	var status struct {
		CanTransfer bool `json:"can_transfer"`
	}
	f.call(t, http.MethodGet, fmt.Sprintf("/operator/devices/%d/transfer-status", created.ID), nil, &status)
	assert.True(t, status.CanTransfer, "an idle device can move")

	var moved operatorRouteDevice
	f.call(t, http.MethodPost, fmt.Sprintf("/operator/devices/%d/transfer", created.ID), map[string]int64{"target_school_id": target.ID}, &moved)
	assert.Equal(t, target.ID, moved.SchoolID)
	var tenantID int64
	require.NoError(t, f.db.NewSelect().TableExpr("iot.devices").Column("tenant_id").Where("id = ?", moved.ID).Scan(testpkg.Ctx(t), &tenantID))
	assert.Equal(t, target.ID, tenantID, "the moved device belongs to the target school")
}

func TestOperatorRoutesBlockAndUnblockADevice(t *testing.T) {
	t.Parallel()
	f := newOperatorProvisioningRoutes(t)
	_, schoolID := provisionTestSchool(t, f.db, f.service, f.operatorID, "route-block")
	device, err := f.service.CreateDevice(f.ctx, schoolID, fmt.Sprintf("route-block-%d", schoolID), "rfid_terminal", nil, nil, f.operatorID, provisioningTestClientIP)
	require.NoError(t, err)
	_, hash := f.storedDevice(t, device.ID)

	f.call(t, http.MethodPost, fmt.Sprintf("/operator/devices/%d/block", device.ID), nil, nil)
	status, blockedHash := f.storedDevice(t, device.ID)
	assert.Equal(t, "inactive", status)
	assert.Equal(t, hash, blockedHash, "blocking keeps the key")

	f.call(t, http.MethodPost, fmt.Sprintf("/operator/devices/%d/unblock", device.ID), nil, nil)
	status, unblockedHash := f.storedDevice(t, device.ID)
	assert.Equal(t, "active", status)
	assert.Equal(t, hash, unblockedHash, "the unblocked device keeps its key")

	// The history names what happened to the device, newest first.
	var history []struct {
		Action   string `json:"action"`
		SchoolID string `json:"school_id"`
	}
	f.call(t, http.MethodGet, fmt.Sprintf("/operator/devices/%d/history", device.ID), nil, &history)
	require.NotEmpty(t, history)
	for _, entry := range history {
		assert.Equal(t, fmt.Sprint(schoolID), entry.SchoolID)
	}

	// The school's device limit is stored as the operator sets it.
	f.call(t, http.MethodPut, fmt.Sprintf("/operator/schools/%d/device-slots", schoolID), map[string]any{"device_slots": 3}, nil)
	var slots int
	require.NoError(t, f.db.NewSelect().TableExpr("platform.schools").Column("device_slots").Where("id = ?", schoolID).Scan(testpkg.Ctx(t), &slots))
	assert.Equal(t, 3, slots)
}

// The operator's own profile and the caterer list read and write through
// Identity & Access under /operator.
func TestOperatorRoutesReadAndRenameTheProfileAndListCaterers(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	service, identity := buildOperatorProvisioningWithIdentity(t, db)
	operator := testpkg.CreateTestOperator(t, db)
	ctx := provisioningContext(t, db)
	caterers := identity.Caterers()
	require.NotNil(t, caterers)
	routes := operatorIdentityRoutes{
		account:  identityoperator.NewResource(identity, provisioningAPI.ProvisioningErrorRenderer),
		profile:  identityoperator.NewProfileResource(identity),
		caterers: &identityoperator.CatererMFAResource{Caterers: caterers},
	}
	inner := chi.NewRouter()
	routes.mountProfileRoutes(inner)
	routes.mountCatererMFARoutes(inner, provisioningAPI.NewProvisioningResource(provisioningAPI.ProvisioningConfig{Service: service}))
	router := chi.NewRouter()
	router.Mount("/operator", inner)
	f := operatorProvisioningRoutes{router: router, ctx: ctx, operatorID: operator.ID}

	var profile struct {
		ID          int64  `json:"id"`
		Email       string `json:"email"`
		DisplayName string `json:"display_name"`
	}
	f.call(t, http.MethodGet, "/operator/profile", nil, &profile)
	assert.Equal(t, operator.ID, profile.ID)
	assert.Equal(t, operator.Email, profile.Email)

	f.call(t, http.MethodPut, "/operator/profile", map[string]string{"display_name": "Route Betrieb"}, &profile)
	assert.Equal(t, "Route Betrieb", profile.DisplayName)
	var stored string
	require.NoError(t, db.NewSelect().TableExpr("platform.operators").Column("display_name").Where("id = ?", operator.ID).Scan(testpkg.Ctx(t), &stored))
	assert.Equal(t, "Route Betrieb", stored)

	account := testpkg.CreateTestAccount(t, db, "route-caterer")
	var catererID int64
	require.NoError(t, db.NewRaw(`INSERT INTO auth.caterers (name) VALUES ('Routenküche') RETURNING id`).Scan(testpkg.Ctx(t), &catererID))
	t.Cleanup(func() {
		_, err := db.ExecContext(context.Background(), `DELETE FROM auth.caterers WHERE id = ?`, catererID)
		assert.NoError(t, err)
	})
	_, err := db.ExecContext(testpkg.Ctx(t), `INSERT INTO auth.caterer_accounts (account_id, caterer_id) VALUES (?, ?)`, account.ID, catererID)
	require.NoError(t, err)
	var listed []struct {
		ID        string `json:"id"`
		AccountID string `json:"account_id"`
		Name      string `json:"name"`
	}
	f.call(t, http.MethodGet, "/operator/caterers", nil, &listed)
	assert.Contains(t, listed, struct {
		ID        string `json:"id"`
		AccountID string `json:"account_id"`
		Name      string `json:"name"`
	}{fmt.Sprint(catererID), fmt.Sprint(account.ID), "Routenküche"}, "the operator lists the caterer with its account")
}

// An operator publishes an announcement and reads who saw it.
func TestOperatorRoutesPublishAnAnnouncementAndReadItsViews(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := provisioningContext(t, db)
	operatorID := testpkg.CreateTestOperator(t, db).ID
	ownAnnouncementsByOperator(t, db, operatorID)
	module := buildCommunication(t, db, &auditRecorder{})
	announcement := newAnnouncement("Route publication", testpkg.Tenant(t))
	require.NoError(t, module.CreateAnnouncement(ctx, announcement, operatorID, nil))
	inner := chi.NewRouter()
	mountOperatorAnnouncementRoutes(inner, operatorannouncements.NewAnnouncementsResource(module, time.Now),
		provisioningAPI.NewProvisioningResource(provisioningAPI.ProvisioningConfig{Service: buildOperatorProvisioning(t, db)}))
	router := chi.NewRouter()
	router.Mount("/operator", inner)
	f := operatorProvisioningRoutes{router: router, ctx: ctx, operatorID: operatorID}
	base := fmt.Sprintf("/operator/announcements/%d", announcement.ID)

	f.call(t, http.MethodPost, base+"/publish", nil, nil)
	var publishedAt *time.Time
	require.NoError(t, db.NewSelect().TableExpr("platform.announcements").Column("published_at").Where("id = ?", announcement.ID).Scan(testpkg.Ctx(t), &publishedAt))
	assert.NotNil(t, publishedAt, "the announcement is published")

	_, viewer := testpkg.CreateTestPersonWithAccount(t, db, "Route", "Leserin")
	require.NoError(t, module.MarkSeen(ctx, viewer.ID, announcement.ID))
	var stats struct {
		AnnouncementID int64 `json:"announcement_id"`
		SeenCount      int   `json:"seen_count"`
	}
	f.call(t, http.MethodGet, base+"/stats", nil, &stats)
	assert.Equal(t, announcement.ID, stats.AnnouncementID)
	assert.Equal(t, 1, stats.SeenCount)
	var views []struct {
		UserID   int64  `json:"user_id"`
		UserName string `json:"user_name"`
	}
	f.call(t, http.MethodGet, base+"/views", nil, &views)
	require.Len(t, views, 1)
	assert.Equal(t, viewer.ID, views[0].UserID)
	assert.Equal(t, "Route Leserin", views[0].UserName)
}

// The review of unregistered RFID scans lists a Träger's open scans and,
// asked for all, the handled ones too.
func TestOperatorRoutesListUnregisteredTagScansOfATraeger(t *testing.T) {
	t.Parallel()
	f := newOperatorProvisioningRoutes(t)
	_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, fleet, _, _, _, _, err := composeTestRoot(testpkg.NewDatabase(t, f.db), slog.Default(), currentTestServiceConfig())
	require.NoError(t, err)
	organizations, err := owners.NewOrganizationTenancy(testpkg.NewDatabase(t, f.db))
	require.NoError(t, err)
	review := tagScanOperatorAPI.NewResource(tagScanOperatorAPI.Config{
		Scans: devicefleetCompose.NewIoTService(fleet, time.Now).Fleet(), Directory: tagScanSchoolDirectory{schools: organizations},
		Surface: tagScanOperatorAPI.Surface{
			InvalidRequest: common.OperatorInvalidRequest, Internal: common.OperatorInternal,
			RenderError: common.RenderError, Respond: common.Respond, OperatorID: operatorIDFromSession,
		},
	})
	inner := chi.NewRouter()
	mountOperatorTagScanRoutes(inner, review.Router, provisioningAPI.NewProvisioningResource(provisioningAPI.ProvisioningConfig{Service: f.service}))
	f.router = chi.NewRouter()
	f.router.Mount("/operator", inner)
	organizationID, schoolID := provisionTestSchool(t, f.db, f.service, f.operatorID, "route-scans")
	_, otherSchool := provisionTestSchool(t, f.db, f.service, f.operatorID, "route-scans-other")
	insert := func(tenantID int64, tag string, resolved bool) {
		t.Helper()
		_, err := f.db.ExecContext(testpkg.Ctx(t), `INSERT INTO audit.unregistered_tag_scans (tenant_id, tag_uid, resolved_at) VALUES (?, ?, CASE WHEN ? THEN NOW() END)`, tenantID, tag, resolved)
		require.NoError(t, err)
	}
	insert(schoolID, "ROUTE-OPEN", false)
	insert(schoolID, "ROUTE-DONE", true)
	insert(otherSchool, "ROUTE-OTHER", false)
	type scan struct {
		TagUID     string `json:"tag_uid"`
		SchoolID   int64  `json:"school_id"`
		SchoolName string `json:"school_name"`
	}
	tags := func(scans []scan) []string {
		var out []string
		for _, s := range scans {
			assert.Equal(t, schoolID, s.SchoolID)
			assert.NotEmpty(t, s.SchoolName)
			out = append(out, s.TagUID)
		}
		return out
	}

	var open []scan
	f.call(t, http.MethodGet, fmt.Sprintf("/operator/unregistered-tag-scans?organization_id=%d", organizationID), nil, &open)
	assert.Equal(t, []string{"ROUTE-OPEN"}, tags(open), "the open scans of the Träger's schools")
	var all []scan
	f.call(t, http.MethodGet, fmt.Sprintf("/operator/unregistered-tag-scans?organization_id=%d&school_id=%d&resolved=all", organizationID, schoolID), nil, &all)
	assert.ElementsMatch(t, []string{"ROUTE-OPEN", "ROUTE-DONE"}, tags(all), "asked for all, the handled scan too")
}
