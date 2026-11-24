package domain

import (
	"regexp"

	"github.com/moto-ogs/project-phoenix/sharedkernel/sepa"
)

// Checks of the Schulträger and the Gemeinde of a school (#4811).

// TraegerAuditSubjectSchoolParty is the Schulträger or the Gemeinde of a
// school in the master data log; SubjectID names its row.
const TraegerAuditSubjectSchoolParty = "school_party"

var postalCodePattern = regexp.MustCompile(`^[0-9]{5}$`)

// ValidPostalCode reports whether a trimmed postal code is a German one.
func ValidPostalCode(code string) bool { return postalCodePattern.MatchString(code) }

// ValidCreditorID reports whether a compacted SEPA creditor identifier is
// one, by the rule of the shared kernel the Elternabrechnung checks the
// Träger's own with (#4695).
func ValidCreditorID(id string) bool { return sepa.ValidCreditorID(id) }
