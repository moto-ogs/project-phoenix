package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"

	"github.com/go-chi/chi/v5"
	"github.com/spf13/viper"

	apiCommon "github.com/moto-ogs/project-phoenix/api/common"
	carePlanModule "github.com/moto-ogs/project-phoenix/modules/careplan"
	communicationModule "github.com/moto-ogs/project-phoenix/modules/communication"
	platformAnnouncementsHTTP "github.com/moto-ogs/project-phoenix/modules/communication/http/platformannouncements"
	importModels "github.com/moto-ogs/project-phoenix/modules/dataimport"
	nativeUploads "github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	deliveryRuntime "github.com/moto-ogs/project-phoenix/modules/delivery/runtime"
	devicefleetCompose "github.com/moto-ogs/project-phoenix/modules/devicefleet/compose"
	tagScanOperatorAPI "github.com/moto-ogs/project-phoenix/modules/devicefleet/inbound/operator"
	enrollmentOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	identityaccessCompose "github.com/moto-ogs/project-phoenix/modules/identityaccess/compose"
	authAPI "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/account"
	identityOperatorAPI "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/operator"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/portalauth"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	organizationCompose "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/compose"
	provisioningOperatorAPI "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/inbound/operator"
	peopleCompose "github.com/moto-ogs/project-phoenix/modules/peopledirectory/compose"
	peoplePorts "github.com/moto-ogs/project-phoenix/modules/peopledirectory/ports"
	calendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/portal/compose"
	settingsCompose "github.com/moto-ogs/project-phoenix/modules/settings/compose"
	settingsOperatorAPI "github.com/moto-ogs/project-phoenix/modules/settings/inbound/operator"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	transactionFailures "github.com/moto-ogs/project-phoenix/modules/transactionruntime"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/realtime"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	parentportal "github.com/moto-ogs/project-phoenix/workflows/parentportal"
	parentAPI "github.com/moto-ogs/project-phoenix/workflows/parentportal/http"
)

// mountPortalRoutes mounts the root-level session portals: tenant auth,
// operator dashboard (separate from the tenant API) and the cross-tenant
// guardian portal. The auth rate limiter guards each login.
func mountPortalRoutes(root chi.Router, limiters authRateLimiters, account *authAPI.Resource, operator chi.Router, parent *parentAPI.Resource) {
	// RouterWithAuthRateLimiter applies the limiter only to the public login,
	// password-reset, MFA and passkey-login routes.
	root.Mount("/auth", account.RouterWithAuthRateLimiter(limiters.authMiddleware(), TenantSessionChain))
	root.Mount("/operator", operator)
	root.Mount("/parent", parent.RouterWithAuthRateLimiter(limiters.authMiddleware(), ParentSessionChain))
}

// caregiverCapabilityViews binds People Directory's caregiver capability for
// the account and operator routes that toggle it (#2736); db opens the
// administrative transaction of the operator routes.
func caregiverCapabilityViews(db transactionruntime.Database, caregivers peoplePorts.CaregiverCapabilityService) peopleCompose.CaregiverCapabilityViews {
	return peopleCompose.NewCaregiverCapabilityViews(caregivers, db.Pool())
}

// newAccountResource composes the tenant account routes. Their caregiver
// capability is the one the operator routes provision with.
func newAccountResource(db transactionruntime.Database, identity identityaccess.Owner, organizations organizationtenancy.Query, caregivers peoplePorts.CaregiverCapabilityService, settings settingsCompose.SettingsService) *authAPI.Resource {
	authSchools := NewAuthSchoolDirectory(organizations, identity)
	resource := authAPI.NewResource(identity, identity, authSchools, identity, identityaccessCompose.TenantUnitOfWork{}, transactionFailures.IsConstraintViolation, settings)
	resource.CaregiverCapabilityService = caregiverCapabilityViews(db, caregivers)
	resource.RoleGrants = owners.RoleGrantPolicy{}
	resource.MFAService = identity
	resource.PasskeyService = identity
	// The setup link of a parent account at a Träger is its own capability
	// beside the Owner facade (ADR 0216).
	resource.HolidayParentSetups, _ = identity.(identityaccess.HolidayParentSetups)
	return resource
}

// operatorIdentityCapabilities are the Identity & Access capabilities the
// operator routes call.
type operatorIdentityCapabilities interface {
	identityaccess.OperatorSessionLiveness
	identityOperatorAPI.Capability
	identityOperatorAPI.OperatorAccess
	identityaccess.OperatorPasskeyFlows
	identityaccess.OperatorMFAFlows
	identityaccess.AccountMFA
	Caterers() *identityaccess.CatererAccess
}

