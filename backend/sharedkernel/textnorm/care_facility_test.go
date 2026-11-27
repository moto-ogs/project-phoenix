package textnorm

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// #8136: a school with its own care name chooses the article, and every
// fixed German text declines it.
func TestCareFacilityNameDeclinesEveryGender(t *testing.T) {
	t.Parallel()

	cases := []struct {
		term, stored                        string
		article, nominative, from, yourCare string
	}{
		{"Betreuung", CareArticleDie, "die", "die Betreuung", "von der Betreuung", "Ihre Betreuung"},
		{"Hort", CareArticleDer, "der", "der Hort", "vom Hort", "Ihr Hort"},
		{"Hort am Markt", CareArticleDer, "der", "der Hort am Markt", "vom Hort am Markt", "Ihr Hort am Markt"},
		{"Lernhaus", CareArticleDas, "das", "das Lernhaus", "vom Lernhaus", "Ihr Lernhaus"},
	}
	for _, tc := range cases {
		name := NewCareFacilityName(tc.term, tc.stored)
		assert.Equal(t, tc.term, name.Term())
		assert.Equal(t, tc.article, CareArticle(tc.term, tc.stored), tc.term)
		assert.Equal(t, tc.nominative, name.Nominative(), tc.term)
		assert.Equal(t, tc.from, name.From(), tc.term)
		assert.Equal(t, tc.yourCare, name.Your(), tc.term)
	}
}

// Schools that never chose an article, mails queued before it existed and
// the feminine presets all keep "die".
func TestCareArticleKeepsDieWithoutAChoice(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "die", CareArticle("Betreuung", ""))
	assert.Equal(t, "die", CareArticle("Betreuung", "den"))
	assert.Equal(t, "die", CareArticle("Betreuung", "Der"))
	assert.Equal(t, "die", CareArticle("OGS", CareArticleDer))
	assert.Equal(t, "die", CareArticle("GTS", CareArticleDas))
	assert.Equal(t, "die", CareArticle(" OGS ", CareArticleDer))
	assert.Equal(t, "die", CareArticle("", CareArticleDer))
	assert.Equal(t, "der", CareArticle("Hort", CareArticleDer))
	assert.Equal(t, "das", CareArticle("Lernhaus", CareArticleDas))

	fallback := NewCareFacilityName("  ", CareArticleDer)
	assert.Equal(t, "OGS", fallback.Term())
	assert.Equal(t, "die OGS", fallback.Nominative())
	assert.Equal(t, "von der OGS", fallback.From())
	assert.Equal(t, "Ihre OGS", fallback.Your())
}

func TestSentenceStart(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "Die OGS", SentenceStart("die OGS"))
	assert.Equal(t, "Der Hort", SentenceStart("der Hort"))
	assert.Equal(t, "Übermittag", SentenceStart("übermittag"))
	assert.Equal(t, "", SentenceStart(""))
}
