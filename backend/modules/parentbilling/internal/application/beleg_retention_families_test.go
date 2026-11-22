package application

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// TestFamilyMovesToTheContractOfTheFamilyThatStaysLongest (#7862): the
// deviation moves only to a contract of the same family, and to the one
// kept longest: in force before ended without a last day before the latest
// end; a family without another contract stays where it is and goes with it.
func TestFamilyMovesToTheContractOfTheFamilyThatStaysLongest(t *testing.T) {
	t.Parallel()
	day := func(month time.Month) *calendar.Date { d := calendar.NewDate(2030, month, 1); return &d }
	ended := func(id int64, on *calendar.Date) parentbilling.ContractRetentionFact {
		return parentbilling.ContractRetentionFact{ContractID: id, Ended: true, EndedOn: on}
	}
	running := func(id int64) parentbilling.ContractRetentionFact {
		return parentbilling.ContractRetentionFact{ContractID: id}
	}
	family := func(id int64, email string) parentbilling.FamilyOnContract {
		return parentbilling.FamilyOnContract{FamilyBillingID: id, FamilyEmail: email, ContractID: 1}
	}
	emails := map[int64]string{10: "a@example.org", 11: " A@example.org", 12: "a@example.org", 13: "a@example.org",
		20: "b@example.org", 21: "b@example.org", 22: "b@example.org", 30: "c@example.org"}
	concluded := func(id int64, on *calendar.Date, ends *calendar.Date) parentbilling.ContractRetentionFact {
		return parentbilling.ContractRetentionFact{ContractID: id, Ended: true, ConcludedOn: on, EndedOn: ends}
	}
	ahead := calendar.NewDate(2031, time.June, 30)
	cases := map[string]struct {
		remaining []parentbilling.ContractRetentionFact
		family    parentbilling.FamilyOnContract
		event     string
		want      []parentbilling.FamilyMove
	}{
		"a Weisung from the conclusion keeps the later concluded contract longer": {
			remaining: []parentbilling.ContractRetentionFact{concluded(20, day(time.January), day(time.December)), concluded(21, day(time.June), day(time.July))},
			family:    family(2, "b@example.org"),
			event:     parentbilling.TriggerContractConcluded,
			want:      []parentbilling.FamilyMove{{FamilyBillingID: 2, From: 1, To: 21}},
		},
		"in force wins over a later end": {
			remaining: []parentbilling.ContractRetentionFact{ended(10, day(time.December)), running(11), ended(12, nil)},
			family:    family(1, "a@example.org"),
			want:      []parentbilling.FamilyMove{{FamilyBillingID: 1, From: 1, To: 11}},
		},
		"a termination whose last day is ahead counts as in force": {
			remaining: []parentbilling.ContractRetentionFact{concluded(20, day(time.March), &ahead), concluded(21, day(time.June), day(time.July))},
			family:    family(2, "b@example.org"),
			event:     parentbilling.TriggerContractConcluded,
			want:      []parentbilling.FamilyMove{{FamilyBillingID: 2, From: 1, To: 20}},
		},
		"ended without a last day wins over a known end": {
			remaining: []parentbilling.ContractRetentionFact{ended(10, day(time.December)), ended(12, nil)},
			family:    family(1, "a@example.org"),
			want:      []parentbilling.FamilyMove{{FamilyBillingID: 1, From: 1, To: 12}},
		},
		"the latest end, then the newest contract": {
			remaining: []parentbilling.ContractRetentionFact{ended(22, day(time.March)), ended(20, day(time.June)), ended(21, day(time.June))},
			family:    family(2, "b@example.org"),
			want:      []parentbilling.FamilyMove{{FamilyBillingID: 2, From: 1, To: 21}},
		},
		"another family's contract is no home": {
			remaining: []parentbilling.ContractRetentionFact{running(30), running(40)},
			family:    family(3, "a@example.org"),
			want:      []parentbilling.FamilyMove{},
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			event := tc.event
			if event == "" {
				event = parentbilling.TriggerContractEnded
			}
			assert.Equal(t, tc.want, familyMoves([]parentbilling.FamilyOnContract{tc.family}, tc.remaining, emails, event, calendar.NewDate(2031, time.January, 1)))
		})
	}
}
