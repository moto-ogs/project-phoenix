package application

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// planningSite is the school a write of the Einsatzplanung plans for and
// the employment of the record there.
type planningSite struct {
	school  workforce.TraegerStaffSchool
	staffID int64
}

// resolvePlanningSite finds the record's employment at the school in the
// Träger transaction; the school must be one of the Träger's.
func (t *TraegerStaff) resolvePlanningSite(ctx context.Context, actor workforce.TraegerStaffActor, recordID, schoolID int64) (planningSite, error) {
	if t.sites == nil {
		return planningSite{}, errors.New("workforce traeger planning: the Dienstplan of the schools is not bound")
	}
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return planningSite{}, err
	}
	site := planningSite{}
	for _, school := range schools {
		if school.ID == ident.ID(schoolID) {
			site.school = school
		}
	}
	if site.school.ID == 0 {
		return planningSite{}, workforce.ErrTraegerPlanningSiteInvalid
	}
	err = t.released(ctx, actor, func(ctx context.Context) error {
		record, err := t.store.FindStaffRecord(ctx, actor.OrganizationID, recordID, false)
		if err != nil {
			return publicTraegerStaffError(err)
		}
		for _, link := range record.Links {
			if link.SchoolID == schoolID {
				site.staffID = link.StaffID
			}
		}
		return nil
	})
	if err != nil {
		return planningSite{}, err
	}
	if site.staffID == 0 {
		return planningSite{}, workforce.ErrTraegerPlanningSiteInvalid
	}
	return site, nil
}

// withinPlanningSite runs fn in the school's tenant transaction once the
// employment is live there and the access entry is written.
func (t *TraegerStaff) withinPlanningSite(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, site planningSite, fn func(context.Context) error) error {
	return t.ports.Runtime.WithinSchool(ctx, site.school.ID.Int64(), func(ctx context.Context) error {
		live, err := t.liveStaff(ctx, []planningLink{{recordID: recordID, staffID: site.staffID}})
		if err != nil {
			return err
		}
		if _, ok := live[site.staffID]; !ok {
			return workforce.ErrTraegerPlanningSiteInvalid
		}
		if err := t.ports.Access.RecordTraegerStaffAccess(ctx, workforce.TraegerStaffAccess{
			OrganizationID: actor.OrganizationID, AccountID: actor.AccountID, View: workforce.TraegerStaffViewPlanning,
			Rows: 1, StaffIDs: []int64{site.staffID}, RecordID: recordID,
		}); err != nil {
			return err
		}
		return fn(ctx)
	})
}

func planInput(site planningSite, actor workforce.TraegerStaffActor, input workforce.TraegerPlanShift) workforce.StaffShiftInput {
	return workforce.StaffShiftInput{
		StaffID: site.staffID, Date: input.Date.String(), StartTime: longClock(input.StartTime), EndTime: longClock(input.EndTime),
		BreakMinutes: input.BreakMinutes, Notes: input.Notes, TraegerAccountID: actor.AccountID, WorkingTime: input.WorkingTime,
	}
}

// PlanShift plans a shift of the record at one of its Einsatzorte.
func (t *TraegerStaff) PlanShift(ctx context.Context, actor workforce.TraegerStaffActor, input workforce.TraegerPlanShift) (workforce.TraegerPlanningShift, error) {
	site, err := t.resolvePlanningSite(ctx, actor, input.RecordID, input.SchoolID)
	if err != nil {
		return workforce.TraegerPlanningShift{}, err
	}
	var planned workforce.PlannedShift
	err = t.withinPlanningSite(ctx, actor, input.RecordID, site, func(ctx context.Context) error {
		planned, err = t.sites.SitePlanning().CreateShift(ctx, workforce.CreateStaffShift{StaffShiftInput: planInput(site, actor, input)})
		return err
	})
	if err != nil {
		return workforce.TraegerPlanningShift{}, err
	}
	return planningShift(planned, site.school), nil
}

// ownShiftError refuses a shift that is unknown or of another person.
func ownShiftError(shift workforce.PlannedShift, err error, site planningSite) error {
	if errors.Is(err, workforce.ErrStaffShiftNotFound) || (err == nil && shift.StaffID != site.staffID) {
		return workforce.ErrTraegerPlanningShiftNotFound
	}
	return err
}

// ChangeShift changes a shift of the record at the same Einsatzort. The
// school keeps its type and the reason of a change. The change rests on the
// shift the week showed: a shift changed since is refused under the
// Dienstplan's lock (ADR 0311).
func (t *TraegerStaff) ChangeShift(ctx context.Context, actor workforce.TraegerStaffActor, shiftID int64, input workforce.TraegerPlanShift) (workforce.TraegerPlanningShift, error) {
	site, err := t.resolvePlanningSite(ctx, actor, input.RecordID, input.SchoolID)
	if err != nil {
		return workforce.TraegerPlanningShift{}, err
	}
	var planned workforce.PlannedShift
	err = t.withinPlanningSite(ctx, actor, input.RecordID, site, func(ctx context.Context) error {
		shift, err := t.sites.SiteShift(ctx, shiftID)
		if err := ownShiftError(shift, err, site); err != nil {
			return err
		}
		planned, err = t.sites.SitePlanning().UpdateShift(ctx, workforce.UpdateStaffShift{
			ID: shiftID, StaffShiftInput: planInput(site, actor, input),
			PreserveExistingShiftType: true, PreserveExistingChangeReason: true,
			Read: &workforce.ShiftReadState{Version: input.ExpectedVersion},
		})
		return err
	})
	if err != nil {
		return workforce.TraegerPlanningShift{}, err
	}
	return planningShift(planned, site.school), nil
}

// RemoveShift deletes a shift of the record at one of its Einsatzorte.
func (t *TraegerStaff) RemoveShift(ctx context.Context, actor workforce.TraegerStaffActor, recordID, schoolID, shiftID int64) error {
	site, err := t.resolvePlanningSite(ctx, actor, recordID, schoolID)
	if err != nil {
		return err
	}
	return t.withinPlanningSite(ctx, actor, recordID, site, func(ctx context.Context) error {
		shift, err := t.sites.SiteShift(ctx, shiftID)
		if err := ownShiftError(shift, err, site); err != nil {
			return err
		}
		return t.sites.SitePlanning().DeleteShift(ctx, shiftID)
	})
}

// FutureShifts counts the shifts after today at each school of the Träger,
// for the list before the Einsatzplanung is switched off. The counts name
// no person and write no access entry.
func (t *TraegerStaff) FutureShifts(ctx context.Context, actor workforce.TraegerStaffActor) ([]workforce.TraegerFutureShifts, error) {
	if t.sites == nil {
		return nil, errors.New("workforce traeger planning: the Dienstplan of the schools is not bound")
	}
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return nil, err
	}
	today := calendar.Date(t.clock.Today())
	result := make([]workforce.TraegerFutureShifts, 0, len(schools))
	for _, school := range schools {
		var count int
		err := t.ports.Runtime.WithinSchool(ctx, school.ID.Int64(), func(ctx context.Context) error {
			count, err = t.sites.CountShiftsAfter(ctx, today)
			return err
		})
		if err != nil {
			return nil, err
		}
		if count > 0 {
			result = append(result, workforce.TraegerFutureShifts{SchoolID: school.ID, SchoolName: school.Name, Shifts: count})
		}
	}
	return result, nil
}

// longClock writes an HH:MM wall clock as the HH:MM:SS the Dienstplan
// reads; anything else stays as it is for the Dienstplan to refuse.
func longClock(value string) string {
	if len(value) == len("15:04") {
		return value + ":00"
	}
	return value
}
