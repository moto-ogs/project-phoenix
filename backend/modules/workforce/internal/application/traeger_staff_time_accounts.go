package application

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The Stundenkonto of a Personalakte over all schools (#4711, ADR 0243).
// Each school computes the month of its employment in its own tenant
// transaction, as its Monatskarte does; the Träger sums them. A contract of
// the Träger with a Soll at a school makes the Personalverwaltung close that
// school's month: the close is the school's snapshot, written one school
// after another, never in the Träger transaction (ADR 0105).

var _ workforce.TraegerStaffTimeAccounts = (*TraegerStaff)(nil)

// errTimeAccountMonthInvalid refuses a month outside 2000..2100.
var errTimeAccountMonthInvalid = errors.New("the month lies outside 2000 to 2100")

// TimeAccount reads the Stundenkonto of the record in the month. Every
// school writes the access log entry before its month leaves it.
func (t *TraegerStaff) TimeAccount(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, year, month int) (workforce.TraegerTimeAccount, error) {
	year, month = t.monthOrThisMonth(year, month)
	_, account, err := t.readTimeAccount(ctx, actor, recordID, year, month)
	return account, err
}

// timeAccountFingerprint is the token of the month as the Personalverwaltung
// sees it: every school's balances and close state (ADR 0311).
func timeAccountFingerprint(account workforce.TraegerTimeAccount) string {
	account.Fingerprint = ""
	return readstate.Fingerprint(account)
}

// monthOrThisMonth reads year 0 and month 0 as the running month.
func (t *TraegerStaff) monthOrThisMonth(year, month int) (int, int) {
	if year != 0 || month != 0 {
		return year, month
	}
	today := calendar.DateFromTime(t.clock.Now())
	return today.Year(), int(today.Month())
}

// CloseTimeAccountMonth closes the month at every school whose month a
// contract of the Träger covers. It checks every school first, so a later
// closed month or a running month stops the close before any school is
// written. A school that was closed already stays as it is. A school that
// fails anyway (a race after the checks) leaves the schools before it closed;
// a second close finishes the rest (ADR 0243 point 4).
func (t *TraegerStaff) CloseTimeAccountMonth(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, change workforce.TraegerMonthChange) (workforce.TraegerTimeAccount, error) {
	links, account, err := t.readTimeAccount(ctx, actor, recordID, change.Year, change.Month)
	if err != nil {
		return workforce.TraegerTimeAccount{}, err
	}
	// The close freezes the balances the Personalverwaltung confirmed. Each
	// school closes in its own transaction (ADR 0105), so no lock spans the
	// schools: this read right before the first write is the check.
	if err := readstate.Check(change.ExpectedFingerprint, account.Fingerprint); err != nil {
		return workforce.TraegerTimeAccount{}, err
	}
	if err := closableAccount(account, change.Reason); err != nil {
		return workforce.TraegerTimeAccount{}, err
	}
	for i, school := range account.Schools {
		if !school.ByTraeger || school.Closed {
			continue
		}
		err := t.ports.Runtime.WithinSchool(ctx, school.SchoolID.Int64(), func(ctx context.Context) error {
			_, err := t.ports.Months.CloseMonthForTraeger(ctx, links[i].StaffID, actor.AccountID, change.Year, change.Month, change.Reason)
			return err
		})
		if err != nil {
			return workforce.TraegerTimeAccount{}, schoolMonthError(school, err)
		}
	}
	return t.TimeAccount(ctx, actor, recordID, change.Year, change.Month)
}

// ReopenTimeAccountMonth reopens the closes of the Träger in the month. A
// month the school closed itself stays closed: only the school reopens it.
func (t *TraegerStaff) ReopenTimeAccountMonth(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, change workforce.TraegerMonthChange) (workforce.TraegerTimeAccount, error) {
	links, account, err := t.readTimeAccount(ctx, actor, recordID, change.Year, change.Month)
	if err != nil {
		return workforce.TraegerTimeAccount{}, err
	}
	if err := reopenableAccount(account, change.Reason); err != nil {
		return workforce.TraegerTimeAccount{}, err
	}
	for i, school := range account.Schools {
		if !school.ClosedByTraeger {
			continue
		}
		err := t.ports.Runtime.WithinSchool(ctx, school.SchoolID.Int64(), func(ctx context.Context) error {
			return t.ports.Months.ReopenMonthForTraeger(ctx, links[i].StaffID, actor.AccountID, change.Year, change.Month, change.Reason)
		})
		if err != nil {
			return workforce.TraegerTimeAccount{}, schoolMonthError(school, err)
		}
	}
	return t.TimeAccount(ctx, actor, recordID, change.Year, change.Month)
}

// readTimeAccount reads the record in the Träger transaction and then each
// live school of it in that school's tenant transaction. It returns the
// links in the order of the account's schools.
func (t *TraegerStaff) readTimeAccount(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, year, month int) ([]domain.TraegerStaffLink, workforce.TraegerTimeAccount, error) {
	if year < 2000 || year > 2100 || month < 1 || month > 12 {
		return nil, workforce.TraegerTimeAccount{}, fmt.Errorf("%w: %w", workforce.ErrMonthCloseInvalid, errTimeAccountMonthInvalid)
	}
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return nil, workforce.TraegerTimeAccount{}, err
	}
	var record domain.TraegerStaffRecord
	err = t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		record, err = t.store.FindStaffRecord(ctx, actor.OrganizationID, recordID, false)
		return err
	})
	if err != nil {
		return nil, workforce.TraegerTimeAccount{}, publicTraegerStaffError(err)
	}
	names := schoolNames(schools)
	links := make([]domain.TraegerStaffLink, 0, len(record.Links))
	for _, link := range record.Links {
		if _, live := names[link.SchoolID]; live {
			links = append(links, link)
		}
	}
	slices.SortFunc(links, func(a, b domain.TraegerStaffLink) int {
		return strings.Compare(names[a.SchoolID], names[b.SchoolID])
	})
	account := workforce.TraegerTimeAccount{Year: year, Month: month, Schools: make([]workforce.TraegerTimeAccountSchool, 0, len(links))}
	for _, link := range links {
		var read workforce.TraegerSchoolMonth
		err := t.ports.Runtime.WithinSchool(ctx, link.SchoolID, func(ctx context.Context) error {
			if err := t.ports.Access.RecordTraegerStaffAccess(ctx, workforce.TraegerStaffAccess{
				OrganizationID: actor.OrganizationID, AccountID: actor.AccountID, View: workforce.TraegerStaffViewTimeAccount,
				Rows: 1, StaffIDs: []int64{link.StaffID}, RecordID: record.ID,
			}); err != nil {
				return err
			}
			var err error
			read, err = t.ports.Months.TraegerMonthAccount(ctx, link.StaffID, year, month)
			return err
		})
		if err != nil {
			return nil, workforce.TraegerTimeAccount{}, err
		}
		account.Ended = read.Ended
		account.Schools = append(account.Schools, schoolMonth(link.SchoolID, names[link.SchoolID], read))
	}
	account.TraegerTimeAccountMinutes, account.State = sumTimeAccount(account.Schools)
	account.Fingerprint = timeAccountFingerprint(account)
	return links, account, nil
}

