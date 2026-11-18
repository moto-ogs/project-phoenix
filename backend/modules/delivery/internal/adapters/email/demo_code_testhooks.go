//go:build testhooks

package email

import "github.com/moto-ogs/project-phoenix/modules/delivery/mail"

// WithDemoCodeInboxForTests redirects only this transport's internal code
// delivery to the test's private listener. Production keeps the sidecar address.
func WithDemoCodeInboxForTests(mailer mail.Mailer, address string) mail.Mailer {
	demo := mailer.(demoRestrictedMailer)
	demo.codeAddress = address
	return demo
}
