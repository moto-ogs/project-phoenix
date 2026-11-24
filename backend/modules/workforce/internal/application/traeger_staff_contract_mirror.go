package application

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// contractScene is what a contract write checks against: the record, its
// contracts, the first day each Einsatzort still lets change and the
// Sonderarbeitszeiten each school keeps itself.
type contractScene struct {
	record    domain.TraegerStaffRecord
	contracts []domain.TraegerStaffContract
	openFrom  map[int64]calendar.Date
	ownWeeks  map[int64][]domain.StaffTargetOverride
}

// loadScene reads the record and its contracts in the Träger transaction,
// then every Einsatzort in its own tenant transaction.
func (t *TraegerStaff) loadScene(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, withOwnWeeks bool) (contractScene, error) {
	var scene contractScene
	err := t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		if scene.record, err = t.store.FindStaffRecord(ctx, actor.OrganizationID, recordID, false); err != nil {
			return err
		}
		scene.contracts, err = t.store.ListStaffContracts(ctx, actor.OrganizationID, recordID)
		return err
	})
	if err != nil {
		return contractScene{}, err
	}
	scene.openFrom, scene.ownWeeks, err = t.readOpenDays(ctx, scene.record.Links, withOwnWeeks)
	return scene, err
}

// readOpenDays reads, per Einsatzort, the first day a change may start on
// and, with withOwnWeeks, the school's own Sonderarbeitszeiten from then on.
func (t *TraegerStaff) readOpenDays(ctx context.Context, links []domain.TraegerStaffLink, withOwnWeeks bool) (map[int64]calendar.Date, map[int64][]domain.StaffTargetOverride, error) {
	openFrom := make(map[int64]calendar.Date, len(links))
	ownWeeks := make(map[int64][]domain.StaffTargetOverride)
	today := calendar.Date(t.clock.Today())
	for _, link := range links {
		err := t.ports.Runtime.WithinSchool(ctx, link.SchoolID, func(ctx context.Context) error {
			closed, err := t.store.SchoolClosedMonths(ctx, []int64{link.StaffID})
			if err != nil {
				return err
			}
			openFrom[link.SchoolID] = domain.FirstMirrorDay(today, closed[link.StaffID])
			if !withOwnWeeks {
				return nil
			}
			ownWeeks[link.SchoolID], err = t.store.SchoolOwnTargetOverrides(ctx, link.StaffID, openFrom[link.SchoolID])
			return err
		})
		if err != nil {
			return nil, nil, fmt.Errorf("read open days of school %d: %w", link.SchoolID, err)
		}
	}
	return openFrom, ownWeeks, nil
}

// rejectClosed refuses a change starting on start at one of the sites
// before that school's first open day.
func (s contractScene) rejectClosed(field string, start calendar.Date, sites []domain.ContractSite) error {
	for _, site := range sites {
		if err := domain.RejectBeforeMirrorDay(field, site.SchoolID, start, s.openFrom[site.SchoolID]); err != nil {
			return err
		}
	}
	return nil
}

// liveSites lists the Einsatzorte of the record.
func (s contractScene) liveSites() []domain.ContractSite {
	sites := make([]domain.ContractSite, 0, len(s.record.Links))
	for _, link := range s.record.Links {
		sites = append(sites, domain.ContractSite{SchoolID: link.SchoolID, StaffID: link.StaffID})
	}
	return sites
}

// contract returns the record's contract id.
func (s contractScene) contract(id int64) (domain.TraegerStaffContract, error) {
	for _, contract := range s.contracts {
		if contract.ID == id {
			return contract, nil
		}
	}
	return domain.TraegerStaffContract{}, domain.ErrContractMissing
}

// readContract returns the contract a dialog changes, refused when it
// differs from the read the dialog opened on (ADR 0311). writeContract
// calls the plan with the contracts read again under the record lock.
func (s contractScene) readContract(id int64, expectedVersion string) (domain.TraegerStaffContract, error) {
	contract, err := s.contract(id)
	if err != nil {
		return domain.TraegerStaffContract{}, err
	}
	return contract, readstate.Check(expectedVersion, contractVersion(contract))
}

// mirror brings every Einsatzort of the record up to date in its own tenant
// transaction: the Soll of all contracts from the first open day on into
// the school's schedule, the holiday weeks into its Sonderarbeitszeiten. It
// rewrites everything from that day, so a school a former write missed
// catches up (ADR 0233 section 6). An Einsatzort no contract names keeps
// what it has; one in released gets its own schedule back from the given
// day, because the Träger deleted the contract that named it. It returns
// the schools it could not reach; the change itself is saved.
func (t *TraegerStaff) mirror(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, released map[domain.ContractSite]calendar.Date) ([]int64, error) {
	var record domain.TraegerStaffRecord
	var contracts []domain.TraegerStaffContract
	err := t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		if record, err = t.store.FindStaffRecord(ctx, actor.OrganizationID, recordID, false); err != nil {
			return err
		}
		contracts, err = t.store.ListStaffContracts(ctx, actor.OrganizationID, recordID)
		return err
	})
	if err != nil {
		return nil, err
	}
	var failed []int64
	for _, link := range record.Links {
		site := domain.ContractSite{SchoolID: link.SchoolID, StaffID: link.StaffID}
		plan := domain.BuildSollPlan(site, contracts)
		from, release := released[site]
		if !plan.Governs && !release {
			continue
		}
		err := t.ports.Runtime.WithinSchool(ctx, link.SchoolID, func(ctx context.Context) error {
			if !plan.Governs {
				return t.store.ReleaseMirror(ctx, site.StaffID, from, t.clock.Now())
			}
			return t.mirrorSchool(ctx, plan)
		})
		if err != nil {
			t.warn("traeger contract mirror failed", "school_id", link.SchoolID, "staff_record_id", recordID, "error", err)
			failed = append(failed, link.SchoolID)
		}
	}
	return failed, nil
}

