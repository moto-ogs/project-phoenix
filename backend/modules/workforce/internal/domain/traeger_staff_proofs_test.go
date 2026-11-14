package domain

import (
	"errors"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func standardProofType(t *testing.T, key string) TraegerProofType {
	t.Helper()
	for _, kind := range StandardTraegerProofTypes() {
		if kind.StandardKey == key {
			return kind
		}
	}
	t.Fatalf("no standard kind %q", key)
	return TraegerProofType{}
}

func TestPrepareProofCertificateOfConduct(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, time.November, 14)
	kind := standardProofType(t, TraegerProofStandardPoliceCertificate)

	proof, err := PrepareProof(TraegerProof{PresentedOn: "2026-11-02", IssuedOn: "2026-10-20", NoRelevantEntry: true}, kind, today)
	if err != nil {
		t.Fatalf("PrepareProof: %v", err)
	}
	if proof.ExpiresOn != "2031-10-20" {
		t.Fatalf("expiry from the issue day plus five years = %q, want 2031-10-20", proof.ExpiresOn)
	}

	for name, tc := range map[string]struct {
		proof TraegerProof
		field string
	}{
		"without issue day":      {TraegerProof{PresentedOn: "2026-11-02", NoRelevantEntry: true}, "issued_on"},
		"issued after presented": {TraegerProof{PresentedOn: "2026-11-02", IssuedOn: "2026-11-03", NoRelevantEntry: true}, "issued_on"},
		"result not confirmed":   {TraegerProof{PresentedOn: "2026-11-02", IssuedOn: "2026-10-20"}, "no_relevant_entry"},
		"presented in future":    {TraegerProof{PresentedOn: "2026-11-15", IssuedOn: "2026-10-20", NoRelevantEntry: true}, "presented_on"},
		"expiry before presence": {TraegerProof{PresentedOn: "2026-11-02", IssuedOn: "2026-10-20", NoRelevantEntry: true, ExpiresOn: "2026-11-01"}, "expires_on"},
	} {
		_, err := PrepareProof(tc.proof, kind, today)
		invalid, ok := errors.AsType[*TraegerProofInvalidError](err)
		if !ok || invalid.Field != tc.field {
			t.Errorf("%s: err = %v, want invalid %s", name, err, tc.field)
		}
	}
}

func TestPrepareProofOtherKindsDropTheCertificateFields(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, time.November, 14)
	measles := standardProofType(t, TraegerProofStandardMeasles)
	proof, err := PrepareProof(TraegerProof{PresentedOn: "2026-09-01", IssuedOn: "2026-08-01", NoRelevantEntry: true}, measles, today)
	if err != nil {
		t.Fatalf("PrepareProof: %v", err)
	}
	if proof.IssuedOn != "" || proof.NoRelevantEntry || proof.ExpiresOn != "" {
		t.Fatalf("measles proof = %+v, want no issue day, no result and no expiry", proof)
	}

	prevention := standardProofType(t, TraegerProofStandardPrevention)
	proof, err = PrepareProof(TraegerProof{PresentedOn: "2026-01-31", ExpiresOn: "2027-06-30"}, prevention, today)
	if err != nil || proof.ExpiresOn != "2027-06-30" {
		t.Fatalf("given expiry: proof = %+v, err = %v", proof, err)
	}
}

func TestAddCalendarMonthsStaysInTheTargetMonth(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		day    calendar.Date
		months int
		want   string
	}{
		{calendar.NewDate(2026, time.January, 31), 1, "2026-02-28"},
		{calendar.NewDate(2028, time.January, 31), 1, "2028-02-29"},
		{calendar.NewDate(2026, time.November, 14), 60, "2031-11-14"},
		{calendar.NewDate(2026, time.December, 31), 12, "2027-12-31"},
		{calendar.NewDate(2026, time.August, 31), 6, "2027-02-28"},
	} {
		if got := AddCalendarMonths(tc.day, tc.months).String(); got != tc.want {
			t.Errorf("AddCalendarMonths(%s, %d) = %s, want %s", tc.day, tc.months, got, tc.want)
		}
	}
}

func TestTraegerProofStatus(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, time.November, 14)
	mandatory := TraegerProofType{Mandatory: true, ReminderLeadWeeks: 8}
	optional := TraegerProofType{ReminderLeadWeeks: 8}
	for name, tc := range map[string]struct {
		kind  TraegerProofType
		proof *TraegerProof
		want  string
	}{
		"mandatory missing":    {mandatory, nil, QualificationStatusMissing},
		"optional missing":     {optional, nil, ""},
		"no expiry":            {optional, &TraegerProof{}, QualificationStatusValid},
		"within the lead":      {mandatory, &TraegerProof{ExpiresOn: "2027-01-09"}, QualificationStatusExpiringSoon},
		"before the lead":      {mandatory, &TraegerProof{ExpiresOn: "2027-01-10"}, QualificationStatusValid},
		"expiry day is valid":  {mandatory, &TraegerProof{ExpiresOn: "2026-11-14"}, QualificationStatusExpiringSoon},
		"expired the day past": {mandatory, &TraegerProof{ExpiresOn: "2026-11-13"}, QualificationStatusExpired},
	} {
		if got := TraegerProofStatus(tc.kind, tc.proof, today); got != tc.want {
			t.Errorf("%s: status = %q, want %q", name, got, tc.want)
		}
	}
}