// schoolMonth is the school's Monatskarte as one line of the account.
func schoolMonth(schoolID int64, name string, read workforce.TraegerSchoolMonth) workforce.TraegerTimeAccountSchool {
	summary := read.Summary
	return workforce.TraegerTimeAccountSchool{
		SchoolID: ident.ID(schoolID), SchoolName: name, HasTarget: summary.HasTarget, ByTraeger: read.Kept,
		TraegerTimeAccountMinutes: workforce.TraegerTimeAccountMinutes{
			TargetMinutes: summary.TargetMinutesToDate, ActualMinutes: summary.ActualMinutes,
			CreditedMinutes:   summary.CreditedSickMinutes + summary.CreditedVacationMinutes + summary.CreditedTrainingMinutes + summary.CreditedOtherMinutes,
			AdjustmentMinutes: summary.AdjustmentMinutes, BalanceMinutes: summary.BalanceMinutes,
			CarryInMinutes: summary.CarryInMinutes, ClosingBalanceMinutes: summary.ClosingBalanceMinutes,
		},
		Closed: summary.IsClosed, ClosedByTraeger: summary.ClosedByTraeger, ClosedAt: summary.ClosedAt,
		CloseReason: summary.CloseReason, DriftMinutes: summary.DriftMinutes, LaterClosed: read.LaterClosed,
	}
}

