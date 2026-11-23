package timetracking

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

type traegerMonthCapability struct {
	closing TraegerMonthClosing
	months  workforce.WorkTimeMonths
}

// TraegerMonthCapability serves the school's month of an employment to the
// Stundenkonto of the Träger (#4711): the Monatskarte of the school and the
// month-close state of the Träger.
func TraegerMonthCapability(closing TraegerMonthClosing, months workforce.WorkTimeMonths) workforce.TraegerStaffMonths {
	if closing == nil || months == nil {
		panic("traeger month capability: month close and month card are required")
	}
	return traegerMonthCapability{closing: closing, months: months}
}

func (c traegerMonthCapability) TraegerMonthAccount(ctx context.Context, staffID int64, year, month int) (workforce.TraegerSchoolMonth, error) {
	account, err := c.closing.TraegerMonthState(ctx, staffID, year, month)
	if err != nil {
		return workforce.TraegerSchoolMonth{}, mapTimeTrackingFailure(err)
	}
	summary, err := c.months.MonthSummary(ctx, staffID, year, month)
	if err != nil || summary == nil {
		return workforce.TraegerSchoolMonth{}, err
	}
	result := workforce.TraegerSchoolMonth{Summary: *summary, Kept: account.Kept, Ended: account.Ended}
	if later := account.LaterClosed; later != nil {
		result.LaterClosed = fmt.Sprintf("%04d-%02d", later.Year, later.Month)
	}
	result.Version = readstate.Fingerprint(result)
	return result, nil
}

// CloseMonthForTraeger reads the month again under the balance lock, with
// the same read that gave the Träger its Version, and closes only that.
func (c traegerMonthCapability) CloseMonthForTraeger(ctx context.Context, staffID, accountID int64, year, month int, reason, expectedVersion string) (bool, error) {
	closed, err := c.closing.CloseMonthForTraeger(ctx, staffID, accountID, year, month, reason, func(ctx context.Context) error {
		current, err := c.TraegerMonthAccount(ctx, staffID, year, month)
		if err != nil {
			return err
		}
		return readstate.Check(expectedVersion, current.Version)
	})
	return closed, mapTimeTrackingFailure(err)
}

func (c traegerMonthCapability) ReopenMonthForTraeger(ctx context.Context, staffID, accountID int64, year, month int, reason string) error {
	return mapTimeTrackingFailure(c.closing.ReopenMonthForTraeger(ctx, staffID, accountID, year, month, reason))
}
