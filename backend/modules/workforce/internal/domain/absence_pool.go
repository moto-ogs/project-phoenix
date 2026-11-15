package domain

import (
	"math"
	"strings"
	"time"
)

// The one Kontingent of a Personalakte over all its schools (#4710, ADR 0089
// section 10 with its addendum of 14.11.2026).

// AbsencePoolType is what the Träger keeps of one of its types for one
// person: the standard and rest rule of the type, the first year its
// Kontingent counts, and the days the Personalverwaltung set per year.
type AbsencePoolType struct {
	TraegerTypeID    int64
	AllowanceEnabled bool
	StandardDays     float64
	CarryoverUntil   string
	FirstYear        int
	Individual       map[int]float64
}

// Entitlements is the claim of every year in [from, to]: the person's own
// days, otherwise the standard.
func (t AbsencePoolType) Entitlements(from, to int) map[int]float64 {
	result := make(map[int]float64, max(0, to-from+1))
	for year := from; year <= to; year++ {
		if days, ok := t.Individual[year]; ok {
			result[year] = days
			continue
		}
		result[year] = t.StandardDays
	}
	return result
}

// WindowStart is the first year whose bookings feed the account of
// firstYear. Without a carryover only that year counts; with one the chain
// starts in the year the Träger created the type, since an older rest
// decides how much of each later year is still open.
func (t AbsencePoolType) WindowStart(firstYear int) int {
	if t.CarryoverUntil == "" || t.FirstYear <= 0 {
		return firstYear
	}
	return min(firstYear, t.FirstYear)
}

// AbsencePoolUse is one booking of a Träger's type at one Einsatzort.
// SchoolID is zero for another Einsatzort when a school reads.
type AbsencePoolUse struct {
	TraegerTypeID int64
	SchoolID      int64
	Absence       StaffAbsence
}

// TraegerAbsenceType is an Abwesenheitsart of a Träger.
type TraegerAbsenceType struct {
	ID               int64
	OrganizationID   int64
	Name             string
	AllowanceEnabled bool
	StandardDays     float64
	CarryoverUntil   string
	Requestable      bool
	IsActive         bool
	CreatedAt        time.Time
}

// TraegerAbsenceTypeReason explains why a type of the Träger is invalid, or
// is empty when it is valid. It normalizes the name.
func (t *TraegerAbsenceType) TraegerAbsenceTypeReason() string {
	t.Name = strings.TrimSpace(t.Name)
	switch {
	case t.Name == "":
		return "Der Name fehlt."
	case len([]rune(t.Name)) > maxAbsenceTypeNameLength:
		return "Der Name ist zu lang, höchstens 100 Zeichen."
	case IsReservedAbsenceTypeName(t.Name):
		return "Diesen Namen hat schon eine Grundart wie Urlaub oder Krank."
	case t.StandardDays < 0 || t.StandardDays > 366 || !wholeOrHalf(t.StandardDays):
		return "Das Kontingent braucht ganze oder halbe Tage zwischen 0 und 366."
	case ValidateCarryoverUntil(t.CarryoverUntil) != nil:
		return "Der Verfall braucht einen Tag im Format MM-TT, den es in jedem Jahr gibt."
	}
	if !t.AllowanceEnabled {
		t.StandardDays, t.CarryoverUntil = 0, ""
	}
	return ""
}

// IsReservedAbsenceTypeName reports whether name is one of the base types a
// school or Träger cannot name its own type after.
func IsReservedAbsenceTypeName(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "urlaub", "krank", "krankmeldung", "fortbildung", "sonstige", "sonstiges", "freizeitausgleich", "sonstige abwesenheit":
		return true
	}
	return false
}

func wholeOrHalf(days float64) bool {
	return math.Abs(days*2-math.Round(days*2)) <= 0.000001
}

// SchoolLimitExceeded reports the first year in which the bookings of one
// school take more than limit days and more than before took; 0 when none.
func SchoolLimitExceeded(limit float64, before, after map[int]float64) int {
	exceeded := 0
	for year, days := range after {
		if days > limit+0.000001 && days > before[year]+0.000001 && (exceeded == 0 || year < exceeded) {
			exceeded = year
		}
	}
	return exceeded
}
