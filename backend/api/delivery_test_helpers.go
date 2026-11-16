//go:build testhooks

package api

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/realtime"

	owners "github.com/moto-ogs/project-phoenix/roots/owners"

	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"

	email "github.com/moto-ogs/project-phoenix/modules/delivery/mail"

	communicationCompose "github.com/moto-ogs/project-phoenix/modules/communication/composition"
	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	peopleCompose "github.com/moto-ogs/project-phoenix/modules/peopledirectory/compose"
	peoplePorts "github.com/moto-ogs/project-phoenix/modules/peopledirectory/ports"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/tenant"
	parentAPI "github.com/moto-ogs/project-phoenix/workflows/parentportal/http"
)

// NewNotificationConsentTestStore builds Communication's consent capability
// for tests that need the real rows. It lives at this composition seam because
// a consumer's test package may not reach into another owner's composition.
func NewNotificationConsentTestStore(db transactionruntime.Database) deliveryCompose.NotificationConsentStore {
	consent, err := communicationCompose.NewNotificationConsent(communicationCompose.NotificationConsentConfig{DB: db.Pool()})
	if err != nil {
		panic(err)
	}
	return consent
}

// NewEnrollmentAdminSubscribersForTests binds the intake's opt-in admin mail
// (#3780) to Communication's real consent rows and Identity & Access, and
// returns the consent store the suite records decisions with.
func NewEnrollmentAdminSubscribersForTests(db transactionruntime.Database) (enrollmentCompose.AdminMailSubscribers, deliveryCompose.NotificationConsentStore, error) {
	consent, err := communicationCompose.NewNotificationConsent(communicationCompose.NotificationConsentConfig{DB: db.Pool()})
	if err != nil {
		return nil, nil, err
	}
	identity, err := NewIdentityAccessForTests(db)
	if err != nil {
		return nil, nil, err
	}
	return owners.NewEnrollmentAdminSubscribers(consent, identity), consent, nil
}

type DeliveryTestModule struct {
	Runtime                 *deliveryCompose.Runtime
	EmailOutbox             *deliveryCompose.EmailOutbox
	Notifications           deliveryCompose.Notifier
	PushSubscriptions       deliveryCompose.PushSubscriptionService
	NotificationPreferences deliveryCompose.NotificationPreferenceService
	// Feed reads the notification feed (#7148); Hub is the local realtime
	// hub its signals and the in-app notices go to.
	Feed deliveryContract.NotificationFeed
	Hub  *realtime.Hub
	// GuardianFeed reads the feed of a guardian across its schools (#7140).
	GuardianFeed deliveryContract.GuardianNotificationFeed
}

// NotificationPreferenceRouterForTests mounts the actual protected resources
// over the module's real owner stores, the notification feed (#7148)
// included. The outer host's session-liveness and
// module-booking middleware are outside this route-sized test root.
func (m DeliveryTestModule) NotificationPreferenceRouterForTests() chi.Router {
	router := chi.NewRouter()
	notifications := NewNotificationHTTP(nil, nil, m.NotificationPreferences, m.Feed)
	router.Mount("/api/notifications", notifications.Router())
	router.Mount("/school/notifications", notifications.SchoolRouter())
	parents := parentAPI.NewResource(parentAPI.ResourceConfig{
		Now:         time.Now,
		Preferences: bindParentPreferences(m.NotificationPreferences),
		Feed:        bindParentNotificationFeed(m.GuardianFeed),
	})
	router.Mount("/parent", parents.Router(ParentSessionChain))
	return router
}

func NewPushSubscriptionTestService(db transactionruntime.Database, unit tenant.UnitOfWork, vapid deliveryCompose.VAPIDConfig) (deliveryCompose.PushSubscriptionService, error) {
	identity, err := NewIdentityAccessForTests(db)
	if err != nil {
		return nil, err
	}
	return deliveryCompose.NewTenantPushSubscriptionService(unit, db.Pool(), deliveryCompose.NewPushSubscriptionRepository(db.Pool()), identity, vapid, slog.Default())
}

