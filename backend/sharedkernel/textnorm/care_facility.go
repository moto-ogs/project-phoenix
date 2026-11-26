package textnorm

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// The grammatical articles a school may choose for its own care name
// (enrollment.care_facility_article, #8136).
const (
	CareArticleDer = "der"
	CareArticleDie = "die"
	CareArticleDas = "das"
)

// CareArticle is the article the fixed German texts use for a care name.
// The preset names "OGS" and "GTS" are feminine whatever was stored, so a
// school that returns from an own name to a preset reads "die OGS" again.
// An empty or unknown value is "die" as well: mails queued before the
// article existed and schools that never chose one keep their wording.
func CareArticle(term, stored string) string {
	switch strings.TrimSpace(term) {
	case "", "OGS", "GTS":
		return CareArticleDie
	}
	switch stored {
	case CareArticleDer, CareArticleDas:
		return stored
	default:
		return CareArticleDie
	}
}

// CareFacilityName declines a school's care name in the fixed German texts:
// "die OGS", "der Hort", "das Lernhaus". The name itself is never inflected,
// so no text needs a genitive ("des Horts"); "von der OGS" / "vom Hort"
// stands in for it.
type CareFacilityName struct {
	term    string
	article string
}

// NewCareFacilityName binds a name to its article; see CareArticle for the
// article of presets and of missing values. An empty term is "OGS".
func NewCareFacilityName(term, storedArticle string) CareFacilityName {
	term = strings.TrimSpace(term)
	article := CareArticle(term, storedArticle)
	if term == "" {
		term = "OGS"
	}
	return CareFacilityName{term: term, article: article}
}

// Term is the bare name, "Hort".
func (n CareFacilityName) Term() string { return n.term }

// Nominative is the subject of a sentence: "die OGS", "der Hort", "das
// Lernhaus".
func (n CareFacilityName) Nominative() string {
	return n.article + " " + n.term
}

// From is the sender: "von der OGS", "vom Hort", "vom Lernhaus".
func (n CareFacilityName) From() string {
	if n.article == CareArticleDie {
		return "von der " + n.term
	}
	return "vom " + n.term
}

// Your is the reader's own care as a subject or a heading: "deine OGS",
// "dein Hort", "dein Lernhaus".
func (n CareFacilityName) Your() string {
	if n.article == CareArticleDie {
		return "deine " + n.term
	}
	return "dein " + n.term
}

// SentenceStart capitalises the first letter of a phrase: "Die OGS".
func SentenceStart(phrase string) string {
	first, size := utf8.DecodeRuneInString(phrase)
	if size == 0 {
		return phrase
	}
	return string(unicode.ToUpper(first)) + phrase[size:]
}
