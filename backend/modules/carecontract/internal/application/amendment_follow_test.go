package application

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func TestGeneratedAmendmentCarriesContinuousBookings(t *testing.T) {
	t.Parallel()
	for name, end := range map[string]*calendar.Date{"open ended": nil, "finite": date(2031, 2, 1)} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			application := carecontract.Application{Bookings: []carecontract.Booking{
				{CareOfferingID: 1, Days: []string{"mon"}, ValidFrom: date(2030, 8, 1)},
				{CareOfferingID: 2, Days: []string{"thu"}, ValidFrom: date(2030, 10, 1), ValidUntil: date(2030, 12, 1)},
				{CareOfferingID: 2, Days: []string{"thu"}, ValidFrom: date(2030, 12, 1), ValidUntil: end},
			}}
			today := *date(2030, 9, 1)
			plan, reason := nextAmendment(amendmentRead(), application, amendable(), today)
			require.Empty(t, reason)
			require.NotNil(t, plan)
			require.Len(t, plan.version.Services, 2)
			assert.Equal(t, lastDay(end), plan.version.Services[1].LastDay)
			assert.True(t, waitingCarries(amendmentRead(), application.Bookings, &plan.version, plan.version, today),
				"the generated version survives the next reconciliation")
			_, changed := sentVersionNow(amendmentRead(), application,
				SentContract{Version: plan.version, NextNumber: 3}, plan.version.EffectiveFrom)
			assert.False(t, changed, "an unsigned first contract survives the next reconciliation too")
			application.Bookings = application.Bookings[1:]
			assert.Equal(t, end, bookedCare(amendmentRead(), application, today).until,
				"the whole contract follows the chain when it is the only module")
		})
	}
}

func TestBookedCareFollowsOnlyContiguousWeekdays(t *testing.T) {
	t.Parallel()
	read := amendmentRead()
	application := carecontract.Application{Bookings: []carecontract.Booking{
		{CareOfferingID: 2, Days: []string{"thu", "fri"}, ValidFrom: date(2030, 10, 1), ValidUntil: date(2030, 12, 1)},
		{CareOfferingID: 2, Days: []string{"fri"}, ValidFrom: date(2030, 12, 1), ValidUntil: date(2031, 2, 1)},
		{CareOfferingID: 2, Days: []string{"thu", "fri"}, ValidFrom: date(2031, 2, 2)},
	}}
	booked := bookedCare(read, application, *date(2030, 10, 1))
	require.Len(t, booked.services, 2)
	assert.Equal(t, date(2030, 11, 30), booked.services[0].LastDay, "Thursday stops at the weekday change")
	assert.Equal(t, date(2031, 1, 31), booked.services[1].LastDay, "Friday stops at the gap")
	assert.Equal(t, date(2031, 2, 1), booked.until)
	offering := read.offerings[2]
	offering.ServiceEnd = date(2031, 1, 15)
	read.offerings[2] = offering
	booked = bookedCare(read, application, *date(2030, 10, 1))
	assert.Equal(t, date(2031, 1, 15), booked.services[1].LastDay, "the phase still bounds every continuation")
	assert.Equal(t, date(2031, 1, 16), booked.until)
}

func TestSentContractFollowsAChangedStartWithUnchangedCare(t *testing.T) {
	t.Parallel()
	for name, from := range map[string]*calendar.Date{"later": date(2030, 9, 1), "earlier": date(2030, 7, 1)} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			contract := amendable()
			application := carecontract.Application{Bookings: []carecontract.Booking{
				{CareOfferingID: 1, Days: []string{"mon"}, ValidFrom: from},
			}}
			sent := SentContract{Version: contract.Latest, NextNumber: 2}
			version, changed := sentVersionNow(amendmentRead(), application, sent, *date(2030, 6, 1))
			require.True(t, changed, "the old PDF promises a different first day")
			assert.Equal(t, *from, version.EffectiveFrom)
			assert.Equal(t, 2, version.Number)
			assert.Nil(t, version.EndsOn)
			sent.Version = version
			_, changed = sentVersionNow(amendmentRead(), application, sent, *date(2030, 6, 1))
			assert.False(t, changed)
		})
	}
}

func TestExtendedContractKeepsTheCarriedModulesOriginalEnd(t *testing.T) {
	t.Parallel()
	contract := amendable()
	contract.Latest.EndsOn = date(2031, 1, 31)
	contract.Versions = []carecontract.Version{contract.Latest}
	application := carecontract.Application{Bookings: []carecontract.Booking{
		{CareOfferingID: 1, Days: []string{"mon"}, ValidFrom: date(2030, 8, 1), ValidUntil: date(2031, 2, 1)},
		{CareOfferingID: 2, Days: []string{"thu"}, ValidFrom: date(2030, 10, 1), ValidUntil: date(2031, 7, 1)},
	}}
	today := *date(2030, 9, 1)
	plan, reason := nextAmendment(amendmentRead(), application, contract, today)
	require.Empty(t, reason)
	require.NotNil(t, plan)
	require.Len(t, plan.version.Services, 2)
	assert.Equal(t, date(2031, 6, 30), plan.version.EndsOn)
	assert.Equal(t, date(2031, 1, 31), plan.version.Services[0].LastDay)
	assert.True(t, waitingCarries(amendmentRead(), application.Bookings, &plan.version, plan.version, today))
}

