package application

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
)

func TestAmendmentLetterDoesNotReuseTheApplicationsConclusion(t *testing.T) {
	t.Parallel()
	record := ContractRecord{Concluded: &carecontract.Concluded{Method: carecontract.MethodWithApplication, At: time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)}}
	record.Version.Number = 1
	text := func() string {
		var blocks []string
		for _, block := range contractLetter(record, carecontract.Letterhead{}).Blocks {
			blocks = append(blocks, block.Text)
		}
		return strings.Join(blocks, "\n")
	}
	assert.Contains(t, text(), "Sie müssen ihn nicht unterschreiben.")
	record.Version.Number, record.Version.Status, record.Version.Source = 2, carecontract.VersionRequested, carecontract.SourceBookingChange
	assert.NotContains(t, text(), "Sie müssen ihn nicht unterschreiben.")
	assert.Contains(t, text(), "Bitte unterschreiben Sie diese neue Fassung.")
}