func (t *TraegerStaff) mirrorSchool(ctx context.Context, plan domain.SollPlan) error {
	staffID := plan.Site.StaffID
	if err := t.lock.LockStaffBalance(ctx, staffID); err != nil {
		return err
	}
	closed, err := t.store.SchoolClosedMonths(ctx, []int64{staffID})
	if err != nil {
		return err
	}
	from := domain.FirstMirrorDay(calendar.Date(t.clock.Today()), closed[staffID])
	if plan.Start.After(from) {
		from = plan.Start
	}
	now := t.clock.Now()
	if err := t.store.KeepTemplateHistory(ctx, staffID, from, now); err != nil {
		return err
	}
	clipped := plan.From(from)
	if err := t.store.MirrorStaffSchedule(ctx, staffID, from, clipped.ScheduleRows(), now); err != nil {
		return err
	}
	return t.store.MirrorStaffHolidayWeeks(ctx, staffID, from, clipped.HolidayOverrides())
}

// publicContracts shows the contracts with their school names and the first
// day each Einsatzort still lets change.
func publicContracts(contracts []domain.TraegerStaffContract, names map[int64]string, openFrom map[int64]calendar.Date) []workforce.TraegerStaffContract {
	result := make([]workforce.TraegerStaffContract, 0, len(contracts))
	for _, contract := range contracts {
		public := workforce.TraegerStaffContract{
			ID: ident.ID(contract.ID), Kind: contract.Kind, StartsOn: contract.StartsOn, Pool: contract.Pool,
			Sites: []workforce.TraegerContractSiteDetail{}, HolidayWeeks: make([]workforce.TraegerContractHolidayWeek, 0, len(contract.HolidayWeeks)),
			Version: contractVersion(contract),
		}
		if !contract.EndsOn.IsZero() {
			public.EndsOn = new(contract.EndsOn)
		}
		for _, site := range contract.Sites() {
			detail := workforce.TraegerContractSiteDetail{
				TraegerContractSite: workforce.TraegerContractSite{SchoolID: ident.ID(site.SchoolID), StaffID: ident.ID(site.StaffID)},
				SchoolName:          names[site.SchoolID], ChangeableFrom: openFrom[site.SchoolID],
			}
			for _, target := range contract.Targets {
				if target.ContractSite == site {
					detail.Soll = append(detail.Soll, workforce.TraegerContractSoll{ValidFrom: target.ValidFrom, WeekdayMinutes: target.WeekdayMinutes})
				}
			}
			slices.SortFunc(detail.Soll, func(a, b workforce.TraegerContractSoll) int { return b.ValidFrom.Compare(a.ValidFrom) })
			public.Sites = append(public.Sites, detail)
		}
		for _, week := range contract.HolidayWeeks {
			public.HolidayWeeks = append(public.HolidayWeeks, workforce.TraegerContractHolidayWeek{
				TraegerContractSite: workforce.TraegerContractSite{SchoolID: ident.ID(week.SchoolID), StaffID: ident.ID(week.StaffID)},
				SchoolName:          names[week.SchoolID], WeekStart: week.WeekStart, WeekdayMinutes: week.WeekdayMinutes,
			})
		}
		result = append(result, public)
	}
	return result
}

// publicContractError maps the contract refusals onto the contract of the
// public package.
func publicContractError(err error, names map[int64]string) error {
	contractErr, ok := errors.AsType[*domain.ContractError](err)
	if !ok {
		if errors.Is(err, domain.ErrContractMissing) {
			return errors.Join(workforce.ErrTraegerContractNotFound, err)
		}
		return publicTraegerStaffError(err)
	}
	kind := map[error]error{
		domain.ErrContractInvalid:           workforce.ErrTraegerContractInvalid,
		domain.ErrContractOverlap:           workforce.ErrTraegerContractOverlap,
		domain.ErrContractMonthClosed:       workforce.ErrTraegerContractMonthClosed,
		domain.ErrHolidayWeekSchoolOverride: workforce.ErrTraegerHolidayWeekSchoolOverride,
	}[contractErr.Kind]
	if kind == nil {
		return err
	}
	return &workforce.TraegerContractError{Kind: kind, Field: contractErr.Field, Reason: contractErr.Reason,
		SchoolID: contractErr.SchoolID, SchoolName: names[contractErr.SchoolID], Day: contractErr.FirstOpenDay}
}