// newOperatorIdentity binds the operator sign-in, session and account routes
// to Identity & Access.
func newOperatorIdentity(sessionAuth *sessiontoken.TokenAuth, identity operatorIdentityCapabilities) operatorIdentity {
	var caterers identityOperatorAPI.CatererMFA
	if identity != nil {
		if access := identity.Caterers(); access != nil {
			caterers = access
		}
	}
	return operatorIdentity{
		caterers:    caterers,
		sessions:    identityOperatorAPI.NewSessions(sessionAuth, identity),
		account:     identityOperatorAPI.NewResource(identity, provisioningOperatorAPI.ProvisioningErrorRenderer),
		access:      identity,
		passkeys:    identity,
		mfa:         identity,
		invitations: identity,
		accountMFA:  identity,
	}
}

// newTagScanReview composes Device Fleet's review of unregistered RFID scans;
// it answers in the operator surface's format (#3232).
func newTagScanReview(iot devicefleetCompose.IoTService, organizations organizationtenancy.Query) *tagScanOperatorAPI.Resource {
	return tagScanOperatorAPI.NewResource(tagScanOperatorAPI.Config{
		Scans:     iot.Fleet(),
		Directory: tagScanSchoolDirectory{schools: organizations},
		Surface: tagScanOperatorAPI.Surface{
			InvalidRequest: apiCommon.OperatorInvalidRequest,
			Internal:       apiCommon.OperatorInternal,
			RenderError:    apiCommon.RenderError,
			Respond:        apiCommon.Respond,
			OperatorID:     operatorIDFromSession,
		},
	})
}

// newOperatorRouter composes the operator dashboard.
func newOperatorRouter(
	db transactionruntime.Database, logger *slog.Logger, sessionAuth *sessiontoken.TokenAuth, limiters authRateLimiters,
	iot devicefleetCompose.IoTService, organizations organizationtenancy.Query, settings settingsCompose.SettingsService,
	hub *realtime.Hub, active studentpresence.Presence, settingsWrites SettingsWrites, identity identityaccess.Owner,
	provisioning organizationtenancy.OperatorProvisioning, caregivers peoplePorts.CaregiverCapabilityService,
	lifecycle carePlanModule.CareLifecycle, communication communicationModule.Capability,
	students importModels.RowImporter[importModels.StudentImportRow], traegerSettings settingsOperatorAPI.TraegerOperations,
	demoPlans studentpresence.DemoCareDays,
	now func() time.Time,
) (chi.Router, error) {
	tagScanReview := newTagScanReview(iot, organizations)
	billing, err := owners.NewOperatorBilling(logger)
	if err != nil {
		return nil, fmt.Errorf("compose operator billing: %w", err)
	}
	schoolSettings := settingsCompose.NewOperatorSchoolSettings(settingsCompose.OperatorDependencies{
		Settings:       settings,
		DB:             db.Pool(),
		Notify:         owners.SettingsChangedNotifier(hub),
		OpenAttendance: OpenAttendanceChecker{Service: active},
		// Mirror the tenant-side OnValueSet hook so operator writes also
		// trigger side effects (e.g. auto-creating the Schulhof/WC rooms when
		// the corresponding checkout toggle flips on).
		OnValueSet: settingsWrites.SideEffects.Dispatch,
		Now:        now,
	})
	provisioningConfig, err := newProvisioningConfig(provisioning, caregiverCapabilityViews(db, caregivers))
	if err != nil {
		return nil, err
	}
	mergeRoutes, err := newStaffPersonMergeRoutes(db, now)
	if err != nil {
		return nil, err
	}
	demoRoutes, err := newDemoOperatorRoutes(db, viper.GetString("app_env"), demoPlans)
	if err != nil {
		return nil, err
	}
	return operatorRouter(
		newOperatorIdentity(sessionAuth, identity),
		provisioningConfig,
		provisioningOperatorAPI.NewBillingResource(billing, nil),
		&operatorSchoolSettings{
			values: settingsOperatorAPI.NewSettingsResource(settingsOperatorAPI.SettingsConfig{
				Settings:   schoolSettings,
				Schools:    operatorSettingsSchools{schools: organizations},
				OperatorID: operatorIDFromSession,
			}),
			bookingAuthorityImpact: newBookingAuthorityImpact(lifecycle, calendar.CalendarDateClock(now)),
			traegerValues:          traegerSettings,
		},
		communication,
		tagScanReview.Router,
		limiters,
		mergeRoutes,
		newSampleChildrenRoute(provisioning, students),
		demoRoutes,
		now,
	), nil
}

