package identityaccess

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The care notice (#7760) speaks every language of the parents portal,
// names the children by first name, the school after a colon (no case
// ending needed) and links the portal login; it carries no account, health
// or contract data.
func TestGuardianCareVisibleMail_SpeaksEveryPortalLanguage(t *testing.T) {
	t.Parallel()
	assert.ElementsMatch(t, slices.Collect(maps.Keys(parentCopies)), slices.Collect(maps.Keys(careVisibleCopies)),
		"the same languages as the parents' other mails")

	for lang, text := range careVisibleCopies {
		for _, children := range [][]string{{" Mia "}, {"Mia", "Ben", "Ida"}} {
			queued, addressed := GuardianCareVisibleMailOf(GuardianCareNotice{
				GuardianProfileID: 7, StudentIDs: []int64{9}, ChildFirstNames: children, SchoolName: "OGS Beispiel", Locale: strings.ToUpper(lang),
				Recipient: GuardianMailRecipient{FirstName: "Eva", LastName: "Muster", Email: " eva@example.test "},
			}, "https://eltern.example.test/")
			require.True(t, addressed, lang)
			assert.Equal(t, "eva@example.test", queued.Recipient, lang)
			mail, err := GuardianCareVisibleMailContent(queued)
			require.NoError(t, err, lang)
			content := mail.Content.(map[string]any)

			assert.Equal(t, "guardian-care-visible.html", mail.Template, lang)
			assert.Contains(t, mail.Subject, "Mia", lang)
			assert.Contains(t, content["Intro"], "Mia", lang)
			if len(children) > 1 {
				assert.Contains(t, mail.Subject, "Mia, Ben "+text.And+" Ida", lang)
			}
			assert.Equal(t, lang, content["Lang"], lang)
			assert.Equal(t, "https://eltern.example.test/login", content["PortalURL"], lang)
			assert.Contains(t, content["Where"], text.CareArea, lang)
			assert.True(t, strings.HasSuffix(content["Ask"].(string), ": OGS Beispiel."), "%s: the school stands after a colon", lang)
			for key, value := range content {
				assert.NotContains(t, fmt.Sprint(value), "%!", "%s %s is formatted", lang, key)
				assert.NotContains(t, fmt.Sprint(value), "eva@example.test", "%s %s does not repeat the address", lang, key)
			}
		}
	}
}

func TestGuardianCareVisibleMail_GermanByDefaultAndPlainWithoutNames(t *testing.T) {
	t.Parallel()
	queued, addressed := GuardianCareVisibleMailOf(GuardianCareNotice{
		ChildFirstNames: []string{"Mia"}, Locale: "xx", Recipient: GuardianMailRecipient{Email: "eva@example.test"},
	}, "")
	require.True(t, addressed)
	mail, err := GuardianCareVisibleMailContent(queued)
	require.NoError(t, err)
	content := mail.Content.(map[string]any)

	assert.Equal(t, "Die Betreuung von Mia ist jetzt im Elternportal sichtbar", mail.Subject)
	assert.Equal(t, "Hallo,", content["Greeting"])
	assert.Equal(t, "Stimmt etwas nicht? Dann wenden Sie sich an Ihre Schule.", content["Ask"])
	assert.Equal(t, "Sie müssen nichts tun. Die Betreuung läuft weiter wie bisher.", content["Nothing"])

	siblings, _ := GuardianCareVisibleMailOf(GuardianCareNotice{
		ChildFirstNames: []string{"Mia", "Ben"}, Recipient: GuardianMailRecipient{Email: "eva@example.test"},
	}, "")
	mail, err = GuardianCareVisibleMailContent(siblings)
	require.NoError(t, err)
	assert.Equal(t, "Die Betreuung von Mia und Ben ist jetzt im Elternportal sichtbar", mail.Subject, "siblings share one mail")

	_, addressed = GuardianCareVisibleMailOf(GuardianCareNotice{ChildFirstNames: []string{"Mia"}}, "")
	assert.False(t, addressed, "no address, no mail")
	_, err = GuardianCareVisibleMailContent(GuardianCareVisibleMail{Recipient: "eva@example.test", PortalURL: "x"})
	assert.Error(t, err, "a mail without a child is refused")
}
