package textnorm

import "strings"

// The forms of address a person may choose for themselves. The empty string
// means no choice: every greeting then stays neutral.
const (
	SalutationMs = "ms"
	SalutationMr = "mr"
)

// ValidSalutation reports whether the value is a known form of address or
// the empty "no choice".
func ValidSalutation(value string) bool {
	return value == "" || value == SalutationMs || value == SalutationMr
}

// GermanGreeting is the opening of a German mail, without the closing comma.
// A chosen form of address picks the gendered word and stays on first-name
// terms: "Liebe Karin", "Lieber Jonas". Without a choice, or without a first
// name, the greeting is neutral: "Guten Tag Karin Klein", or "Guten Tag" for
// a person without a name.
func GermanGreeting(salutation, firstName, lastName string) string {
	first, last := strings.TrimSpace(firstName), strings.TrimSpace(lastName)
	if first != "" {
		switch salutation {
		case SalutationMs:
			return "Liebe " + first
		case SalutationMr:
			return "Lieber " + first
		}
	}
	return strings.TrimSpace("Guten Tag " + strings.TrimSpace(first+" "+last))
}
