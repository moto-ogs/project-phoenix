package application

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"

	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// The pattern of a number range (spec #4611 user story 75, ADR 0119): text
// with the running number {N}…{NNNNNNNN}, padded with zeros to the count of
// N, and optionally the year of the issue date as {JJJJ} or {JJ}. A pattern
// with a year counts from 1 every year; one without counts on.

var (
	numberToken     = regexp.MustCompile(`\{N{1,8}\}`)
	yearToken       = regexp.MustCompile(`\{JJJJ\}|\{JJ\}`)
	patternLiterals = regexp.MustCompile(`^[A-Za-z0-9./_-]*$`)
)

// normalizeNumberPattern checks a pattern: one running number, at most one
// year, otherwise letters, digits and . / _ -.
func normalizeNumberPattern(pattern string) (string, error) {
	pattern = strings.TrimSpace(pattern)
	errs := validation.Errors{}
	rest := yearToken.ReplaceAllString(numberToken.ReplaceAllString(pattern, ""), "")
	switch {
	case pattern == "":
		errs["pattern"] = errors.New("is required")
	case len([]rune(pattern)) > parentbilling.MaxNumberPatternLength:
		errs["pattern"] = errors.New("is too long")
	case len(numberToken.FindAllString(pattern, -1)) != 1:
		errs["pattern"] = errors.New("needs exactly one running number {N} to {NNNNNNNN}")
	case len(yearToken.FindAllString(pattern, -1)) > 1:
		errs["pattern"] = errors.New("may name the year once")
	case !patternLiterals.MatchString(rest):
		errs["pattern"] = errors.New("may only hold letters, digits, . / _ - and the placeholders")
	}
	if len(errs) > 0 {
		return pattern, errs
	}
	return pattern, nil
}

// numberYear is the counter of a pattern on the issue year: the year when
// the pattern names it, else 0 for one counter across the years.
func numberYear(pattern string, issueYear int) int {
	if yearToken.MatchString(pattern) {
		return issueYear
	}
	return 0
}

// formatInvoiceNumber writes the number sequence of year into pattern.
func formatInvoiceNumber(pattern string, year int, sequence int64) string {
	number := numberToken.ReplaceAllStringFunc(pattern, func(token string) string {
		return fmt.Sprintf("%0*d", len(token)-2, sequence)
	})
	return yearToken.ReplaceAllStringFunc(number, func(token string) string {
		if token == "{JJ}" {
			return fmt.Sprintf("%02d", year%100)
		}
		return fmt.Sprintf("%04d", year)
	})
}

// numberRangeStartStore keeps the counters and the start values of the
// number ranges (#7358). NumberCounters names the last issued number per
// service and year; NumberRangeStarts lists every start value of the
// Träger, the newest first. LockNumberCounter holds the counter until the
// transaction ends, so a release waits, and names its last issued number, 0
// before the first.
type numberRangeStartStore interface {
	NumberCounters(ctx context.Context, organizationID int64) (map[string]map[int]int64, error)
	NumberRangeStarts(ctx context.Context, organizationID int64) ([]parentbilling.NumberRangeStart, error)
	LockNumberCounter(ctx context.Context, organizationID int64, service string, year int) (int64, error)
	InsertNumberRangeStart(ctx context.Context, organizationID int64, start parentbilling.NumberRangeStart) error
}

// ListNumberRanges lists the number range of every service with the number
// the next invoice would get today and the start values the Abrechnung set
// (#7358). A service without a pattern shows an empty one.
func (b *BillingRuns) ListNumberRanges(ctx context.Context, reviewer parentbilling.HolidayReviewer) ([]parentbilling.NumberRange, error) {
	if reviewer.OrganizationID <= 0 {
		return nil, errTraegerRequired
	}
	ranges, err := b.store.ListNumberRanges(ctx, reviewer.OrganizationID)
	if err != nil {
		return nil, fmt.Errorf("parent billing: list number ranges: %w", err)
	}
	// Every service shows its range, an empty one until it is set; the
	// monthly care has its own (#4684).
	for _, service := range []string{parentbilling.ServiceHoliday, parentbilling.ServiceCare} {
		if !slices.ContainsFunc(ranges, func(numberRange parentbilling.NumberRange) bool { return numberRange.Service == service }) {
			ranges = append(ranges, parentbilling.NumberRange{Service: service})
		}
	}
	return b.withCounters(ctx, reviewer, ranges)
}

// SetNumberRange sets the pattern of a service. Issued invoices keep their
// numbers; the counter goes on.
func (b *BillingRuns) SetNumberRange(ctx context.Context, reviewer parentbilling.HolidayReviewer, service, pattern string) (parentbilling.NumberRange, error) {
	if reviewer.OrganizationID <= 0 {
		return parentbilling.NumberRange{}, errTraegerRequired
	}
	service = strings.TrimSpace(service)
	if !numberedService(service) {
		return parentbilling.NumberRange{}, validation.Errors{"service": errors.New("unknown service")}
	}
	pattern, err := normalizeNumberPattern(pattern)
	if err != nil {
		return parentbilling.NumberRange{}, err
	}
	numberRange, err := b.store.SetNumberRange(ctx, reviewer.OrganizationID, service, pattern)
	if err != nil {
		return parentbilling.NumberRange{}, fmt.Errorf("parent billing: set number range: %w", err)
	}
	return b.oneWithCounters(ctx, reviewer, numberRange)
}

