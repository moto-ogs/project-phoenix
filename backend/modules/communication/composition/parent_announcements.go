package compose

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	deliveryPorts "github.com/moto-ogs/project-phoenix/modules/communication/internal/application"
	records "github.com/moto-ogs/project-phoenix/modules/communication/internal/staffannouncements"
	"github.com/moto-ogs/project-phoenix/modules/communication/ports"
)

// ParentAnnouncementOutbox is the mail outbox of the announcements.
type ParentAnnouncementOutbox interface{ deliveryPorts.MailOutbox }

type ParentAnnouncementPushOutbox interface {
	CancelPendingByRelatedEntity(context.Context, string, int64, string) (int64, error)
}

type ParentAnnouncementConfig struct {
	Repo         deliveryPorts.StaffAnnouncementSource
	Settings     deliveryPorts.Settings
	Outbox       ParentAnnouncementOutbox
	PushOutbox   ParentAnnouncementPushOutbox
	Notifier     func(context.Context, communication.NotificationEvent) error
	Series       communication.NotificationSeries
	Preferences  deliveryPorts.NotificationPreferences
	Deliveries   deliveryPorts.ParentAnnouncementDeliveryRecorder
	Fingerprints deliveryPorts.Fingerprints
	Signatures   communication.DeclarationSignatureReader
	ParentsURL   string
	Logger       *slog.Logger
	SurveyStaff  deliveryPorts.SurveyStaff // with it, the surveys (#4781)
	Letters      ParentLetterPorts
	Now          func() time.Time
}

// ParentLetterPorts are what the personalised letters (#4813) read outside
// Communication: the child values of the owners, the school's logo and the
// data access log. The copies live in Repo. Without them a school still
// sends letters that name nobody.
type ParentLetterPorts struct {
	Sources ports.ParentLetterSources
	Logos   communication.ParentLetterLogos
	Access  communication.ParentLetterAccessLog
}

func (p ParentLetterPorts) bind(repo communication.ParentLetterCopyRecords, now func() time.Time) deliveryPorts.ParentLetters {
	letters := deliveryPorts.ParentLetters{Copies: repo, Logos: p.Logos, Access: p.Access}
	if p.Sources.Students != nil {
		letters.Children = deliveryPorts.NewParentLetterChildren(p.Sources, now)
	}
	return letters
}

type ParentAnnouncementEmailConfig communication.MailRendererConfig

// NewParentAnnouncementsWithAttachments composes the announcements over the
// file side File Storage builds before its attachment routes over them
// (#4080). A missing file side is a construction error.
func NewParentAnnouncementsWithAttachments(cfg ParentAnnouncementConfig, attachments communication.ParentAnnouncementAttachmentPurger, runtime deliveryPorts.Runtime, policy deliveryPorts.ParentDeliveryPolicy) (communication.ParentAnnouncementCapability, error) {
	if attachments == nil {
		return nil, errors.New("parent announcements compose: the attachment purger is required")
	}
	var deliveries deliveryPorts.DeliveryRecorder
	if cfg.Deliveries != nil {
		deliveries = deliveryPorts.NewParentAnnouncementDeliveryAdapter(cfg.Deliveries)
	}
	return deliveryPorts.WithSurveys(deliveryPorts.NewParentAnnouncementFacade(deliveryPorts.NewService(deliveryPorts.ServiceConfig{
		Repo: records.NewRepository(cfg.Repo), Settings: cfg.Settings, Outbox: cfg.Outbox, PushOutbox: cfg.PushOutbox, Notifier: deliveryPorts.NewNotificationSender(cfg.Notifier),
		Series: cfg.Series, Preferences: cfg.Preferences, Deliveries: deliveries,
		ParentsURL: cfg.ParentsURL, Logger: cfg.Logger, Fingerprints: cfg.Fingerprints, Signatures: cfg.Signatures, Attachments: attachments, Now: cfg.Now,
		Letters: cfg.Letters.bind(cfg.Repo, cfg.Now),
	}, runtime, policy)), cfg.Repo, cfg.SurveyStaff)
}

func NewParentAnnouncementRenderer(cfg ParentAnnouncementEmailConfig) communication.MailRenderer {
	return communication.MailRenderer(deliveryPorts.NewAnnouncementRenderer(deliveryPorts.EmailConfig(cfg)))
}
