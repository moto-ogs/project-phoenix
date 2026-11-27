package owners

import (
	"context"
	"strings"
	"time"

	"github.com/spf13/viper"

	email "github.com/moto-ogs/project-phoenix/modules/delivery/mail"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
)

// demoContact receives the lead mail and the prospects' answers.
var demoContact = email.NewEmail(identityaccess.DemoContactName, identityaccess.DemoContactAddress)

// DemoAccessWiring configures the demo access; nil composes the module
// without it, as every environment but APP_ENV=demo does.
type DemoAccessWiring struct {
	CRMEnabled  bool
	CRMToken    string
	Durable     DurableMailOutbox
	DefaultFrom email.Email
	FrontendURL string
	// Backoff spaces the send retries; nil uses the production spacing.
	Backoff []time.Duration
	// MaxActiveSchools caps the demo schools that may exist at once (#3466).
	MaxActiveSchools int
	// OperatorWithoutSecondFactor is set for APP_ENV=demo only (#3460).
	OperatorWithoutSecondFactor bool
	// NewToken mints the opaque capability token of a demo access link and
	// fingerprint fingerprints a presented one.
	NewToken    func() (raw, fingerprint string, err error)
	Fingerprint func(raw string) string
}

// demoAccessWiringFor composes the demo access for APP_ENV=demo only.
func demoAccessWiringFor(appEnv string, defaultFrom email.Email, frontendURL string, maxActiveSchools int, tokens TokenAdapter, durable DurableMailOutbox) *DemoAccessWiring {
	if !email.IsDemoEnvironment(appEnv) {
		return nil
	}
	token := strings.TrimSpace(viper.GetString("hubspot_demo_token"))
	return &DemoAccessWiring{
		CRMEnabled: token != "", CRMToken: token,
		Durable: durable, DefaultFrom: defaultFrom, FrontendURL: frontendURL, MaxActiveSchools: maxActiveSchools,
		OperatorWithoutSecondFactor: identityaccess.DemoOperatorWithoutSecondFactor,
		NewToken:                    tokens.NewCapabilityToken, Fingerprint: tokens.CapabilityFingerprint,
	}
}

type demoAccessMail struct {
	durable DurableMailOutbox
	from    email.Email
	origin  string
	backoff []time.Duration
}

func newDemoAccessMail(wiring *DemoAccessWiring) demoAccessMail {
	return demoAccessMail{
		durable: wiring.Durable, from: wiring.DefaultFrom, backoff: wiring.Backoff,
		origin: wiring.FrontendURL,
	}
}

func (m demoAccessMail) SendDemoAccessLink(ctx context.Context, access identityaccess.DemoAccessMessage, entryURL string) error {
	message := *identityMessage(m.from, email.NewEmail("", access.Email), identityaccess.DemoAccessLinkMail(entryURL, m.origin))
	message.ReplyTo = demoContact
	return m.enqueue(ctx, "demo_access", access.AccessID, message, access.ExpiresAt)
}

func (m demoAccessMail) SendDemoLead(ctx context.Context, access identityaccess.DemoAccessMessage) error {
	message := *identityMessage(m.from, demoContact, identityaccess.DemoLeadMail(access, m.origin))
	message.ReplyTo = email.NewEmail(access.PersonName(), access.Email)
	return m.enqueue(ctx, "demo_lead", access.AccessID, message, time.Time{})
}

func (m demoAccessMail) enqueue(ctx context.Context, kind string, accessID int64, message email.Message, expiry time.Time) error {
	return enqueueDurableMail(ctx, m.durable, DurableMail{
		Message: message, Type: kind, ReferenceID: accessID, Backoff: m.backoff, ExpiresAt: expiry,
	})
}