// SetNumberRangeStart sets the number the next invoice of the service gets
// (#7358). It holds the counter of today, so no release issues a number in
// between, and refuses a value that is not above the last issued number:
// numbers stay unique and never go back. The value is added to the history
// of the range with the account.
func (b *BillingRuns) SetNumberRangeStart(ctx context.Context, reviewer parentbilling.HolidayReviewer, service string, nextNumber int64) (parentbilling.NumberRange, error) {
	if reviewer.OrganizationID <= 0 || reviewer.AccountID <= 0 {
		return parentbilling.NumberRange{}, errTraegerRequired
	}
	service = strings.TrimSpace(service)
	if !numberedService(service) {
		return parentbilling.NumberRange{}, validation.Errors{"service": errors.New("unknown service")}
	}
	if nextNumber < 1 || nextNumber > parentbilling.MaxNumberRangeStart {
		return parentbilling.NumberRange{}, validation.Errors{"next_number": fmt.Errorf("must be between 1 and %d", parentbilling.MaxNumberRangeStart)}
	}
	pattern, err := numberPatternOf(ctx, b.store, reviewer.OrganizationID, service)
	if err != nil {
		return parentbilling.NumberRange{}, err
	}
	issueYear := b.today().Year()
	year := numberYear(pattern, issueYear)
	last, err := b.store.LockNumberCounter(ctx, reviewer.OrganizationID, service, year)
	if err != nil {
		return parentbilling.NumberRange{}, fmt.Errorf("parent billing: lock the number counter: %w", err)
	}
	if nextNumber <= last {
		return parentbilling.NumberRange{}, &parentbilling.NumberRangeStartTakenError{
			LastSequence: last, LastNumber: formatInvoiceNumber(pattern, issueYear, last),
		}
	}
	account := reviewer.AccountID
	start := parentbilling.NumberRangeStart{Service: service, Year: year, NextNumber: nextNumber, AccountID: &account}
	if err := b.store.InsertNumberRangeStart(ctx, reviewer.OrganizationID, start); err != nil {
		return parentbilling.NumberRange{}, fmt.Errorf("parent billing: set the start of the number range: %w", err)
	}
	return b.oneWithCounters(ctx, reviewer, parentbilling.NumberRange{Service: service, Pattern: pattern})
}

func numberedService(service string) bool {
	return service == parentbilling.ServiceHoliday || service == parentbilling.ServiceCare
}

func (b *BillingRuns) oneWithCounters(ctx context.Context, reviewer parentbilling.HolidayReviewer, numberRange parentbilling.NumberRange) (parentbilling.NumberRange, error) {
	ranges, err := b.withCounters(ctx, reviewer, []parentbilling.NumberRange{numberRange})
	if err != nil {
		return parentbilling.NumberRange{}, err
	}
	return ranges[0], nil
}

// withCounters names for every pattern the counter of today: the last
// issued number, the number the next invoice gets, which is the newest start
// value when that is larger, and the start values with who set them.
func (b *BillingRuns) withCounters(ctx context.Context, reviewer parentbilling.HolidayReviewer, ranges []parentbilling.NumberRange) ([]parentbilling.NumberRange, error) {
	counters, err := b.store.NumberCounters(ctx, reviewer.OrganizationID)
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the number counters: %w", err)
	}
	starts, err := b.store.NumberRangeStarts(ctx, reviewer.OrganizationID)
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the starts of the number ranges: %w", err)
	}
	names, err := b.startNames(ctx, reviewer, starts)
	if err != nil {
		return nil, err
	}
	issueYear := b.today().Year()
	for i := range ranges {
		numberRange := &ranges[i]
		numberRange.Starts = []parentbilling.NumberRangeStart{}
		if numberRange.Pattern == "" {
			continue
		}
		numberRange.Year = numberYear(numberRange.Pattern, issueYear)
		numberRange.LastNumber = counters[numberRange.Service][numberRange.Year]
		numberRange.NextNumber = numberRange.LastNumber + 1
		for _, start := range starts {
			if start.Service == numberRange.Service && start.Year == numberRange.Year {
				numberRange.Starts = append(numberRange.Starts, namedStart(start, numberRange.Pattern, issueYear, reviewer, names))
			}
		}
		// The newest start value is the floor of the counter.
		if len(numberRange.Starts) > 0 {
			numberRange.NextNumber = max(numberRange.NextNumber, numberRange.Starts[0].NextNumber)
		}
		numberRange.Example = formatInvoiceNumber(numberRange.Pattern, issueYear, numberRange.NextNumber)
	}
	return ranges, nil
}

// namedStart writes a start value in the pattern and names who set it: the
// reader, a colleague by name, or nobody once the account is gone.
func namedStart(start parentbilling.NumberRangeStart, pattern string, issueYear int, reviewer parentbilling.HolidayReviewer, names map[int64]string) parentbilling.NumberRangeStart {
	start.Example = formatInvoiceNumber(pattern, issueYear, start.NextNumber)
	start.SetByYou = byAccount(start.AccountID, reviewer.AccountID)
	start.SetByAccount = start.AccountID != nil
	if !start.SetByYou && start.AccountID != nil {
		start.SetByName = names[*start.AccountID]
	}
	return start
}

// startNames reads the names of the colleagues who set a start value, in
// one call and none when the reader set them all.
func (b *BillingRuns) startNames(ctx context.Context, reviewer parentbilling.HolidayReviewer, starts []parentbilling.NumberRangeStart) (map[int64]string, error) {
	var ids []int64
	for _, start := range starts {
		if start.AccountID != nil && *start.AccountID != reviewer.AccountID && !slices.Contains(ids, *start.AccountID) {
			ids = append(ids, *start.AccountID)
		}
	}
	if len(ids) == 0 {
		return map[int64]string{}, nil
	}
	names, err := b.names.TraegerActorNames(ctx, reviewer.OrganizationID, ids)
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the names of the Träger-Büro: %w", err)
	}
	return names, nil
}