func NewDeliveryTestModule(db transactionruntime.Database, unit tenant.UnitOfWork) (DeliveryTestModule, error) {
	settings, err := owners.NewSettingsTestModule(db, unit)
	if err != nil {
		return DeliveryTestModule{}, err
	}
	members, err := NewIdentityAccessForTests(db)
	if err != nil {
		return DeliveryTestModule{}, err
	}
	organizations, err := owners.NewOrganizationTenancy(db)
	if err != nil {
		return DeliveryTestModule{}, err
	}
	logger := slog.Default()
	cfg := CurrentServiceConfig()
	vapid := deliveryCompose.VAPIDConfig{PublicKey: strings.TrimSpace(cfg.VAPIDPublicKey), PrivateKey: strings.TrimSpace(cfg.VAPIDPrivateKey), Subscriber: strings.TrimSpace(cfg.VAPIDSubscriber)}
	if err := vapid.Validate(); err != nil {
		return DeliveryTestModule{}, err
	}
	pushRepo := deliveryCompose.NewPushSubscriptionRepository(db.Pool())
	identity := owners.TenantMailIdentity(organizations, settings.Settings, owners.RootEnvironment{Logger: logger})
	guardians := peopleCompose.NewGuardianService(peoplePorts.GuardianServiceDependencies{GuardianProfileRepo: NewGuardianProfileTestRepository(db)}, db.Pool())
	delivery, err := deliveryCompose.NewModule(deliveryCompose.ModuleDependencies{
		DB: db.Pool(), People: owners.GuardianDisplayResolver{Query: guardians}, Observe: func(deliveryContract.Observation) {},
	})
	if err != nil {
		return DeliveryTestModule{}, err
	}
	fallbackMailer, err := deliveryCompose.NewMailTransport(email.MailerConfig{AppEnv: "test"})
	if err != nil {
		return DeliveryTestModule{}, err
	}
	_, err = deliveryCompose.NewWorker(delivery, &deliveryCompose.MailPushProvider{Registry: deliveryCompose.NewEmailTemplateRegistry(nil), Mailer: fallbackMailer, MailIdentity: identity,
		Push:   deliveryCompose.NewWebPushSender(deliveryContract.WebPushConfig{Subscriber: vapid.Subscriber, PublicKey: vapid.PublicKey, PrivateKey: vapid.PrivateKey}, deliveryCompose.NewExpiredPushSubscriptionCleaner(deliveryCompose.NewTenantTransactions(db.Pool()), pushRepo)),
		Logger: logger, Tenants: deliveryCompose.NewTenantTransactions(db.Pool()), PushAuthorized: deliveryCompose.NewPushAuthorizationChecker(deliveryCompose.NewTenantTransactions(db.Pool()), pushRepo), Now: delivery.Now})
	if err != nil {
		return DeliveryTestModule{}, err
	}
	hub := realtime.NewHub(logger)
	service, feed, err := newDeliveryTestRouter(db, unit, settings.Settings, delivery, hub, vapid, logger)
	if err != nil {
		return DeliveryTestModule{}, err
	}
	push, err := deliveryCompose.NewTenantPushSubscriptionService(unit, db.Pool(), pushRepo, members, vapid, logger)
	if err != nil {
		return DeliveryTestModule{}, err
	}
	preferences, err := deliveryCompose.NewTenantPreferenceService(unit, NewNotificationConsentTestStore(db), owners.DeliveryPreferenceSettings(settings.Settings), db.Pool(), members, securityruntime.HasPermission)
	if err != nil {
		return DeliveryTestModule{}, err
	}
	guardianFeed := service.(interface {
		GuardianFeed() deliveryContract.GuardianNotificationFeed
	}).GuardianFeed()
	return DeliveryTestModule{Runtime: delivery, EmailOutbox: deliveryCompose.NewEmailOutbox(deliveryCompose.NewDurableEmails(delivery.Module)),
		Notifications: service, PushSubscriptions: push, NotificationPreferences: preferences, Feed: feed, Hub: hub, GuardianFeed: guardianFeed}, nil
}

