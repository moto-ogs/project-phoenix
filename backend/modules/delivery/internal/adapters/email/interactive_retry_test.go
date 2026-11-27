package email

import (
	"testing"
	"time"

	mailcontract "github.com/moto-ogs/project-phoenix/modules/delivery/mail"

	"github.com/stretchr/testify/assert"
)

func TestInteractiveRetrySetsThePolicyOfAWaitedForMail(t *testing.T) {
	t.Parallel()
	attempts, backoff := mailcontract.InteractiveRetry(nil)
	assert.Equal(t, 3, attempts)
	assert.Equal(t, []time.Duration{time.Second, 5 * time.Second, 15 * time.Second}, backoff)

	backoff[0] = time.Hour
	_, defaults := mailcontract.InteractiveRetry(nil)
	assert.Equal(t, time.Second, defaults[0], "callers cannot change the shared spacing")

	custom := []time.Duration{time.Millisecond}
	_, spacing := mailcontract.InteractiveRetry(custom)
	assert.Equal(t, custom, spacing, "tests replace the spacing")
}
