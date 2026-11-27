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
// Mails say "Sie" (ADR 0328), so a chosen form of address greets the person
// by title and last name: "Liebe Frau Klein", "Lieber Herr Klein". Without a
// choice, or without a last name, the greeting is neutral: "Guten Tag Karin
// Klein", or "Guten Tag" for a person without a name.
func GermanGreeting(salutation, firstName, lastName string) string {
	first, last := strings.TrimSpace(firstName), strings.TrimSpace(lastName)
	if last != "" {
		switch salutation {
		case SalutationMs:
			return "Liebe Frau " + last
		case SalutationMr:
			return "Lieber Herr " + last
		}
	}
	return strings.TrimSpace("Guten Tag " + strings.TrimSpace(first+" "+last))
}
