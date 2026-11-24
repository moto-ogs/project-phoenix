package application

import (
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The tokens of what the Personalverwaltung edits in a record and in its
// catalogs (ADR 0311). Each is a fingerprint over the stored values its form
// shows: the record row, a contract and the two catalogs carry no updated_at
// that every writer moves. A read shows the token, the write sends it back
// and the owner compares it under the lock it writes under.

// personVersion is the token of the record's „Person“ section.
func personVersion(record domain.TraegerStaffRecord) string {
	return readstate.Fingerprint(struct {
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
		Birthday  string `json:"birthday"`
	}{record.FirstName, record.LastName, record.Birthday})
}

// financialVersion is the token of the bank and tax section: its sealed
// values, so the token carries no digest of an opened value and a value
// sealed anew is a new state.
func financialVersion(record domain.TraegerStaffRecord) string {
	return readstate.Fingerprint([][]byte{record.IBANSealed, record.TaxIDSealed, record.SocialSecurityNumberSealed})
}

// contractVersion is the token of one contract: its terms, every Soll and
// every holiday week, in a fixed order.
func contractVersion(contract domain.TraegerStaffContract) string {
	targets := slices.Clone(contract.Targets)
	slices.SortFunc(targets, func(a, b domain.ContractTarget) int {
		if bySite := compareSite(a.ContractSite, b.ContractSite); bySite != 0 {
			return bySite
		}
		return a.ValidFrom.Compare(b.ValidFrom)
	})
	weeks := slices.Clone(contract.HolidayWeeks)
	slices.SortFunc(weeks, func(a, b domain.ContractHolidayWeek) int {
		if bySite := compareSite(a.ContractSite, b.ContractSite); bySite != 0 {
			return bySite
		}
		return a.WeekStart.Compare(b.WeekStart)
	})
	return readstate.Fingerprint(struct {
		ID           int64                        `json:"id"`
		Kind         string                       `json:"kind"`
		StartsOn     string                       `json:"starts_on"`
		EndsOn       string                       `json:"ends_on"`
		Pool         bool                         `json:"pool"`
		Targets      []domain.ContractTarget      `json:"targets"`
		HolidayWeeks []domain.ContractHolidayWeek `json:"holiday_weeks"`
	}{contract.ID, contract.Kind, contract.StartsOn.String(), contract.EndsOn.String(), contract.Pool, targets, weeks})
}

func compareSite(a, b domain.ContractSite) int {
	switch {
	case a.SchoolID != b.SchoolID:
		return compareID(a.SchoolID, b.SchoolID)
	default:
		return compareID(a.StaffID, b.StaffID)
	}
}

func compareID(a, b int64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	default:
		return 0
	}
}

// absenceTypeVersion is the token of one absence type of the Träger: every
// field its form rewrites.
func absenceTypeVersion(value domain.TraegerAbsenceType) string {
	return readstate.Fingerprint(struct {
		Name             string  `json:"name"`
		AllowanceEnabled bool    `json:"allowance_enabled"`
		StandardDays     float64 `json:"standard_days"`
		CarryoverUntil   string  `json:"carryover_until"`
		Requestable      bool    `json:"requestable"`
		IsActive         bool    `json:"is_active"`
	}{value.Name, value.AllowanceEnabled, value.StandardDays, value.CarryoverUntil, value.Requestable, value.IsActive})
}

// proofTypeVersion is the token of one Nachweisart: every field its form
// rewrites.
func proofTypeVersion(kind domain.TraegerProofType) string {
	return readstate.Fingerprint(struct {
		Name              string `json:"name"`
		ValidityMonths    *int   `json:"validity_months"`
		ReminderLeadWeeks int    `json:"reminder_lead_weeks"`
		Mandatory         bool   `json:"mandatory"`
		Archived          bool   `json:"archived"`
	}{kind.Name, kind.ValidityMonths, kind.ReminderLeadWeeks, kind.Mandatory, kind.Archived()})
}
