package application

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The parents' own request as the signature of a changed version (#4816).
// Module 7 is the Ganztag, module 8 the late care; the contract's party is
// the account 41 with the address erika@example.org.

const (
	consentGanztag  int64 = 7
	consentLateCare int64 = 8
	consentParty    int64 = 41
)

func consentRead() schoolRead {
	return schoolRead{offerings: map[int64]carecontract.Offering{
		consentGanztag:  {ID: consentGanztag, Name: "Ganztag"},
		consentLateCare: {ID: consentLateCare, Name: "Spätbetreuung"},
	}}
}

func consentDay(text string) *calendar.Date {
	day := calendar.Date(text)
	return &day
}

func consentRequest(account int64, from string, offerings ...carecontract.RequestedOffering) carecontract.ParentRequest {
	return carecontract.ParentRequest{ID: 5, AccountID: account, AccountEmail: "erika@example.org", EffectiveFrom: calendar.Date(from),
		SubmittedAt: time.Date(2027, 9, 1, 9, 0, 0, 0, time.UTC), Offerings: offerings}
}

func consentContract(party ports.PartyAccount) AmendableContract {
	return AmendableContract{Parties: []ports.PartyAccount{party}, Versions: []carecontract.Version{
		{ID: ident.ID(1), Number: 1, Status: carecontract.VersionEffective, EffectiveFrom: "2027-08-01"},
	}}
}

func TestParentConsentNeedsAPartyAndExactlyTheBookedCare(t *testing.T) {
	t.Parallel()
	account := consentParty
	byAccount := ports.PartyAccount{AccountID: &account, Name: "Erika Muster"}
	byAddress := ports.PartyAccount{Email: "Erika@Example.org", Name: "Erika Muster"}
	ganztag := carecontract.RequestedOffering{CareOfferingID: consentGanztag, Days: []string{"mon", "tue"}}
	lateCare := carecontract.RequestedOffering{CareOfferingID: consentLateCare, Days: []string{"thu"}}
	// From 1 October the child books the Ganztag on Monday and Tuesday
	// instead of Monday to Wednesday.
	october := []carecontract.Booking{
		{CareOfferingID: consentGanztag, Days: []string{"mon", "tue", "wed"}, ValidFrom: consentDay("2027-08-01"), ValidUntil: consentDay("2027-10-01")},
		{CareOfferingID: consentGanztag, Days: []string{"mon", "tue"}, ValidFrom: consentDay("2027-10-01")},
	}
	onTime := change2("2027-10-01", "2027-10-01")
	for name, c := range map[string]struct {
		party    ports.PartyAccount
		request  carecontract.ParentRequest
		bookings []carecontract.Booking
		change   change
		signs    bool
	}{
		"the party asked for exactly the booked care":        {party: byAccount, request: consentRequest(consentParty, "2027-10-01", ganztag), bookings: october, change: onTime, signs: true},
		"a party without an account is known by its address": {party: byAddress, request: consentRequest(99, "2027-10-01", ganztag), bookings: october, change: onTime, signs: true},
		"another account than the party's":                   {party: byAccount, request: consentRequest(99, "2027-10-01", ganztag), bookings: october, change: onTime},
		"a request for another day":                          {party: byAccount, request: consentRequest(consentParty, "2027-11-01", ganztag), bookings: october, change: onTime},
		"other weekdays than asked for": {party: byAccount, bookings: october, change: onTime,
			request: consentRequest(consentParty, "2027-10-01", carecontract.RequestedOffering{CareOfferingID: consentGanztag, Days: []string{"mon"}})},
		// Another approval took the late care away again: the request for
		// both modules does not prove the Ganztag alone.
		"a module of the request is not booked": {party: byAccount, request: consentRequest(consentParty, "2027-10-01", ganztag, lateCare), bookings: october, change: onTime},
		// The change holds from today, 4 October, and is grouped with the
		// day the contract started: only the booking of 1 October changed.
		"an overdue change with the start of the version in force": {party: byAccount, request: consentRequest(consentParty, "2027-10-01", ganztag), bookings: october,
			change: change2("2027-10-04", "2027-08-01", "2027-10-01"), signs: true},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			application := carecontract.Application{Bookings: c.bookings, ParentRequests: []carecontract.ParentRequest{c.request}}
			consent := parentConsent(consentRead(), application, consentContract(c.party), c.change)
			if !c.signs {
				assert.Nil(t, consent)
				return
			}
			require.NotNil(t, consent)
			assert.Equal(t, c.request.ID, consent.request.ID)
		})
	}
}

