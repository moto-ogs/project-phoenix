package application

import (
	"context"
	"errors"
	"slices"

	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Extra care days a school plans for itself (#4817, ADR 0329). They are the
// Träger's holiday periods of the kind extra day; these commands narrow the
// Träger-Büro's commands to the days the school created and still hosts
// alone, and to its own school as the only host. What only the Büro decides
// stays as stored: the acceptance mail text, the places of the day and a
// second care time the Büro added.

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

// schoolExtraDayInput shapes what a school writes: an extra day with its
// own school as the one host and one care time.
func schoolExtraDayInput(input enrollment.HolidayPeriodInput, schoolID int64) (enrollment.HolidayPeriodInput, error) {
	for _, week := range input.Weeks {
		if week.HostSchoolID != schoolID {
			return enrollment.HolidayPeriodInput{}, enrollment.ErrSchoolExtraDayForeignSchool
		}
	}
	if len(input.Weeks) != 1 {
		return enrollment.HolidayPeriodInput{}, validation.Errors{"weeks": errors.New("a school plans the one day of its own school")}
	}
	offered := 0
	for _, model := range input.Weeks[0].TimeModels {
		if !model.Archived {
			offered++
		}
	}
	if offered != 1 {
		return enrollment.HolidayPeriodInput{}, validation.Errors{"weeks": validation.Errors{"0": validation.Errors{"time_models": errors.New("a school plans one care time for its day")}}}
	}
	input.Kind = enrollment.HolidayPeriodKindExtraDay
	input.CreatedBySchoolID = schoolID
	input.AcceptanceMailText = ""
	return input, nil
}

// schoolExtraDayWriter admits the school to a locked day of its own and
// keeps what only the Träger-Büro decides: the day stays the stored week, so
// its places stay, and the acceptance mail text stays as stored.
func schoolExtraDayWriter(schoolID int64) holidayPeriodWriter {
	return func(input enrollment.HolidayPeriodInput, locked enrollment.HolidayPeriod) (enrollment.HolidayPeriodInput, error) {
		if !schoolOwnsExtraDay(locked, schoolID) {
			return enrollment.HolidayPeriodInput{}, enrollment.ErrHolidayPeriodNotFound
		}
		input, err := schoolExtraDayInput(input, schoolID)
		if err != nil {
			return enrollment.HolidayPeriodInput{}, err
		}
		if len(locked.Weeks) == 1 {
			stored := locked.Weeks[0]
			if slices.ContainsFunc(stored.TimeModels, func(model enrollment.HolidayTimeModel) bool {
				return !model.Archived && !slices.ContainsFunc(input.Weeks[0].TimeModels, func(sent enrollment.HolidayTimeModelInput) bool { return sent.ID == model.ID })
			}) {
				return enrollment.HolidayPeriodInput{}, validation.Errors{"weeks": validation.Errors{"0": validation.Errors{"time_models": errors.New("the Träger-Büro changed the care times of the day; the school keeps them")}}}
			}
			input.Weeks[0].ID = stored.ID.Int64()
		}
		input.AcceptanceMailText = locked.AcceptanceMailText
		return input, nil
	}
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

// SchoolExtraDay returns one extra day of the school. It decides on the
// stored day before it reads any calendar, so a day of somebody else answers
// like a day that does not exist, whatever its host schools are.
func (h *HolidayPeriods) SchoolExtraDay(ctx context.Context, organizationID, schoolID, periodID int64) (enrollment.HolidayPeriod, error) {
	period, err := h.storedPeriod(ctx, organizationID, periodID, false)
	if err != nil {
		return enrollment.HolidayPeriod{}, err
	}
	if schoolID <= 0 || !schoolOwnsExtraDay(period, schoolID) {
		return enrollment.HolidayPeriod{}, enrollment.ErrHolidayPeriodNotFound
	}
	return withHolidayNoCareDays(ctx, h.calendar, period)
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
// the school read. The school is admitted on the locked day, so a change of
// the Träger-Büro in between neither slips past the check nor is overwritten.
func (h *HolidayPeriods) UpdateSchoolExtraDay(ctx context.Context, organizationID, schoolID, periodID int64, input enrollment.HolidayPeriodInput) (enrollment.HolidayPeriod, error) {
	if schoolID <= 0 {
		return enrollment.HolidayPeriod{}, enrollment.ErrHolidayPeriodNotFound
	}
	return h.updateHolidayPeriod(ctx, organizationID, periodID, input, schoolExtraDayWriter(schoolID))
}

// PublishSchoolExtraDay opens the registration of an extra day of the
// school, admitted on the locked day like a change.
func (h *HolidayPeriods) PublishSchoolExtraDay(ctx context.Context, organizationID, schoolID, periodID int64) (enrollment.HolidayPeriod, error) {
	return h.publishHolidayPeriod(ctx, organizationID, periodID, func(locked enrollment.HolidayPeriod) error {
		if schoolID <= 0 || !schoolOwnsExtraDay(locked, schoolID) {
			return enrollment.ErrHolidayPeriodNotFound
		}
		return nil
	})
}