// newParentResource composes the cross-tenant guardian portal: public
// /parent/auth/login and the protected /parent/* routes; now is the root
// clock the parents' uploads are stamped with (ADR 0265).
func newParentResource(
	logger *slog.Logger, uploads nativeUploads.UploadFiles, identity identityaccess.Owner, parent *parentportal.Portal, calendarApp calendarCompose.Application, flows owners.EnrollmentFlows,
	guardianProfiles *peopleCompose.GuardianProfileLoader, organizations organizationtenancy.Query,
	devices owners.DeliveryDevices, notifications owners.DeliveryNotifications, delivery deliveryRuntime.Capability,
	healthData enrollmentOwner.HolidayHealthCipher, traegerSettings TraegerBrandingSettings, now func() time.Time,
) *parentAPI.Resource {
	return parentAPI.NewResource(parentAPI.ResourceConfig{
		Now:         now,
		Auth:        parentPortalLogin(identity),
		Resets:      portalauth.PasswordResetRoutes(identity, identityaccess.PasswordResetScopeParent),
		Parent:      parent,
		Calendar:    calendarApp,
		Conferences: calendarApp,
		Enrollment: parentEnrollmentForms(
			enrollmentAPI.NewRequestService(flows.Intake),
			enrollmentUploadUnits{intake: flows.Intake, records: owners.NewEnrollmentBookings(now), reads: flows.Uploads},
			NewEnrollmentUploadStorage(logger.With("handler", "parent-enrollment-uploads"), uploads),
		),
		GuardianProfileLoader: newParentGuardianProfiles(guardianProfiles),
		Schools:               parentSchoolDirectory{schools: organizations},
		HolidayLinks:          newParentHolidayRegistrationLinks(organizations, delivery, healthData, traegerSettings, logger, now),
		Push:                  bindParentPushSubscriptions(devices.PushSubscriptions),
		Preferences:           bindParentPreferences(notifications.Preferences),
		Feed:                  bindParentNotificationFeed(notifications.GuardianFeed),
		PWAUsage:              devices.PWAUsage,
		Reports:               newDeclarationReports(),
		SupportedLocale:       bindParentLocale(notifications.Preferences),
		// Fotos und Dateien in den Nachrichten der Eltern (#6685).
		MessageAttachmentFiles: NewMessageAttachmentStorage(logger.With("handler", "parent-message-attachments"), uploads),
	})
}

func newPlatformRuntime() platformAnnouncementsHTTP.Runtime {
	return platformAnnouncementsHTTP.Runtime{
		// Tenant routes: parent-, school- and org-scope tokens are refused
		// with 401 (#2207).
		Protected: func(router chi.Router, register func(chi.Router)) {
			router.Group(func(r chi.Router) {
				TenantSessionChain(r)
				register(r)
			})
		},
		Viewer: func(r *http.Request) platformAnnouncementsHTTP.Viewer {
			claims := sessiontoken.ClaimsFromCtx(r.Context())
			return platformAnnouncementsHTTP.Viewer{AccountID: int64(claims.ID), Roles: claims.Roles, TenantID: claims.TenantID, OrgID: claims.OrgID}
		},
		IDParam: apiCommon.ParseInt64IDWithError,
		Success: apiCommon.Respond,
		Failure: func(w http.ResponseWriter, r *http.Request, failure platformAnnouncementsHTTP.Failure) {
			apiCommon.RenderError(w, r, apiCommon.ErrorInternalServerWrap(failure.Message, failure.Err))
		},
	}
}

// newSessionTokenAuth hands the signing configuration to Identity's
// composition, which builds the HTTP session runtime (ADR 0053 point 6).
func newSessionTokenAuth() (*sessiontoken.TokenAuth, error) {
	return NewConfiguredSessionAuth(
		viper.GetString("auth_jwt_secret"),
		viper.GetDuration("auth_jwt_expiry"),
		viper.GetDuration("auth_jwt_refresh_expiry"),
	)
}

// newSentryUserPseudonym keys the Sentry pseudonym of an account with the
// session secret the verifier above reads (#3843).
func newSentryUserPseudonym() (SentryUserPseudonym, error) {
	return NewSentryUserPseudonym(viper.GetString("auth_jwt_secret"))
}

// newProvisioningConfig binds the operator provisioning routes to the
// provisioning, the caregiver capability views and the audit of the Beleg
// retention (#4720) of the same composition.
func newProvisioningConfig(provisioning organizationtenancy.OperatorProvisioning, caregivers provisioningOperatorAPI.SchoolAccountCaregivers) (provisioningOperatorAPI.ProvisioningConfig, error) {
	audit, err := organizationCompose.BelegRetentionAudit(provisioning.Provisioning)
	if err != nil {
		return provisioningOperatorAPI.ProvisioningConfig{}, err
	}
	// The release „Personal beim Träger“ (#4705) records on the same audit.
	staffRelease, ok := audit.(organizationtenancy.TraegerStaffReleaseChangeAudit)
	if !ok {
		return provisioningOperatorAPI.ProvisioningConfig{}, fmt.Errorf("operator provisioning: %T records no staff release", audit)
	}
	return provisioningOperatorAPI.ProvisioningConfig{
		Service: provisioning, CaregiverCapability: caregivers, AppEnv: viper.GetString("app_env"), BelegRetentionAudit: audit,
		TraegerStaffReleaseAudit: staffRelease, ErasureOrderRecords: provisioning.ErasureOrderRecords,
		RequiredDetails: provisioning.RequiredDetails, DeviceBlocking: provisioning.DeviceBlocking,
		DeviceHistory: provisioning.DeviceHistory,
		DeviceSlots:   provisioning.DeviceSlots,
	}, nil
}
