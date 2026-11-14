package application

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The Kontingente of a Personalakte in the Träger-Portal (#4710): one
// account per type of the Träger and year over all Einsatzorte, with what
// each school's bookings take. The Träger reads the bookings through the
// same database function the schools check them with.

// recordPool is what one read of a Personalakte's Kontingente returns.
type recordPool struct {
	record domain.TraegerStaffRecord
	types  []domain.TraegerAbsenceType
	claims map[int64]domain.AbsencePoolType
	uses   []domain.AbsencePoolUse
}

// AbsenceAccounts lists the accounts of the record in year. It writes the
// access log entry at every Einsatzort first.
func (t *TraegerStaff) AbsenceAccounts(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, year int) (workforce.TraegerAbsenceAccounts, error) {
	if year < 2000 || year > 2100 {
		return workforce.TraegerAbsenceAccounts{}, &workforce.InvalidAbsenceAllowanceError{Reason: "Das Jahr liegt außerhalb von 2000 bis 2100."}
	}
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return workforce.TraegerAbsenceAccounts{}, err
	}
	var pool recordPool
	err = t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		pool, err = t.readRecordPool(ctx, actor.OrganizationID, recordID, 0, year, year, false)
		return err
	})
	if err != nil {
		return workforce.TraegerAbsenceAccounts{}, publicTraegerStaffError(err)
	}
	deviations, err := t.recordSchoolTypes(ctx, actor, pool.record)
	if err != nil {
		return workforce.TraegerAbsenceAccounts{}, err
	}
	names := schoolNames(schools)
	today := calendar.TodayDate().String()
	result := workforce.TraegerAbsenceAccounts{Year: year, Accounts: make([]workforce.TraegerAbsenceAccount, 0, len(pool.types))}
	for _, value := range pool.types {
		account, err := pool.account(value, year, today)
		if err != nil {
			return workforce.TraegerAbsenceAccounts{}, err
		}
		account.Schools = pool.schoolUses(value.ID, year, names, deviations)
		result.Accounts = append(result.Accounts, account)
	}
	return result, nil
}

// readRecordPool reads the record, the active types with a Kontingent (only
// onlyType when set) and their claims and bookings for firstYear..lastYear,
// in the Träger transaction.
func (t *TraegerStaff) readRecordPool(ctx context.Context, organizationID, recordID, onlyType int64, firstYear, lastYear int, lock bool) (recordPool, error) {
	record, err := t.store.FindStaffRecord(ctx, organizationID, recordID, false)
	if err != nil {
		return recordPool{}, err
	}
	types, err := t.store.ListTraegerAbsenceTypes(ctx, organizationID)
	if err != nil {
		return recordPool{}, err
	}
	pool := recordPool{record: record}
	ids := []int64{}
	from, to := firstYear, domain.AllowanceExpiresOn(lastYear, "")
	for _, value := range types {
		if !value.AllowanceEnabled || (onlyType == 0 && !value.IsActive) || (onlyType != 0 && value.ID != onlyType) {
			continue
		}
		pool.types = append(pool.types, value)
		ids = append(ids, value.ID)
		if value.CarryoverUntil != "" {
			from = min(from, value.CreatedAt.In(calendar.Berlin).Year())
		}
		to = max(to, domain.AllowanceExpiresOn(lastYear, value.CarryoverUntil))
	}
	if len(ids) == 0 {
		return pool, nil
	}
	pool.claims, pool.uses, err = t.store.TraegerAbsencePool(ctx, organizationID, recordID, ids, fmt.Sprintf("%04d-01-01", from), to, lock)
	return pool, err
}

func (p recordPool) ledger(typeID int64, firstYear, lastYear int, today string, individual map[int]float64) (domain.AllowanceLedger, error) {
	claim := p.claims[typeID]
	if individual != nil {
		claim.Individual = individual
	}
	var uses []domain.AllowanceUse
	for _, use := range p.uses {
		if use.TraegerTypeID != typeID {
			continue
		}
		days, err := AllowanceUses(use.Absence)
		if err != nil {
			return domain.AllowanceLedger{}, err
		}
		uses = append(uses, days...)
	}
	return domain.BuildAllowanceLedger(claim.Entitlements(claim.WindowStart(firstYear), lastYear+1), claim.CarryoverUntil, today, uses), nil
}

func (p recordPool) account(value domain.TraegerAbsenceType, year int, today string) (workforce.TraegerAbsenceAccount, error) {
	ledger, err := p.ledger(value.ID, year, year, today, nil)
	if err != nil {
		return workforce.TraegerAbsenceAccount{}, err
	}
	summary := ledger.Summary(p.record.ID, value.ID, year)
	_, individual := p.claims[value.ID].Individual[year]
	account := workforce.TraegerAbsenceAccount{
		AbsenceTypeID: value.ID, AbsenceTypeName: value.Name, Year: year, EntitledDays: summary.EntitledDays,
		Individual: individual, StandardDays: value.StandardDays, TakenDays: summary.TakenDays,
		ReservedDays: summary.ReservedDays, RemainingDays: summary.RemainingDays, ExpiresOn: summary.ExpiresOn,
		ExpiredDays: summary.ExpiredDays,
	}
	if carried := summary.CarriedIn; carried != nil {
		account.CarriedIn = &workforce.TraegerAbsenceCarry{
			Year: carried.Year, RemainingDays: carried.RemainingDays, ExpiredDays: carried.ExpiredDays, ExpiresOn: carried.ExpiresOn,
		}
	}
	return account, nil
}