func TestGeneratedAmendmentKeepsCarriedPromisesWithinBookings(t *testing.T) {
	t.Parallel()
	for name, promise := range map[string]*calendar.Date{"open ended": nil, "shorter promise": date(2031, 1, 31)} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			contract := amendable()
			contract.Latest.Services[0].LastDay = promise
			contract.Versions = []carecontract.Version{contract.Latest}
			application := carecontract.Application{Bookings: []carecontract.Booking{
				{CareOfferingID: 1, Days: []string{"mon"}, ValidFrom: date(2030, 8, 1), ValidUntil: date(2031, 2, 1)},
				{CareOfferingID: 1, Days: []string{"mon"}, ValidFrom: date(2031, 2, 1), ValidUntil: date(2031, 7, 1)},
				{CareOfferingID: 2, Days: []string{"thu"}, ValidFrom: date(2030, 10, 1)},
			}}
			today := *date(2030, 9, 1)
			plan, reason := nextAmendment(amendmentRead(), application, contract, today)
			require.Empty(t, reason)
			require.NotNil(t, plan)
			require.Len(t, plan.version.Services, 2)
			assert.Nil(t, plan.version.EndsOn, "the new module continues indefinitely")
			assert.Equal(t, earlier(promise, date(2031, 6, 30)), plan.version.Services[0].LastDay)
			for _, day := range []calendar.Date{today, *date(2030, 11, 1)} {
				planned, reason := nextAmendment(amendmentRead(), application, contract, day)
				require.Empty(t, reason)
				require.NotNil(t, planned)
				assert.True(t, waitingCarries(amendmentRead(), application.Bookings, &plan.version, planned.version, day),
					"unchanged bookings keep the waiting PDF and signing link, including after the planned start")
			}
		})
	}
}

func TestUnsignedContractFollowsAnExtendedModuleDespiteAnUnchangedOverallEnd(t *testing.T) {
	t.Parallel()
	sent := SentContract{Version: amendable().Latest, NextNumber: 2}
	sent.Version.Services[0].LastDay = date(2031, 1, 31)
	sent.Version.Services = append(sent.Version.Services, carecontract.Service{
		CareOfferingID: 2, Weekday: "thu", ModuleName: "Ganztag", EndsAt: "16:30",
	})
	application := carecontract.Application{Bookings: []carecontract.Booking{
		{CareOfferingID: 1, Days: []string{"mon"}, ValidFrom: date(2030, 8, 1), ValidUntil: date(2031, 2, 1)},
		{CareOfferingID: 1, Days: []string{"mon"}, ValidFrom: date(2031, 2, 1), ValidUntil: date(2031, 7, 1)},
		{CareOfferingID: 2, Days: []string{"thu"}, ValidFrom: date(2030, 8, 1)},
	}}
	today := *date(2030, 9, 1)
	version, changed := sentVersionNow(amendmentRead(), application, sent, today)
	require.True(t, changed, "the first signature must cover the actual booking ends")
	assert.Equal(t, date(2031, 6, 30), version.Services[0].LastDay)
	assert.Nil(t, version.EndsOn)
	sent.Version = version
	_, changed = sentVersionNow(amendmentRead(), application, sent, today)
	assert.False(t, changed)
}

func TestUnsignedContractKeepsItsStartAcrossEquivalentBookingSplits(t *testing.T) {
	t.Parallel()
	for _, fixed := range []bool{false, true} {
		t.Run(map[bool]string{false: "open", true: "fixed"}[fixed], func(t *testing.T) {
			t.Parallel()
			sent := SentContract{Version: amendable().Latest, NextNumber: 2}
			if fixed {
				months := 12
				sent.Version.Terms.TermKind, sent.Version.Terms.TermMonths = carecontract.TermFixedMonths, &months
				sent.Version.EndsOn = date(2031, 7, 31)
			}
			application := carecontract.Application{Bookings: []carecontract.Booking{
				{CareOfferingID: 1, Days: []string{"mon"}, ValidFrom: date(2030, 8, 1), ValidUntil: date(2030, 10, 1)},
				{CareOfferingID: 1, Days: []string{"mon"}, ValidFrom: date(2030, 10, 1)},
			}}
			_, changed := sentVersionNow(amendmentRead(), application, sent, *date(2030, 11, 1))
			assert.False(t, changed, "splitting the same care changes neither the start nor the fixed term")
		})
	}
}
