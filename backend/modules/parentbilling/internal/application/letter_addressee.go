package application

import (
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// Whom a letter speaks to (ADR 0294, #7463). A letter to the family or to
// both parents greets the family and says "ihr"; a letter to another payer
// goes to one person, greets them by name and says "du". Every text moto
// writes into a letter takes its form from here. A Träger's own template
// and payment text keep their wording (#7462).

// letterAddressee is the recipient of a letter as its text speaks to them.
type letterAddressee struct {
	// one is a single person: another payer.
	one bool
	// salutation greets the family or the person by name.
	salutation string
}

// addresseeOf is the addressee of a letter to a recipient of kind.
func addresseeOf(kind, firstName, lastName string) letterAddressee {
	if kind == parentbilling.RecipientPayer {
		return letterAddressee{one: true, salutation: textnorm.GermanGreeting("", firstName, lastName) + ","}
	}
	return letterAddressee{salutation: "Liebe Familie " + strings.TrimSpace(lastName) + ","}
}

// say picks the text for the addressee: family in the ihr-form, one in the
// du-form.
func (a letterAddressee) say(family, one string) string {
	if a.one {
		return one
	}
	return family
}

// documentAddressee is the addressee of a letter of the Elternabrechnung.
func documentAddressee(document parentbilling.BillingDocument) letterAddressee {
	return addresseeOf(document.RecipientKind, document.RecipientFirstName, document.RecipientLastName)
}

// recipientAddressee is the addressee of a monthly letter or a
// Jahresbescheid.
func recipientAddressee(recipient parentbilling.CareRecipient) letterAddressee {
	return addresseeOf(recipient.Kind, recipient.FirstName, recipient.LastName)
}

// voidText says that a Storno or an Aufhebung leaves nothing to pay:
// document is "Diese Rechnung" or "Der Bescheid", what "sie" or "den
// Betrag".
func voidText(to letterAddressee, document, what string) string {
	return document + " gilt nicht mehr. " + to.say("Ihr müsst "+what+" nicht bezahlen. Habt ihr schon bezahlt? Dann meldet euch bitte bei uns.",
		"Du musst "+what+" nicht bezahlen. Hast du schon bezahlt? Dann melde dich bitte bei uns.")
}

// paidMoreText asks whoever paid more already to contact the Träger,
// because moto does not know the payments (#4690).
func paidMoreText(to letterAddressee) string {
	return to.say("Habt ihr schon mehr bezahlt? Dann meldet euch bitte bei uns.", "Hast du schon mehr bezahlt? Dann melde dich bitte bei uns.")
}
