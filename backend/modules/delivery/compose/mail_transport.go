package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/adapters/email"
	"github.com/moto-ogs/project-phoenix/modules/delivery/mail"
)

func NewMailTransport(config mail.MailerConfig) (mail.Mailer, error) { return email.NewMailer(config) }
func IsLoggingMailTransport(mailer mail.Mailer) bool                 { return email.IsLoggingMailTransport(mailer) }
