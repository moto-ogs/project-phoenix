package owners

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	careContractCompose "github.com/moto-ogs/project-phoenix/modules/carecontract/compose"
	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	email "github.com/moto-ogs/project-phoenix/modules/delivery/mail"
)

func TestContractReminderKeepsItsSignatureScopeThroughDelivery(t *testing.T) {
	t.Parallel()
	for _, amendment := range []bool{false, true} {
		t.Run(fmt.Sprint(amendment), func(t *testing.T) {
			t.Parallel()
			renderer := careContractMailRenderer(careContractCompose.NewContractMailRenderer(), email.NewEmail("moto", "mail@example.org"))
			mail, err := renderer.Render(t.Context(), &deliveryCompose.MailIntent{
				Kind: "care_contract", PayloadJSON: []byte(fmt.Sprintf(`{"purpose":"reminder","amendment":%t,"signing_url":"https://example.org/sign"}`, amendment)),
			})
			require.NoError(t, err)
			content, ok := mail.Content.(map[string]any)
			require.True(t, ok)
			assert.Equal(t, amendment, content["Amendment"])
			assert.Equal(t, "https://example.org/sign", content["SigningURL"])
			if amendment {
				assert.Equal(t, "Erinnerung: Bitte unterschreibe die geänderte Vertragsfassung", mail.Subject)
			} else {
				assert.Equal(t, "Erinnerung: Dein Betreuungsvertrag wartet auf deine Unterschrift", mail.Subject)
			}
		})
	}
}
