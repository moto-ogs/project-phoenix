package contact

import (
	"errors"
	"slices"
	"strings"
)

var (
	ErrGuardianProfileNotFound = errors.New("guardian profile not found")
	ErrStudentGuardianNotFound = errors.New("student guardian relationship not found")
)

// GuardianRelationshipValues contains only the values normalized by the
// canonical relationship validator. Permission contents are not validated.
type GuardianRelationshipValues struct {
	StudentID          int64
	GuardianProfileID  int64
	RelationshipType   string
	GuardianRole       string
	PermissionsPresent bool
}

var validRelationshipTypes = map[string]bool{"parent": true, "guardian": true, "relative": true, "other": true}

// RelationshipTypes lists the relationship types a guardian link stores.
func RelationshipTypes() []string { return sortedKeys(validRelationshipTypes) }

// contactMethods are the ways a guardian profile prefers to be reached.
var contactMethods = map[string]bool{"email": true, "phone": true, "mobile": true, "sms": true}

// PreferredContactMethods lists the contact methods a guardian profile stores.
func PreferredContactMethods() []string { return sortedKeys(contactMethods) }

// IsPreferredContactMethod reports whether a guardian profile may store value.
func IsPreferredContactMethod(value string) bool { return contactMethods[value] }

func sortedKeys(set map[string]bool) []string {
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}

func IsValidRelationshipType(value string) bool {
	return validRelationshipTypes[strings.ToLower(strings.TrimSpace(value))]
}

// relationshipTypeLabels maps the German and English labels of a guardian's
// relationship to its stored type.
var relationshipTypeLabels = map[string]string{
	// Parent types
	"mutter":     "parent",
	"vater":      "parent",
	"mama":       "parent",
	"papa":       "parent",
	"elternteil": "parent",
	"parent":     "parent",

	// Guardian types
	"vormund":                "guardian",
	"erziehungsberechtigter": "guardian",
	"erziehungsberechtigte":  "guardian",
	"guardian":               "guardian",

	// Relative types
	"großmutter":  "relative",
	"großvater":   "relative",
	"oma":         "relative",
	"opa":         "relative",
	"tante":       "relative",
	"onkel":       "relative",
	"geschwister": "relative",
	"bruder":      "relative",
	"schwester":   "relative",
	"relative":    "relative",

	// Other types
	"sonstige": "other",
	"andere":   "other",
	"other":    "other",
}

// MapRelationshipType converts a German or English relationship label to its
// stored type. An unknown label is "other".
func MapRelationshipType(label string) string {
	if mapped, ok := relationshipTypeLabels[strings.ToLower(strings.TrimSpace(label))]; ok {
		return mapped
	}
	return "other"
}

// NormalizeGuardianRelationship preserves the retained validator's ordering,
// including values normalized before it returns an error.
func NormalizeGuardianRelationship(value *GuardianRelationshipValues) error {
	if value.StudentID <= 0 {
		return errors.New("student ID is required")
	}
	if value.GuardianProfileID <= 0 {
		return errors.New("guardian profile ID is required")
	}
	if value.RelationshipType == "" {
		return errors.New("relationship type is required")
	}
	value.RelationshipType = strings.ToLower(value.RelationshipType)
	if !IsValidRelationshipType(value.RelationshipType) {
		return errors.New("invalid relationship type")
	}
	value.GuardianRole = strings.ToLower(strings.TrimSpace(value.GuardianRole))
	if value.GuardianRole == "" {
		value.GuardianRole = "custom"
	}
	value.PermissionsPresent = true
	return nil
}