// newDeliveryTestRouter builds the notification router over the SSE, Web Push
// and feed channels with the feed reader beside it (#7148).
func newDeliveryTestRouter(db transactionruntime.Database, unit tenant.UnitOfWork, settings deliveryPushTestSettings, delivery *deliveryCompose.Runtime, hub *realtime.Hub,
	vapid deliveryCompose.VAPIDConfig, logger *slog.Logger,
) (deliveryCompose.Notifier, deliveryContract.NotificationFeed, error) {
	parentMembers := owners.MustNewMembershipTestRepositories(db)
	sse, err := deliveryCompose.NewTenantSSEChannel(unit, hub, db.Pool(), parentMembers.StudentGuardian, logger, delivery.Store)
	if err != nil {
		return nil, nil, err
	}
	webPush, err := deliveryCompose.NewTenantDurableWebPushChannel(unit, db.Pool(), deliveryCompose.NewPushSubscriptionRepository(db.Pool()), vapid, deliveryCompose.NewDurablePushOutbox(delivery.Module), logger)
	if err != nil {
		return nil, nil, err
	}
	notifier := deliveryCompose.NewNotifier(settings, logger, func(string, string, string, time.Duration, error) {}, delivery.Store, time.Now, sse, webPush)
	feed, ok := notifier.(deliveryContract.NotificationFeed)
	if !ok {
		return nil, nil, errors.New("notification router does not serve the notification feed")
	}
	return notifier, feed, nil
}

// deliveryPushTestSettings is the router's tenant gate read.
type deliveryPushTestSettings interface {
	ResolveBoolForTenant(ctx context.Context, tenantID int64, key string) (bool, error)
	ResolveStringForTenant(ctx context.Context, tenantID int64, key string) (string, error)
}

// NewDeliveryTestPushNotifier is the production notification router over the
// durable Web Push channel with fixed test VAPID keys, so a consumer's test
// can read the push intents its action stores in the real outbox.
func NewDeliveryTestPushNotifier(db transactionruntime.Database, unit tenant.UnitOfWork, settings deliveryPushTestSettings, module DeliveryTestModule) (deliveryCompose.Notifier, error) {
	vapid := deliveryCompose.VAPIDConfig{PublicKey: "pub", PrivateKey: "priv", Subscriber: "mailto:test@example.org"}
	webPush, err := deliveryCompose.NewTenantDurableWebPushChannel(unit, db.Pool(), deliveryCompose.NewPushSubscriptionRepository(db.Pool()),
		vapid, deliveryCompose.NewDurablePushOutbox(module.Runtime.Module), slog.Default())
	if err != nil {
		return nil, err
	}
	return deliveryCompose.NewNotifier(settings, slog.Default(), func(string, string, string, time.Duration, error) {}, nil, time.Now, webPush), nil
}

// NewDeliveryTestFeedNotifier is the production notification router with the
// notification feed (#7148) and the durable Web Push channel with fixed test
// VAPID keys, so a producer's test reads the feed entries and the push
// intents its action stores. The feed signals go to the module's hub.
func NewDeliveryTestFeedNotifier(db transactionruntime.Database, unit tenant.UnitOfWork, settings deliveryPushTestSettings, module DeliveryTestModule) (deliveryCompose.Notifier, error) {
	vapid := deliveryCompose.VAPIDConfig{PublicKey: "pub", PrivateKey: "priv", Subscriber: "mailto:test@example.org"}
	webPush, err := deliveryCompose.NewTenantDurableWebPushChannel(unit, db.Pool(), deliveryCompose.NewPushSubscriptionRepository(db.Pool()),
		vapid, deliveryCompose.NewDurablePushOutbox(module.Runtime.Module), slog.Default())
	if err != nil {
		return nil, err
	}
	parentMembers := owners.MustNewMembershipTestRepositories(db)
	sse, err := deliveryCompose.NewTenantSSEChannel(unit, module.Hub, db.Pool(), parentMembers.StudentGuardian, slog.Default(), module.Runtime.Store)
	if err != nil {
		return nil, err
	}
	return deliveryCompose.NewNotifier(settings, slog.Default(), func(string, string, string, time.Duration, error) {}, module.Runtime.Store, time.Now, sse, webPush), nil
}
