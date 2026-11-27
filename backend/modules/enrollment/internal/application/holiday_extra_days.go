package application

import (
	"errors"
	"fmt"
	"time"

	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// Extra care days (#4817). An extra day is a holiday period of the kind
// enrollment.HolidayPeriodKindExtraDay: one weekday, such as a bridge day,
// offered at one or several schools of the Träger. Each school has its own
// week of that single day, so places, lists and the registration stay those
// of a holiday period. The day is either included in the monthly
// contribution, then its time models have no price, or booked at the price
// of its time model.

// withHolidayKind names the kind of a written period: a new period without
// one is a holiday period, a stored period keeps the kind it has.
func withHolidayKind(input enrollment.HolidayPeriodInput, current enrollment.HolidayPeriod) enrollment.HolidayPeriodInput {
	if input.Kind != "" {
		return input
	}
	input.Kind = current.Kind
	if input.Kind == "" {
		input.Kind = enrollment.HolidayPeriodKindHoliday
	}
	return input
}

// validateHolidayKind checks the kind of input and the rules of an extra
// day. current is the stored period on an update; weekErrs are the errors of
// the weeks so far, by position, and receive those of the extra day.
func validateHolidayKind(input enrollment.HolidayPeriodInput, current enrollment.HolidayPeriod, errs, weekErrs validation.Errors) {
	switch input.Kind {
	case enrollment.HolidayPeriodKindHoliday:
		if input.IncludedInFee {
			errs["included_in_fee"] = errors.New("only an extra day is included in the monthly contribution")
		}
	case enrollment.HolidayPeriodKindExtraDay:
		validateExtraDay(input, errs, weekErrs)
	default:
		errs["kind"] = errors.New("the kind is holiday or extra_day")
		return
	}
	if current.Kind != "" && input.Kind != current.Kind {
		errs["kind"] = errors.New("the kind of a period never changes")
	}
	// Parents register for a published day under its fee mode: a day booked
	// as included is never charged later, and a day booked at a price never
	// loses its frozen contributions from the billing.
	if current.Status == enrollment.HolidayPeriodPublished && input.IncludedInFee != current.IncludedInFee {
		errs["included_in_fee"] = errors.New("the fee mode of a published extra day never changes")
	}
}

// validateExtraDay holds an extra day to its shape: by arrival, without a
// bound of days or a holiday care wish, and one single weekday for each of
// its schools.
func validateExtraDay(input enrollment.HolidayPeriodInput, errs, weekErrs validation.Errors) {
	if input.MaxDaysPerChild != nil {
		errs["max_days_per_child"] = errors.New("an extra day has no bound of care days")
	}
	if input.HolidayWishRule {
		errs["holiday_wish_rule"] = errors.New("an extra day takes no holiday care wish into account")
	}
	if input.AllocationMode != enrollment.HolidayAllocationArrival {
		errs["allocation_mode"] = errors.New("an extra day gives its places by arrival")
	}
	for i, week := range input.Weeks {
		key := fmt.Sprint(i)
		own, _ := weekErrs[key].(validation.Errors)
		if own == nil {
			own = validation.Errors{}
		}
		validateExtraDayWeek(week, input.Weeks[0], input.IncludedInFee, own)
		if len(own) > 0 {
			weekErrs[key] = own
		}
	}
}

// validateExtraDayWeek checks one school's day of an extra day against the
// day of its first school.
func validateExtraDayWeek(week, first enrollment.HolidayWeekInput, included bool, errs validation.Errors) {
	if week.BookingUnit == enrollment.HolidayBookingUnitDay {
		errs["booking_unit"] = errors.New("an extra day is booked as a whole")
	}
	if holidayWeekDatesValid(week) {
		switch weekday := week.StartsOn.Weekday(); {
		case week.StartsOn != week.EndsOn:
			errs["ends_on"] = errors.New("an extra day is a single day")
		case weekday == time.Saturday || weekday == time.Sunday:
			errs["starts_on"] = errors.New("an extra day is a day from Monday to Friday")
		case week.StartsOn != first.StartsOn:
			errs["starts_on"] = errors.New("every school of an extra day has the same date")
		}
	}
	validateExtraDayPrices(week, included, errs)
}

// validateExtraDayPrices holds a school's day to its fee mode: an included
// day charges nothing, neither for care nor for lunch; a day at a price
// charges its care time. An archived care time takes no booking and keeps
// its price.
func validateExtraDayPrices(week enrollment.HolidayWeekInput, included bool, errs validation.Errors) {
	if included && week.LunchPriceCents != nil && *week.LunchPriceCents != 0 {
		errs["lunch_price_cents"] = errors.New("a lunch of a day included in the monthly contribution has no price")
	}
	models, _ := errs["time_models"].(validation.Errors)
	if models == nil {
		models = validation.Errors{}
	}
	for j, model := range week.TimeModels {
		if model.Archived || (model.PriceCents == 0) == included {
			continue
		}
		key := fmt.Sprint(j)
		own, _ := models[key].(validation.Errors)
		if own == nil {
			own = validation.Errors{}
		}
		if included {
			own["price_cents"] = errors.New("a day included in the monthly contribution has no price")
		} else {
			own["price_cents"] = errors.New("a day at a price per day needs a price above zero")
		}
		models[key] = own
	}
	if len(models) > 0 {
		errs["time_models"] = models
	}
}