// schoolUses is what each Einsatzort's bookings take in the calendar year,
// with the school's deviation for the type.
func (p recordPool) schoolUses(typeID int64, year int, names map[int64]string, deviations map[int64][]domain.StaffAbsenceType) []workforce.TraegerAbsenceSchoolUse {
	result := make([]workforce.TraegerAbsenceSchoolUse, 0, len(p.record.Links))
	for _, link := range p.record.Links {
		entry := workforce.TraegerAbsenceSchoolUse{SchoolID: link.SchoolID, SchoolName: names[link.SchoolID], Offered: true}
		for _, row := range deviations[link.SchoolID] {
			if row.TraegerAbsenceTypeID != nil && *row.TraegerAbsenceTypeID == typeID {
				entry.Offered, entry.LimitDays = row.Offered, row.SchoolLimitDays
			}
		}
		for _, use := range p.uses {
			if use.TraegerTypeID == typeID && use.SchoolID == link.SchoolID {
				addYearDays(&entry, use.Absence, year)
			}
		}
		result = append(result, entry)
	}
	slices.SortFunc(result, func(a, b workforce.TraegerAbsenceSchoolUse) int {
		return strings.Compare(a.SchoolName, b.SchoolName)
	})
	return result
}

// addYearDays adds what the absence takes in the calendar year to entry,
// requested days apart from booked ones.
func addYearDays(entry *workforce.TraegerAbsenceSchoolUse, absence domain.StaffAbsence, year int) {
	days, _ := AllowanceUses(absence)
	prefix := strconv.Itoa(year)
	for _, day := range days {
		switch {
		case !strings.HasPrefix(day.Day, prefix):
		case day.Pending:
			entry.ReservedDays += day.Days
		default:
			entry.TakenDays += day.Days
		}
	}
}

// recordSchoolTypes writes the access log entry of the accounts view at
// every Einsatzort of the record and reads the school's types there, for
// its deviations.
func (t *TraegerStaff) recordSchoolTypes(ctx context.Context, actor workforce.TraegerStaffActor, record domain.TraegerStaffRecord) (map[int64][]domain.StaffAbsenceType, error) {
	result := make(map[int64][]domain.StaffAbsenceType, len(record.Links))
	for _, link := range record.Links {
		err := t.ports.Runtime.WithinSchool(ctx, link.SchoolID, func(ctx context.Context) error {
			if err := t.ports.Access.RecordTraegerStaffAccess(ctx, workforce.TraegerStaffAccess{
				OrganizationID: actor.OrganizationID, AccountID: actor.AccountID, View: workforce.TraegerStaffViewAbsenceAccounts,
				Rows: 1, StaffIDs: []int64{link.StaffID}, RecordID: record.ID,
			}); err != nil {
				return err
			}
			rows, err := t.store.SchoolAbsenceTypes(ctx)
			result[link.SchoolID] = rows
			return err
		})
		if err != nil {
			return nil, err
		}
	}
	return result, nil
}

// SetAbsenceAllowance sets the days of one person, type and year, under the
// lock the schools book with, once the days still cover every booked and
// requested day over all schools.
func (t *TraegerStaff) SetAbsenceAllowance(ctx context.Context, actor workforce.TraegerStaffActor, input workforce.SetTraegerAbsenceAllowance) error {
	check := domain.SetAbsenceTypeAllowance{
		StaffID: input.RecordID, AbsenceTypeID: input.AbsenceTypeID, Year: input.Year,
		EntitledDays: input.EntitledDays, Reason: input.Reason, ChangedBy: actor.AccountID,
	}
	if err := check.Validate(); err != nil {
		return &workforce.InvalidAbsenceAllowanceError{Reason: err.Error()}
	}
	err := t.released(ctx, actor, func(ctx context.Context) error {
		if _, err := t.store.FindTraegerAbsenceType(ctx, actor.OrganizationID, input.AbsenceTypeID, false); err != nil {
			return err
		}
		pool, err := t.readRecordPool(ctx, actor.OrganizationID, input.RecordID, input.AbsenceTypeID, input.Year, input.Year+1, true)
		if err != nil {
			return err
		}
		if len(pool.types) == 0 {
			return errNoAbsenceAllowance
		}
		previous, err := pool.checkClaim(input)
		if err != nil {
			return err
		}
		return t.store.SaveTraegerAbsenceAllowance(ctx, actor.OrganizationID, actor.AccountID, input, previous)
	})
	return publicTraegerStaffError(err)
}

// checkClaim keeps the Kontingent from going negative: taken and requested
// days at every school must fit the new claim, also those of the following
// year that use this year's rest. It returns the previous individual days.
func (p recordPool) checkClaim(input workforce.SetTraegerAbsenceAllowance) (*float64, error) {
	claim := p.claims[input.AbsenceTypeID]
	today := calendar.TodayDate().String()
	before, err := p.ledger(input.AbsenceTypeID, input.Year, input.Year+1, today, nil)
	if err != nil {
		return nil, err
	}
	changed := make(map[int]float64, len(claim.Individual)+1)
	for year, days := range claim.Individual {
		changed[year] = days
	}
	changed[input.Year] = input.EntitledDays
	after, err := p.ledger(input.AbsenceTypeID, input.Year, input.Year+1, today, changed)
	if err != nil {
		return nil, err
	}
	if overdrawn := after.Overdrawn(before); len(overdrawn) > 0 {
		summary := after.Summary(input.RecordID, input.AbsenceTypeID, input.Year)
		return nil, fmt.Errorf("%w: %s taken or requested in %d", workforce.ErrTraegerAbsenceAllowanceBelowBooked,
			formatAllowanceDays(summary.TakenDays+summary.ReservedDays), overdrawn[0])
	}
	if days, ok := claim.Individual[input.Year]; ok {
		return &days, nil
	}
	return nil, nil
}
