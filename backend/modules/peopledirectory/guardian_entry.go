package peopledirectory

import (
	"cmp"
	"slices"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// GuardianEntryEdit is one save of the staff form for a child's guardian:
// the profile, this child's link and the full phone list, in one unit of
// work and against the version the guardian list handed out (ADR 0311).
// A nil Profile field and a nil Link field keep the stored value; nil Phones
// keeps the phone list.
type GuardianEntryEdit struct {
	StudentID         int64
	GuardianProfileID int64
	ExpectedVersion   string
	Profile           GuardianProfileEdit
	Link              GuardianLinkUpdate
	Phones            *[]GuardianPhoneEdit
}

// GuardianProfileEdit changes the profile fields that are not nil.
type GuardianProfileEdit struct {
	FirstName              *string
	LastName               *string
	Email                  *string
	AddressStreet          *string
	AddressCity            *string
	AddressPostalCode      *string
	PreferredContactMethod *string
	LanguagePreference     *string
	Notes                  *string
}

// Apply returns the stored profile with the edited fields replaced.
func (e GuardianProfileEdit) Apply(stored Guardian) GuardianInput {
	input := GuardianInput{
		FirstName: stored.FirstName, LastName: stored.LastName, Email: stored.Email,
		AddressStreet: stored.AddressStreet, AddressCity: stored.AddressCity, AddressPostalCode: stored.AddressPostalCode,
		PreferredContactMethod: stored.PreferredContactMethod, LanguagePreference: stored.LanguagePreference, Notes: stored.Notes,
	}
	if e.FirstName != nil {
		input.FirstName = *e.FirstName
	}
	if e.LastName != nil {
		input.LastName = *e.LastName
	}
	if e.Email != nil {
		input.Email = e.Email
	}
	if e.AddressStreet != nil {
		input.AddressStreet = e.AddressStreet
	}
	if e.AddressCity != nil {
		input.AddressCity = e.AddressCity
	}
	if e.AddressPostalCode != nil {
		input.AddressPostalCode = e.AddressPostalCode
	}
	if e.PreferredContactMethod != nil {
		input.PreferredContactMethod = *e.PreferredContactMethod
	}
	if e.LanguagePreference != nil {
		input.LanguagePreference = *e.LanguagePreference
	}
	if e.Notes != nil {
		input.Notes = e.Notes
	}
	return input
}

// GuardianPhoneEdit is one number of the saved phone list. ID 0 adds it; a
// stored number missing from the list is deleted.
type GuardianPhoneEdit struct {
	ID          int64
	PhoneNumber string
	PhoneType   string
	Label       *string
	IsPrimary   bool
}

// GuardianEntryVersion is the read-state token of what the staff form for a
// child's guardian shows and saves back (ADR 0311): the profile, this
// child's link and the phone list. The guardian list hands it out and
// UpdateGuardianEntry compares it under the profile and link locks, so a
// form opened on an older state cannot put back what a colleague or a parent
// changed since. The payer mark, the portal permissions and the pickup
// weekdays stay out: the form does not write them. An empty and a missing
// text count as the same state.
func GuardianEntryVersion(entry GuardianWithLink) string {
	type phone struct {
		ID      int64  `json:"id"`
		Number  string `json:"number"`
		Type    string `json:"type"`
		Label   string `json:"label,omitempty"`
		Primary bool   `json:"primary,omitempty"`
	}
	type state struct {
		FirstName         string  `json:"first_name"`
		LastName          string  `json:"last_name"`
		Email             string  `json:"email,omitempty"`
		Street            string  `json:"street,omitempty"`
		City              string  `json:"city,omitempty"`
		PostalCode        string  `json:"postal_code,omitempty"`
		ContactMethod     string  `json:"contact_method,omitempty"`
		Language          string  `json:"language,omitempty"`
		Notes             string  `json:"notes,omitempty"`
		Relationship      string  `json:"relationship"`
		Role              string  `json:"role,omitempty"`
		Primary           bool    `json:"primary,omitempty"`
		Emergency         bool    `json:"emergency,omitempty"`
		Pickup            bool    `json:"pickup,omitempty"`
		PickupNotes       string  `json:"pickup_notes,omitempty"`
		EmergencyPriority int     `json:"emergency_priority,omitempty"`
		Phones            []phone `json:"phones"`
	}
	guardian, link := entry.Guardian, entry.Link
	current := state{
		FirstName: guardian.FirstName, LastName: guardian.LastName, Email: text(guardian.Email),
		Street: text(guardian.AddressStreet), City: text(guardian.AddressCity), PostalCode: text(guardian.AddressPostalCode),
		ContactMethod: guardian.PreferredContactMethod, Language: guardian.LanguagePreference, Notes: text(guardian.Notes),
		Relationship: link.RelationshipType, Role: link.GuardianRole, Primary: link.IsPrimary,
		Emergency: link.IsEmergencyContact, Pickup: link.CanPickup, PickupNotes: text(link.PickupNotes),
		EmergencyPriority: link.EmergencyPriority, Phones: make([]phone, 0, len(guardian.PhoneNumbers)),
	}
	for _, p := range guardian.PhoneNumbers {
		current.Phones = append(current.Phones, phone{ID: p.ID, Number: p.PhoneNumber, Type: p.PhoneType, Label: text(p.Label), Primary: p.IsPrimary})
	}
	slices.SortFunc(current.Phones, func(a, b phone) int { return cmp.Compare(a.ID, b.ID) })
	return readstate.Fingerprint(current)
}
