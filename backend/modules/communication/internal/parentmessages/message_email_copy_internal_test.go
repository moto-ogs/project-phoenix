// The OGS-message e-mail is the one mail that speaks the guardian's portal
// language (#1540, #3202). Every registered locale must answer with its own
// wording; a locale branch that silently returns another language's copy is
// the slip a spot-check misses.
package messaging

import (
	"strings"
	"testing"

	deliveryPolicy "github.com/moto-ogs/project-phoenix/modules/delivery/devices"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
	"github.com/stretchr/testify/assert"
)

var parentEmailLocales = []string{"de", "en", "ru", "sq", "pl", "tr", "uk"}

func assertDistinctEmailField(t *testing.T, field string, got map[string]string) {
	t.Helper()
	seen := make(map[string]string, len(got))
	for locale, text := range got {
		assert.NotEmpty(t, text, "locale %s has no %s", locale, field)
		if other, clash := seen[text]; clash {
			t.Errorf("locale %s reuses the %s of %s: %q", locale, field, other, text)
		}
		seen[text] = locale
	}
}

func TestMessageEmailCopyCoversEveryLocale(t *testing.T) {
	t.Parallel()

	fields := map[string]func(parentMessageEmailCopy) string{
		"Subject":            func(c parentMessageEmailCopy) string { return c.Subject },
		"Kicker":             func(c parentMessageEmailCopy) string { return c.Kicker },
		"Greeting":           func(c parentMessageEmailCopy) string { return c.Greeting },
		"Intro":              func(c parentMessageEmailCopy) string { return c.Intro },
		"Reply":              func(c parentMessageEmailCopy) string { return c.Reply },
		"FallbackHint":       func(c parentMessageEmailCopy) string { return c.FallbackHint },
		"PreferenceHint":     func(c parentMessageEmailCopy) string { return c.PreferenceHint },
		"FooterText":         func(c parentMessageEmailCopy) string { return c.FooterText },
		"PoweredByLabel":     func(c parentMessageEmailCopy) string { return c.PoweredByLabel },
		"SchoolLogoAlt":      func(c parentMessageEmailCopy) string { return c.SchoolLogoAlt },
		"DefaultBrandKicker": func(c parentMessageEmailCopy) string { return c.DefaultBrandKicker },
		"DefaultSchoolName":  func(c parentMessageEmailCopy) string { return c.DefaultSchoolName },
	}
	for field, pick := range fields {
		got := map[string]string{}
		for _, locale := range parentEmailLocales {
			got[locale] = pick(messageEmailCopy(locale, "", "Anna", "Nowak", "Grundschule Musterstadt", "", textnorm.NewCareFacilityName("OGS", ""), deliveryPolicy.ParentDeliveryPolicy{}))
		}
		assertDistinctEmailField(t, field, got)
	}
}

func TestMessageEmailCopyWithoutSchoolUsesNeutralFooter(t *testing.T) {
	t.Parallel()

	for _, locale := range parentEmailLocales {
		copy := messageEmailCopy(locale, "", "", "", "", "", textnorm.NewCareFacilityName("OGS", ""), deliveryPolicy.ParentDeliveryPolicy{})
		assert.NotEmpty(t, copy.FooterText, "locale %s", locale)
		assert.NotEmpty(t, copy.Greeting, "locale %s", locale)
		assert.NotContains(t, copy.Intro, "  ", "locale %s intro has a double space without a school", locale)
	}
}

func TestMessageEmailCopyFallsBackToGerman(t *testing.T) {
	t.Parallel()

	assert.Equal(t, messageEmailCopy("de", "", "", "", "", "", textnorm.NewCareFacilityName("OGS", ""), deliveryPolicy.ParentDeliveryPolicy{}), messageEmailCopy("fr", "", "", "", "", "", textnorm.NewCareFacilityName("OGS", ""), deliveryPolicy.ParentDeliveryPolicy{}))
}

// A school that calls its care GTS (#6082) reads GTS in subject, intro and
// the name stand-in of every language, and no OGS.
func TestMessageEmailCopyNamesTheSchoolsCareTerm(t *testing.T) {
	t.Parallel()

	for _, locale := range parentEmailLocales {
		copy := messageEmailCopy(locale, "", "Anna", "Nowak", "", "", textnorm.NewCareFacilityName("GTS", ""), deliveryPolicy.ParentDeliveryPolicy{})
		for field, text := range map[string]string{"Subject": copy.Subject, "Intro": copy.Intro, "DefaultSchoolName": copy.DefaultSchoolName} {
			assert.Contains(t, text, "GTS", "locale %s %s", locale, field)
			assert.NotContains(t, text, "OGS", "locale %s %s", locale, field)
		}
	}
}

// A school with its own name chooses the article (#8136): the German mail
// declines it, and the other languages keep the bare name.
func TestMessageEmailCopyDeclinesTheSchoolsOwnCareName(t *testing.T) {
	t.Parallel()

	german := func(term, article string) parentMessageEmailCopy {
		return messageEmailCopy("de", "", "Anna", "Nowak", "", "", textnorm.NewCareFacilityName(term, article), deliveryPolicy.ParentDeliveryPolicy{})
	}
	cases := []struct{ term, article, subject, intro, standIn string }{
		{"Betreuung", "die", "Neue Nachricht von der Betreuung", "Die Betreuung ", "Ihre Betreuung"},
		{"Hort", "der", "Neue Nachricht vom Hort", "Der Hort ", "Ihr Hort"},
		{"Lernhaus", "das", "Neue Nachricht vom Lernhaus", "Das Lernhaus ", "Ihr Lernhaus"},
		{"Ganztag", "", "Neue Nachricht von der Ganztag", "Die Ganztag ", "Ihre Ganztag"},
		{"OGS", "der", "Neue Nachricht von der OGS", "Die OGS ", "Ihre OGS"},
	}
	for _, tc := range cases {
		copy := german(tc.term, tc.article)
		assert.Equal(t, tc.subject, copy.Subject)
		assert.True(t, strings.HasPrefix(copy.Intro, tc.intro), "%q starts with %q", copy.Intro, tc.intro)
		assert.Contains(t, copy.Intro, "hat Ihnen eine Nachricht geschrieben")
		assert.Equal(t, tc.standIn, copy.DefaultSchoolName)
	}

	english := messageEmailCopy("en", "", "Anna", "Nowak", "", "", textnorm.NewCareFacilityName("Hort", "der"), deliveryPolicy.ParentDeliveryPolicy{})
	assert.Contains(t, english.Subject, "Hort")
	assert.NotContains(t, english.Subject, "der Hort")
	assert.NotContains(t, english.Subject, "vom")
}

// The chosen form of address (#7362) is a German convention: other languages
// stay neutral with first and last name, and so does German without a choice.
func TestMessageEmailCopyGreetsWithTheChosenSalutation(t *testing.T) {
	t.Parallel()

	greeting := func(locale, salutation string) string {
		return messageEmailCopy(locale, salutation, "Anna", "Nowak", "", "", textnorm.NewCareFacilityName("OGS", ""), deliveryPolicy.ParentDeliveryPolicy{}).Greeting
	}
	assert.Equal(t, "Liebe Frau Nowak,", greeting("de", "ms"))
	assert.Equal(t, "Lieber Herr Nowak,", greeting("de", "mr"))
	assert.Equal(t, "Guten Tag Anna Nowak,", greeting("de", ""))
	assert.Equal(t, "Hello Anna Nowak,", greeting("en", "ms"))
}
