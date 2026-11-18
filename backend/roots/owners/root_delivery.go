package owners

import (
	"fmt"
	"maps"
	"slices"
	"time"

	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	settingsValues "github.com/moto-ogs/project-phoenix/modules/settings"

	realtime "github.com/moto-ogs/project-phoenix/realtime"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	careContractCompose "github.com/moto-ogs/project-phoenix/modules/carecontract/compose"
	"github.com/moto-ogs/project-phoenix/modules/communication"
	communicationCompose "github.com/moto-ogs/project-phoenix/modules/communication/composition"
	parentStore "github.com/moto-ogs/project-phoenix/modules/communication/parentstore"
	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryPolicy "github.com/moto-ogs/project-phoenix/modules/delivery/devices"
	email "github.com/moto-ogs/project-phoenix/modules/delivery/mail"
	deliveryModule "github.com/moto-ogs/project-phoenix/modules/delivery/runtime"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	parentBillingCompose "github.com/moto-ogs/project-phoenix/modules/parentbilling/compose"
	calendarService "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/portal"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	settingsCompose "github.com/moto-ogs/project-phoenix/modules/settings/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// DeliveryNotifications are Delivery's notification side (#1845): the
// router over the realtime and web push channels, the consent-backed
// preferences, the staff recipients, the staff notices of a parent message
// and the absence notices.
type DeliveryNotifications struct {
	Notifier            deliveryCompose.Notifier
	Preferences         deliveryCompose.NotificationPreferenceService
	StaffParentMessages deliveryCompose.StaffParentMessageNotifier
	AbsenceNotifier     deliveryCompose.AbsenceNotifier
	// ResponsibleStaff names the staff responsible for a child, such as the
	// team told about a changed pickup time (#6855).
	ResponsibleStaff deliveryContract.ResponsibleStaff
	// UnreportedAbsences tells the Schulverwaltung about children missing
	// without a report (#4791).
	UnreportedAbsences deliveryContract.UnreportedAbsenceNotifier
	// Feed serves an account its own notification feed (#7148).
	Feed deliveryContract.NotificationFeed
	// GuardianFeed serves a guardian account its feed across the schools of
	// the family in the parents portal (#7140).
	GuardianFeed deliveryContract.GuardianNotificationFeed
	// SchoolAudience names the accounts and families a notice to the whole
	// school reaches (#7144).
	SchoolAudience deliveryContract.SchoolAudience
	// TraegerNotices writes a notice into the bell of the Träger-Portal, and
	// TraegerFeed serves that bell across the schools of a Träger (#7146).
	TraegerNotices deliveryContract.TraegerFeedNotifier
	TraegerFeed    deliveryContract.TraegerNotificationFeed
	// CatererNotices writes a notice into the bell of the caterer portal, and
	// CatererFeed serves that bell across the schools a caterer supplies
	// (#7147).
	CatererNotices deliveryContract.CatererFeedNotifier
	CatererFeed    deliveryContract.CatererNotificationFeed
}

// BuildDeliveryNotifications binds the notification router over the realtime
// and web push channels, the consent-backed preferences, the staff
// recipients and the absence notices, every one over the root's unit of work.
// Consent rows back both the notification preferences and the opt-in "Neue
// Anmeldung" mail of the intake.
func BuildDeliveryNotifications(
	db transactionruntime.Database, unit rootUnitOfWork, env RootEnvironment, pushVAPID deliveryCompose.VAPIDConfig, hub *realtime.Hub, delivery DeliveryRuntime,
	settings settingsCompose.BatchSettingsService, consent communication.NotificationConsentCapability,
	identity identityaccess.Owner, people PeopleRows, structure StructureRows, workTime workforce.Capability,
	messaging parentStore.MessagingRepositories, assignments schoolmembership.TeachingAssignmentQuery,
) (DeliveryNotifications, error) {
	logger := env.Logger
	if !pushVAPID.Configured() {
		logger.Info("web push disabled: VAPID keys not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBSCRIBER)")
	}
	sse, err := deliveryCompose.NewTenantSSEChannel(unit, hub, db.Pool(), people.StudentGuardians, logger.With("channel", "sse"), delivery.Runtime.Store)
	if err != nil {
		return DeliveryNotifications{}, err
	}
	push, err := deliveryCompose.NewTenantDurableWebPushChannel(unit, db.Pool(), deliveryCompose.NewPushSubscriptionRepository(db.Pool()),
		pushVAPID, deliveryCompose.NewDurablePushOutbox(DeliveryModuleOf(delivery)), logger.With("channel", "web_push"))
	if err != nil {
		return DeliveryNotifications{}, err
	}
	// A nil environment clock is the real one (RootEnvironment.Now).
	clock := env.Now
	if clock == nil {
		clock = time.Now
	}
	notifier := deliveryCompose.NewNotifier(settings, logger.With("service", "notifications"), deliveryCompose.NotificationDeliveryObserver(env.Observe.Delivery), delivery.Runtime.Store, clock, sse, push)
	feeds, err := deliveryFeeds(notifier)
	if err != nil {
		return DeliveryNotifications{}, err
	}
	preferences, err := deliveryCompose.NewTenantPreferenceService(unit, consent, DeliveryPreferenceSettings(settings), db.Pool(), identity, securityruntime.HasPermission)
	if err != nil {
		return DeliveryNotifications{}, err
	}
	recipients := deliveryCompose.NewStaffRecipientResolver(preferences, deliveryStudentGroups{students: people.Students},
		structure.Groups, people.Staff, identity, settings,
		deliveryOnDutyStaff{presence: workTime}, timezone.CalendarDateClock(clock))
	schoolClasses := deliveryContract.SchoolClassRecipients{
		Reach:   deliverySchoolClassReach{students: people.Students, assignments: assignments, staff: people.Staff},
		Consent: preferences, Subscribers: consent, Accounts: identity, Permissions: securityruntime.HasPermission,
		Office: deliverySchoolOffice{staff: people.Staff},
	}
	absences, err := deliveryCompose.NewTenantAbsenceNotifier(unit, notifier, recipients, db.Pool(), logger.With("producer", "absence_notifications"), schoolClasses, timezone.CalendarDateClock(clock))
	if err != nil {
		return DeliveryNotifications{}, err
	}
	unreported, responsible, schoolAudience, err := deliveryCapabilities(absences, recipients, notifier)
	if err != nil {
		return DeliveryNotifications{}, err
	}
	return feeds.bind(DeliveryNotifications{
		UnreportedAbsences: unreported,
		Notifier:           notifier,
		Preferences:        preferences,
		StaffParentMessages: deliveryCompose.NewStaffParentMessageNotifier(notifier, recipients,
			messaging.ParentMessageThread, BindParentMessageLeadership(people.Staff, identity), db.Pool(), logger.With("producer", "staff_parent_message_notifications")),
		AbsenceNotifier:  absences,
		ResponsibleStaff: responsible,
		SchoolAudience:   schoolAudience,
	}), nil
}

// BuildDeliveryWorker composes the Worker that drains Delivery's outboxes:
// every outbox kind's renderer is known at startup, so the registry is
// complete before the worker claims anything. Enrollment keeps one renderer
// per kind so subjects and templates stay independent; calendar
// appointments share one renderer for all four kinds.
func BuildDeliveryWorker(
	db transactionruntime.Database, env RootEnvironment, mailSender email.Mailer, mailFrom email.Email, pushVAPID deliveryCompose.VAPIDConfig, mailIdentity email.ReplyToResolver,
	delivery DeliveryRuntime, appointments deliveryCompose.MailRenderer, identityRenderers map[string]deliveryCompose.MailRenderer, reminders CalendarReminderSource,
	modules settingsValues.ModuleBookingReader, documents parentportal.DocumentNotices, accounts HolidayAcceptanceAccounts,
) (*deliveryModule.Worker, error) {
	subscriptions := deliveryCompose.NewPushSubscriptionRepository(db.Pool())
	tenants := deliveryCompose.NewTenantTransactions(db.Pool())
	push := deliveryCompose.NewWebPushSender(deliveryContract.WebPushConfig{
		Subscriber: pushVAPID.Subscriber, PublicKey: pushVAPID.PublicKey, PrivateKey: pushVAPID.PrivateKey,
	}, deliveryCompose.NewExpiredPushSubscriptionCleaner(tenants, subscriptions))
	return buildDeliveryWorker(db, env, mailSender, mailFrom, mailIdentity, delivery, appointments, identityRenderers, reminders, modules, documents, push, accounts)
}

func buildDeliveryWorker(
	db transactionruntime.Database, env RootEnvironment, mailSender email.Mailer, mailFrom email.Email, mailIdentity email.ReplyToResolver,
	delivery DeliveryRuntime, appointments deliveryCompose.MailRenderer, identityRenderers map[string]deliveryCompose.MailRenderer, reminders CalendarReminderSource,
	modules settingsValues.ModuleBookingReader, documents parentportal.DocumentNotices, push deliveryContract.PushSender, accounts HolidayAcceptanceAccounts,
) (*deliveryModule.Worker, error) {
	defaultFrom := mailFrom
	renderers := map[string]deliveryCompose.MailRenderer{
		communication.MailKindParentAnnouncement: deliveryCompose.MailRendererFunc(BindCommunicationMailRenderer(communicationCompose.NewParentAnnouncementRenderer(communicationCompose.ParentAnnouncementEmailConfig{
			DefaultFrom: communication.MailAddress(defaultFrom),
		}))),
		communication.MailKindParentMessage:           deliveryCompose.MailRendererFunc(BindCommunicationMailRenderer(communicationCompose.NewParentMessageRenderer(communicationCompose.ParentMessageRendererConfig{DefaultFrom: communication.MailAddress(defaultFrom)}, deliveryPolicy.ParentDeliveryPolicy{}))),
		calendarService.EmailKindAppointmentPublished: appointments,
		calendarService.EmailKindAppointmentUpdated:   appointments,
		calendarService.EmailKindAppointmentCancelled: appointments,
		calendarService.EmailKindAppointmentReminder:  appointments,
		// The confirmation letter of a Träger, mailed with its PDF (#4670).
		parentbilling.MailKindBillingLetter: parentBillingLetterMailRenderer(parentBillingCompose.NewLetterMailRenderer(), defaultFrom),
		// The care contract of a Träger, mailed with its PDF (#4678).
		carecontract.MailKindContract: careContractMailRenderer(careContractCompose.NewContractMailRenderer(), defaultFrom),
		// The confirmation of a withdrawal or termination (#4682).
		carecontract.MailKindNotice: careContractNoticeMailRenderer(careContractCompose.NewNoticeMailRenderer(), defaultFrom),
	}
	enrollmentKinds := []string{}
	for kind, renderer := range enrollmentMailRenderers(enrollmentCompose.NewMailRenderers(newHolidayAcceptanceAccounts(accounts, env.Links.ParentsURL), env.Links.ParentsURL, env.Today), defaultFrom) {
		renderers[kind] = renderer
		enrollmentKinds = append(enrollmentKinds, kind)
	}
	moduleGate, err := newDeliveryModuleGate(modules, []string{
		communication.MailKindParentAnnouncement, communication.MailKindParentMessage,
		calendarService.EmailKindAppointmentPublished, calendarService.EmailKindAppointmentUpdated,
		calendarService.EmailKindAppointmentCancelled, calendarService.EmailKindAppointmentReminder,
		identityaccess.MailKindGuardianInvitation, identityaccess.MailKindGuardianWelcome,
	}, enrollmentKinds, []string{TransactionalMailKind, identityaccess.MailKindStaffWelcome, parentbilling.MailKindBillingLetter, carecontract.MailKindContract, carecontract.MailKindNotice})
	if err != nil {
		return nil, err
	}
	if err := moduleGate.requireClassified(slices.Collect(maps.Keys(renderers))); err != nil {
		return nil, err
	}
	for kind, renderer := range identityRenderers {
		renderers[kind] = renderer
	}
	pushObjects, err := NewParentPushObjectAuthorization(db)
	if err != nil {
		return nil, fmt.Errorf("initialize push object authorization: %w", err)
	}
	pushSubscriptions := deliveryCompose.NewPushSubscriptionRepository(db.Pool())
	tenants := deliveryCompose.NewTenantTransactions(db.Pool())
	worker, err := deliveryCompose.NewWorker(delivery.Runtime, &deliveryCompose.MailPushProvider{
		Registry: deliveryCompose.NewEmailTemplateRegistry(renderers), Mailer: mailSender, MailIdentity: mailIdentity,
		Push:   push,
		Logger: env.Logger.With("service", "delivery"), Tenants: tenants,
		PushAuthorized: deliveryCompose.NewPushAuthorizationChecker(tenants, pushSubscriptions),
		PushObjects:    pushObjects,
		DeferredPush:   deferredPushes(reminderRecovery(db, reminders), documents),
		Deliverable:    moduleGate.deliverable,
		Now:            clockOrReal(env.Now), // the clock of delivery.Runtime
	})
	if err != nil {
		return nil, fmt.Errorf("initialize delivery module: %w", err)
	}
	return worker, nil
}

// deliveryCapabilities are the further contracts of the composed Delivery:
// the notice about children missing without a report, the staff responsible
// for a child and the audience of the whole school (#7144).
func deliveryCapabilities(absences, recipients any, notifier deliveryCompose.Notifier) (deliveryContract.UnreportedAbsenceNotifier, deliveryContract.ResponsibleStaff, deliveryContract.SchoolAudience, error) {
	unreported, ok := absences.(deliveryContract.UnreportedAbsenceNotifier)
	if !ok {
		return nil, nil, nil, fmt.Errorf("absence notifier does not send the notice about children missing without a report")
	}
	responsible, ok := recipients.(deliveryContract.ResponsibleStaff)
	if !ok {
		return nil, nil, nil, fmt.Errorf("staff recipients do not name the staff responsible for a child")
	}
	audience, ok := notifier.(deliveryContract.SchoolAudience)
	if !ok {
		return nil, nil, nil, fmt.Errorf("notification router does not name the audience of the whole school")
	}
	return unreported, responsible, audience, nil
}

// deliveryFeedSides are the sides of the router's notification feed: the
// feed of a staff account in its school (#7148), the feed of a guardian
// across the family's schools (#7140), and the write and read side of the
// bell of the Träger-Portal (#7146) and of the caterer portal (#7147).
type deliveryFeedSides struct {
	staff          deliveryContract.NotificationFeed
	guardian       deliveryContract.GuardianNotificationFeed
	traegerNotices deliveryContract.TraegerFeedNotifier
	traeger        deliveryContract.TraegerNotificationFeed
	catererNotices deliveryContract.CatererFeedNotifier
	caterer        deliveryContract.CatererNotificationFeed
}

// bind hands the feed sides to the notifications the root wires.
func (f deliveryFeedSides) bind(notifications DeliveryNotifications) DeliveryNotifications {
	notifications.Feed, notifications.GuardianFeed = f.staff, f.guardian
	notifications.TraegerNotices, notifications.TraegerFeed = f.traegerNotices, f.traeger
	notifications.CatererNotices, notifications.CatererFeed = f.catererNotices, f.caterer
	return notifications
}

func deliveryFeeds(notifier deliveryCompose.Notifier) (deliveryFeedSides, error) {
	feed, ok := notifier.(deliveryContract.NotificationFeed)
	guardians, served := notifier.(interface {
		GuardianFeed() deliveryContract.GuardianNotificationFeed
	})
	if !ok || !served || guardians.GuardianFeed() == nil {
		return deliveryFeedSides{}, fmt.Errorf("notification router does not serve the notification feeds")
	}
	notices, writes := notifier.(deliveryContract.TraegerFeedNotifier)
	traeger, reads := notifier.(interface {
		TraegerFeed() deliveryContract.TraegerNotificationFeed
	})
	if !writes || !reads || traeger.TraegerFeed() == nil {
		return deliveryFeedSides{}, fmt.Errorf("notification router does not serve the Träger bell")
	}
	catererNotices, catererWrites := notifier.(deliveryContract.CatererFeedNotifier)
	caterer, catererReads := notifier.(interface {
		CatererFeed() deliveryContract.CatererNotificationFeed
	})
	if !catererWrites || !catererReads || caterer.CatererFeed() == nil {
		return deliveryFeedSides{}, fmt.Errorf("notification router does not serve the caterer bell")
	}
	return deliveryFeedSides{
		staff: feed, guardian: guardians.GuardianFeed(), traegerNotices: notices, traeger: traeger.TraegerFeed(),
		catererNotices: catererNotices, caterer: caterer.CatererFeed(),
	}, nil
}
