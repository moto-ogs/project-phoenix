package application

import (
	"context"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Extra care days a school plans for itself (#4817, ADR 0329). They are the
// Träger's holiday periods of the kind extra day; this capability narrows
// the Träger-Büro's commands to the days the school created and still hosts
// alone, and to its own school as the only host.

var _ enrollment.SchoolExtraDays = (*HolidayPeriods)(nil)

// schoolOwnsExtraDay reports an extra day the school created and hosts
// alone. A day the Träger-Büro extended to another school is the Büro's.
func schoolOwnsExtraDay(period enrollment.HolidayPeriod, schoolID int64) bool {
	if period.Kind != enrollment.HolidayPeriodKindExtraDay || period.CreatedBySchoolID == nil || period.CreatedBySchoolID.Int64() != schoolID {
		return false
	}
	return !slices.ContainsFunc(period.Weeks, func(week enrollment.HolidayWeek) bool {
		return week.HostSchoolID != ident.ID(schoolID)
	})
}

// schoolExtraDayInput shapes what a school writes: an extra day of its own.
func schoolExtraDayInput(input enrollment.HolidayPeriodInput, schoolID int64) (enrollment.HolidayPeriodInput, error) {
	for _, week := range input.Weeks {
		if week.HostSchoolID != schoolID {
			return enrollment.HolidayPeriodInput{}, enrollment.ErrSchoolExtraDayForeignSchool
		}
	}
	input.Kind = enrollment.HolidayPeriodKindExtraDay
	input.CreatedBySchoolID = schoolID
	return input, nil
}

// ListSchoolExtraDays returns the school's own extra days, newest first.
func (h *HolidayPeriods) ListSchoolExtraDays(ctx context.Context, organizationID, schoolID int64) ([]enrollment.HolidayPeriod, error) {
	if schoolID <= 0 {
		return nil, errHolidayPeriodRequired
	}
	periods, err := h.ListHolidayPeriods(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	own := []enrollment.HolidayPeriod{}
	for _, period := range periods {
		if schoolOwnsExtraDay(period, schoolID) {
			own = append(own, period)
		}
	}
	return own, nil
}

// SchoolExtraDay returns one extra day of the school.
func (h *HolidayPeriods) SchoolExtraDay(ctx context.Context, organizationID, schoolID, periodID int64) (enrollment.HolidayPeriod, error) {
	period, err := h.HolidayPeriod(ctx, organizationID, periodID)
	if err != nil {
		return enrollment.HolidayPeriod{}, err
	}
	if schoolID <= 0 || !schoolOwnsExtraDay(period, schoolID) {
		return enrollment.HolidayPeriod{}, enrollment.ErrHolidayPeriodNotFound
	}
	return period, nil
}

// CreateSchoolExtraDay adds a draft extra day of the school.
func (h *HolidayPeriods) CreateSchoolExtraDay(ctx context.Context, organizationID, schoolID int64, input enrollment.HolidayPeriodInput) (enrollment.HolidayPeriod, error) {
	if schoolID <= 0 {
		return enrollment.HolidayPeriod{}, errHolidayPeriodRequired
	}
	input, err := schoolExtraDayInput(input, schoolID)
	if err != nil {
		return enrollment.HolidayPeriod{}, err
	}
	return h.CreateHolidayPeriod(ctx, organizationID, input)
}

// UpdateSchoolExtraDay changes an extra day of the school over the version
// the school read. The update locks the day and refuses another version, so
// a change of the Träger-Büro in between is never overwritten.
func (h *HolidayPeriods) UpdateSchoolExtraDay(ctx context.Context, organizationID, schoolID, periodID int64, input enrollment.HolidayPeriodInput) (enrollment.HolidayPeriod, error) {
	if _, err := h.SchoolExtraDay(ctx, organizationID, schoolID, periodID); err != nil {
		return enrollment.HolidayPeriod{}, err
	}
	input, err := schoolExtraDayInput(input, schoolID)
	if err != nil {
		return enrollment.HolidayPeriod{}, err
	}
	return h.UpdateHolidayPeriod(ctx, organizationID, periodID, input)
}

// PublishSchoolExtraDay opens the registration of an extra day of the school.
func (h *HolidayPeriods) PublishSchoolExtraDay(ctx context.Context, organizationID, schoolID, periodID int64) (enrollment.HolidayPeriod, error) {
	if _, err := h.SchoolExtraDay(ctx, organizationID, schoolID, periodID); err != nil {
		return enrollment.HolidayPeriod{}, err
	}
	return h.PublishHolidayPeriod(ctx, organizationID, periodID)
}