// sumTimeAccount adds the schools' months and names the month's state: open
// while a school the Träger closes is open, closed once all of them are, and
// school when no contract covers the month.
func sumTimeAccount(schools []workforce.TraegerTimeAccountSchool) (workforce.TraegerTimeAccountMinutes, string) {
	var sum workforce.TraegerTimeAccountMinutes
	state := workforce.TraegerMonthSchool
	for _, school := range schools {
		sum.TargetMinutes += school.TargetMinutes
		sum.ActualMinutes += school.ActualMinutes
		sum.CreditedMinutes += school.CreditedMinutes
		sum.AdjustmentMinutes += school.AdjustmentMinutes
		sum.BalanceMinutes += school.BalanceMinutes
		sum.CarryInMinutes += school.CarryInMinutes
		sum.ClosingBalanceMinutes += school.ClosingBalanceMinutes
		switch {
		case !school.ByTraeger:
		case !school.Closed:
			state = workforce.TraegerMonthOpen
		case state == workforce.TraegerMonthSchool:
			state = workforce.TraegerMonthClosed
		}
	}
	return sum, state
}

// closableAccount checks the whole month before the first school is written.
func closableAccount(account workforce.TraegerTimeAccount, reason string) error {
	if strings.TrimSpace(reason) == "" {
		return fmt.Errorf("%w: a reason is required", workforce.ErrMonthCloseInvalid)
	}
	switch account.State {
	case workforce.TraegerMonthSchool:
		return fmt.Errorf("%w: %04d-%02d", workforce.ErrMonthNotKeptByTraeger, account.Year, account.Month)
	case workforce.TraegerMonthClosed:
		return nil
	}
	if !account.Ended {
		return fmt.Errorf("%w: %04d-%02d is not over yet", workforce.ErrMonthNotClosable, account.Year, account.Month)
	}
	for _, school := range account.Schools {
		if school.ByTraeger && !school.Closed && school.LaterClosed != "" {
			return schoolMonthError(school, fmt.Errorf("%w: %s must be reopened first", workforce.ErrLaterMonthClosed, school.LaterClosed))
		}
	}
	return nil
}

// reopenableAccount checks the reopen before the first school is written:
// the Träger reopens newest month first, like the school.
func reopenableAccount(account workforce.TraegerTimeAccount, reason string) error {
	if strings.TrimSpace(reason) == "" {
		return fmt.Errorf("%w: a reason is required", workforce.ErrMonthCloseInvalid)
	}
	reopenable := false
	for _, school := range account.Schools {
		if !school.ClosedByTraeger {
			continue
		}
		if school.LaterClosed != "" {
			return schoolMonthError(school, fmt.Errorf("%w: %s must be reopened first", workforce.ErrLaterMonthClosed, school.LaterClosed))
		}
		reopenable = true
	}
	if reopenable {
		return nil
	}
	for _, school := range account.Schools {
		if school.Closed {
			return schoolMonthError(school, fmt.Errorf("%w: %04d-%02d", workforce.ErrMonthClosedBySchool, account.Year, account.Month))
		}
	}
	return fmt.Errorf("%w: %04d-%02d", workforce.ErrMonthNotClosed, account.Year, account.Month)
}

// schoolMonthError names the school a close or reopen stopped at.
func schoolMonthError(school workforce.TraegerTimeAccountSchool, err error) error {
	return &workforce.TraegerSchoolMonthError{SchoolID: school.SchoolID.Int64(), SchoolName: school.SchoolName, LaterMonth: school.LaterClosed, Err: err}
}
