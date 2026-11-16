package parentbillinghttp

import (
	"testing"
	"time"

	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
)

func TestMandateStateTextExpiry(t *testing.T) {
	t.Parallel()
	// Berlin has already reached the next day while UTC is still Jan 1.
	today := calendar.DateFromTime(time.Date(2000, time.January, 1, 23, 30, 0, 0, time.UTC))
	revoked := today.AddDays(-2)
	cases := []struct {
		name    string
		mandate capability.SEPAMandate
		want    string
	}{
		{"expired yesterday", capability.SEPAMandate{CreditorCurrent: true, ExpiresOn: today.AddDays(-1)}, "Verfallen"},
		{"expires today in Berlin", capability.SEPAMandate{CreditorCurrent: true, ExpiresOn: today}, "Verfallen"},
		{"expires tomorrow", capability.SEPAMandate{CreditorCurrent: true, ExpiresOn: today.AddDays(1)}, "In Kraft"},
		{"no expiry supplied", capability.SEPAMandate{CreditorCurrent: true}, "In Kraft"},
		{"revocation takes precedence", capability.SEPAMandate{CreditorCurrent: true, ExpiresOn: today, RevokedOn: &revoked}, "Widerrufen seit 31.12.1999"},
		{"creditor change takes precedence", capability.SEPAMandate{ExpiresOn: today}, "Neues Mandat nötig"},
	}
	for _, tc := range cases {
		assert.Equal(t, tc.want, mandateStateText(tc.mandate, today), tc.name)
	}
}
