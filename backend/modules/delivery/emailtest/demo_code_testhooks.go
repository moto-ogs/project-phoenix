//go:build testhooks

package emailtest

import (
	transport "github.com/moto-ogs/project-phoenix/modules/delivery/internal/adapters/email"
	"github.com/moto-ogs/project-phoenix/modules/delivery/mail"
)

// InDemoEnvironmentWithCodeInbox gives the capture a private delivery-only inbox,
// preserving the demo mail restriction and the real code-delivery protocol.
func (m *CapturingMailer) InDemoEnvironmentWithCodeInbox(address string) mail.Mailer {
	return transport.WithDemoCodeInboxForTests(m.InDemoEnvironment(), address)
}
