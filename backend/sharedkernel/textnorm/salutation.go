package textnorm

import "strings"

// The forms of address a person may choose for themselves. The empty string
// means no choice: every greeting then keeps first and last name.
const (
	SalutationMs = "ms"
	SalutationMr = "mr"
)

// ValidSalutation reports whether the value is a known form of address or
// the empty "no choice".
func ValidSalutation(value string) bool {
	return value == "" || value == SalutationMs || value == SalutationMr
}

// GermanFormalName is how a German greeting names the person: "Frau Klein"
// or "Herr Klein" with a chosen form of address and a last name, else first
// and last name. It is empty when the person has no name.
func GermanFormalName(salutation, firstName, lastName string) string {
	first, last := strings.TrimSpace(firstName), strings.TrimSpace(lastName)
	if last != "" {
		switch salutation {
		case SalutationMs:
			return "Frau " + last
		case SalutationMr:
			return "Herr " + last
		}
	}
	return strings.TrimSpace(first + " " + last)
}