// A request signs once. The parents asked for the care, later agreed to
// something else, and the school books the first care again: their old
// request no longer says what they want, the new version waits.
func TestARequestThatAlreadySignedAVersionSignsNoSecondOne(t *testing.T) {
	t.Parallel()
	account := consentParty
	request := consentRequest(consentParty, "2027-10-01", carecontract.RequestedOffering{CareOfferingID: consentGanztag, Days: []string{"mon", "tue"}})
	application := carecontract.Application{ParentRequests: []carecontract.ParentRequest{request}, Bookings: []carecontract.Booking{
		{CareOfferingID: consentGanztag, Days: []string{"mon", "tue", "wed"}, ValidFrom: consentDay("2027-08-01"), ValidUntil: consentDay("2027-10-01")},
		{CareOfferingID: consentGanztag, Days: []string{"mon", "tue"}, ValidFrom: consentDay("2027-10-01")},
	}}
	contract := consentContract(ports.PartyAccount{AccountID: &account, Name: "Erika Muster"})
	require.NotNil(t, parentConsent(consentRead(), application, contract, change2("2027-10-01", "2027-10-01")))

	contract.SignedRequests = []int64{request.ID}

	assert.Nil(t, parentConsent(consentRead(), application, contract, change2("2027-10-01", "2027-10-01")))
}

func change2(day string, origins ...calendar.Date) change {
	return change{day: calendar.Date(day), origins: origins}
}

// A waiting version that promises care longer than booked now is replaced,
// never signed: the end of the contract and of each module count. A booking
// the school's correction split into two rows is the same promise.
func TestWaitingVersionIsCarriedOnlyWhileItsPromiseIsBooked(t *testing.T) {
	t.Parallel()
	june, january := calendar.NewDate(2028, 6, 30), calendar.NewDate(2028, 1, 31)
	services := []carecontract.Service{
		{Weekday: "mon", CareOfferingID: ident.ID(consentGanztag), EndsAt: "16:00"},
		{Weekday: "thu", CareOfferingID: ident.ID(consentLateCare), EndsAt: "17:00", LastDay: &january},
	}
	waiting := carecontract.Version{EffectiveFrom: "2027-10-01", EndsOn: &june, Services: services}
	today := calendar.NewDate(2027, 9, 1)
	booking := func(offering int64, day, from, until string) carecontract.Booking {
		return carecontract.Booking{CareOfferingID: offering, Days: []string{day}, ValidFrom: consentDay(from), ValidUntil: consentDay(until)}
	}
	ganztag := booking(consentGanztag, "mon", "2027-08-01", "2028-07-01")
	for name, c := range map[string]struct {
		bookings   []carecontract.Booking
		plannedEnd *calendar.Date
		carried    bool
	}{
		"booked as promised": {bookings: []carecontract.Booking{ganztag, booking(consentLateCare, "thu", "2027-10-01", "2028-02-01")}, plannedEnd: &june, carried: true},
		"a booking split in two rows is the same promise": {bookings: []carecontract.Booking{ganztag,
			booking(consentLateCare, "thu", "2027-10-01", "2027-11-08"), booking(consentLateCare, "thu", "2027-11-08", "2028-02-01")}, plannedEnd: &june, carried: true},
		"one module ends earlier than promised":   {bookings: []carecontract.Booking{ganztag, booking(consentLateCare, "thu", "2027-10-01", "2027-12-01")}, plannedEnd: &june},
		"the contract ends earlier than promised": {bookings: []carecontract.Booking{ganztag, booking(consentLateCare, "thu", "2027-10-01", "2028-02-01")}, plannedEnd: &january},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			planned := waiting
			planned.EndsOn = c.plannedEnd
			assert.Equal(t, c.carried, waitingCarries(consentRead(), c.bookings, &waiting, planned, today))
		})
	}
}
