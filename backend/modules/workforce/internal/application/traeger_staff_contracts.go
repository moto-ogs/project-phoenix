package application

import (
	"context"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The Arbeitsverträge of a record (#4706). Every write reads the record and
// the first open day of each Einsatzort, checks the change, saves it in the
// Träger transaction under the record lock, and mirrors the Soll into each
// Einsatzort. A write that a mirror fails after has been saved; the next
// write of the record brings that school up to date.

var _ workforce.TraegerStaffContracts = (*TraegerStaff)(nil)

// contractKindLabels names the kinds in the trail.
var contractKindLabels = map[string]string{
	domain.ContractKindFullTime: "Vollzeit", domain.ContractKindPartTime: "Teilzeit", domain.ContractKindMinijob: "Minijob",
}

// CreateContract adds a contract with the first Soll of each Einsatzort.
func (t *TraegerStaff) CreateContract(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, input workforce.TraegerContractInput) (workforce.TraegerStaffRecordDetail, error) {
	contract := domain.TraegerStaffContract{OrganizationID: actor.OrganizationID, RecordID: recordID, Kind: input.Kind, StartsOn: input.StartsOn}
	if input.EndsOn != nil {
		contract.EndsOn = *input.EndsOn
	}
	for _, site := range input.Sites {
		contract.Targets = append(contract.Targets, domain.ContractTarget{
			ContractSite: domain.ContractSite{SchoolID: site.SchoolID, StaffID: site.StaffID}, ValidFrom: input.StartsOn, WeekdayMinutes: site.WeekdayMinutes,
		})
	}
	return t.writeContract(ctx, actor, recordID, false, func(scene contractScene) (contractWrite, error) {
		if err := domain.ValidateContract(contract, scene.liveSites(), scene.contracts); err != nil {
			return contractWrite{}, err
		}
		return contractWrite{
			apply: func(ctx context.Context) error {
				_, err := t.store.InsertStaffContract(ctx, contract, actor.AccountID)
				return err
			},
			changes: []domain.TraegerStaffChange{{Kind: domain.StaffChangeAdded, Field: domain.StaffChangeFieldContract, ValueText: new(contractText(contract))}},
		}, nil
	})
}

// UpdateContract changes kind and last day. A new last day must not reach
// before the first open day of any Einsatzort, nor may the former one.
func (t *TraegerStaff) UpdateContract(ctx context.Context, actor workforce.TraegerStaffActor, recordID, contractID int64, input workforce.TraegerContractTermsInput) (workforce.TraegerStaffRecordDetail, error) {
	return t.writeContract(ctx, actor, recordID, false, func(scene contractScene) (contractWrite, error) {
		current, err := scene.contract(contractID)
		if err != nil {
			return contractWrite{}, err
		}
		changed := current
		changed.Kind, changed.EndsOn = input.Kind, calendar.Date("")
		if input.EndsOn != nil {
			changed.EndsOn = *input.EndsOn
		}
		if err := validateEndChange(scene, current, changed); err != nil {
			return contractWrite{}, err
		}
		changed.Targets, changed.HolidayWeeks = targetsUntil(changed), weeksUntil(changed)
		if err := domain.ValidateContract(changed, scene.liveSites(), scene.contracts); err != nil {
			return contractWrite{}, err
		}
		return contractWrite{
			apply: func(ctx context.Context) error { return t.store.UpdateStaffContractTerms(ctx, changed) },
			changes: []domain.TraegerStaffChange{{Kind: domain.StaffChangeChanged, Field: domain.StaffChangeFieldContract,
				ValueText: new(contractText(current))}},
		}, nil
	})
}

// validateEndChange refuses a change of the last day that reaches a day an
// Einsatzort no longer lets change.
func validateEndChange(scene contractScene, current, changed domain.TraegerStaffContract) error {
	if current.EndsOn == changed.EndsOn {
		return nil
	}
	first := changed.EndsOn
	if first.IsZero() || (!current.EndsOn.IsZero() && current.EndsOn.Before(first)) {
		first = current.EndsOn
	}
	return scene.rejectClosed("ends_on", first.AddDays(1), current.Sites())
}

func targetsUntil(contract domain.TraegerStaffContract) []domain.ContractTarget {
	kept := make([]domain.ContractTarget, 0, len(contract.Targets))
	for _, target := range contract.Targets {
		if contract.Covers(target.ValidFrom) {
			kept = append(kept, target)
		}
	}
	return kept
}

func weeksUntil(contract domain.TraegerStaffContract) []domain.ContractHolidayWeek {
	kept := make([]domain.ContractHolidayWeek, 0, len(contract.HolidayWeeks))
	for _, week := range contract.HolidayWeeks {
		if contract.Covers(week.WeekStart.AddDays(domain.ContractWeekdays - 1)) {
			kept = append(kept, week)
		}
	}
	return kept
}

// ChangeContractSoll sets a new Soll for the named Einsatzorte from a day on.
// An Einsatzort that already has a Soll in this contract changes only from
// its first open day on; one that joins the contract may start earlier, the
// mirror then starts at the first open day.
func (t *TraegerStaff) ChangeContractSoll(ctx context.Context, actor workforce.TraegerStaffActor, recordID, contractID int64, input workforce.TraegerContractSollInput) (workforce.TraegerStaffRecordDetail, error) {
	return t.writeContract(ctx, actor, recordID, false, func(scene contractScene) (contractWrite, error) {
		current, err := scene.contract(contractID)
		if err != nil {
			return contractWrite{}, err
		}
		if len(input.Sites) == 0 {
			return contractWrite{}, &domain.ContractError{Kind: domain.ErrContractInvalid, Field: "sites", Reason: "name the Soll of at least one Einsatzort"}
		}
		changed, targets, err := withSoll(scene, current, input)
		if err != nil {
			return contractWrite{}, err
		}
		if err := domain.ValidateContract(changed, scene.liveSites(), scene.contracts); err != nil {
			return contractWrite{}, err
		}
		return contractWrite{
			apply: func(ctx context.Context) error {
				return t.store.ReplaceContractTargetsFrom(ctx, actor.OrganizationID, contractID, actor.AccountID, input.ValidFrom, targets)
			},
			changes: sollChanges(input, targets),
		}, nil
	})
}

func withSoll(scene contractScene, current domain.TraegerStaffContract, input workforce.TraegerContractSollInput) (domain.TraegerStaffContract, []domain.ContractTarget, error) {
	existing := current.Sites()
	changed := current
	changed.Targets = nil
	targets := make([]domain.ContractTarget, 0, len(input.Sites))
	named := make(map[domain.ContractSite]bool, len(input.Sites))
	for _, site := range input.Sites {
		contractSite := domain.ContractSite{SchoolID: site.SchoolID, StaffID: site.StaffID}
		if named[contractSite] {
			return changed, nil, &domain.ContractError{Kind: domain.ErrContractInvalid, Field: "sites", Reason: "an Einsatzort is named twice"}
		}
		named[contractSite] = true
		if containsSite(existing, contractSite) {
			if err := scene.rejectClosed("valid_from", input.ValidFrom, []domain.ContractSite{contractSite}); err != nil {
				return changed, nil, err
			}
		}
		targets = append(targets, domain.ContractTarget{ContractSite: contractSite, ValidFrom: input.ValidFrom, WeekdayMinutes: site.WeekdayMinutes})
	}
	for _, target := range current.Targets {
		if !named[target.ContractSite] || target.ValidFrom.Before(input.ValidFrom) {
			changed.Targets = append(changed.Targets, target)
		}
	}
	changed.Targets = append(changed.Targets, targets...)
	return changed, targets, nil
}

func containsSite(sites []domain.ContractSite, site domain.ContractSite) bool {
	for _, candidate := range sites {
		if candidate == site {
			return true
		}
	}
	return false
}

func sollChanges(input workforce.TraegerContractSollInput, targets []domain.ContractTarget) []domain.TraegerStaffChange {
	changes := make([]domain.TraegerStaffChange, 0, len(targets))
	for _, target := range targets {
		changes = append(changes, domain.TraegerStaffChange{
			Kind: domain.StaffChangeChanged, Field: domain.StaffChangeFieldContractSoll, SchoolID: new(target.SchoolID),
			ValueText: new(fmt.Sprintf("ab %s: %s", input.ValidFrom.Format("02.01.2006"), weekText(target.WeekdayMinutes))),
		})
	}
	return changes
}

// AddHolidayWeeks sets the Ferien-Soll of every week of a range at one
// Einsatzort. A week the school has a Sonderarbeitszeit of its own in is
// refused before anything changes.
func (t *TraegerStaff) AddHolidayWeeks(ctx context.Context, actor workforce.TraegerStaffActor, recordID, contractID int64, input workforce.TraegerHolidayWeeksInput) (workforce.TraegerStaffRecordDetail, error) {
	return t.writeContract(ctx, actor, recordID, true, func(scene contractScene) (contractWrite, error) {
		current, err := scene.contract(contractID)
		if err != nil {
			return contractWrite{}, err
		}
		weeks, err := holidayWeeks(input)
		if err != nil {
			return contractWrite{}, err
		}
		site := domain.ContractSite{SchoolID: input.SchoolID, StaffID: input.StaffID}
		if err := scene.rejectClosed("week_start", weeks[0].WeekStart, []domain.ContractSite{site}); err != nil {
			return contractWrite{}, err
		}
		if err := rejectOwnWeeks(scene.ownWeeks[input.SchoolID], weeks); err != nil {
			return contractWrite{}, err
		}
		changed := current
		changed.HolidayWeeks = append(append([]domain.ContractHolidayWeek{}, current.HolidayWeeks...), weeks...)
		if err := domain.ValidateContract(changed, scene.liveSites(), scene.contracts); err != nil {
			return contractWrite{}, err
		}
		return contractWrite{
			apply: func(ctx context.Context) error {
				return t.store.InsertContractHolidayWeeks(ctx, actor.OrganizationID, contractID, actor.AccountID, weeks)
			},
			changes: weekChanges(domain.StaffChangeAdded, weeks),
		}, nil
	})
}

// maxHolidayWeeks bounds one range: a school year has no longer holidays.
const maxHolidayWeeks = 8

func holidayWeeks(input workforce.TraegerHolidayWeeksInput) ([]domain.ContractHolidayWeek, error) {
	if input.FromWeek.IsZero() || input.ToWeek.Before(input.FromWeek) {
		return nil, &domain.ContractError{Kind: domain.ErrContractInvalid, Field: "to_week", Reason: "the last week lies before the first"}
	}
	var weeks []domain.ContractHolidayWeek
	for start := input.FromWeek; !start.After(input.ToWeek); start = start.AddDays(7) {
		weeks = append(weeks, domain.ContractHolidayWeek{
			ContractSite: domain.ContractSite{SchoolID: input.SchoolID, StaffID: input.StaffID}, WeekStart: start, WeekdayMinutes: input.WeekdayMinutes,
		})
		if len(weeks) > maxHolidayWeeks {
			return nil, &domain.ContractError{Kind: domain.ErrContractInvalid, Field: "to_week", Reason: fmt.Sprintf("at most %d weeks at once", maxHolidayWeeks)}
		}
	}
	return weeks, nil
}

func rejectOwnWeeks(own []domain.StaffTargetOverride, weeks []domain.ContractHolidayWeek) error {
	for _, week := range weeks {
		start, end := week.WeekStart.String(), week.WeekStart.AddDays(domain.ContractWeekdays-1).String()
		for _, other := range own {
			if other.StartDate <= end && start <= other.EndDate {
				return &domain.ContractError{Kind: domain.ErrHolidayWeekSchoolOverride, Field: "week_start", SchoolID: week.SchoolID, FirstOpenDay: week.WeekStart,
					Reason: fmt.Sprintf("school %d keeps a Sonderarbeitszeit from %s to %s", week.SchoolID, other.StartDate, other.EndDate)}
			}
		}
	}
	return nil
}

func weekChanges(kind string, weeks []domain.ContractHolidayWeek) []domain.TraegerStaffChange {
	changes := make([]domain.TraegerStaffChange, 0, len(weeks))
	for _, week := range weeks {
		changes = append(changes, domain.TraegerStaffChange{
			Kind: kind, Field: domain.StaffChangeFieldHolidayWeek, SchoolID: new(week.SchoolID),
			ValueText: new(fmt.Sprintf("Woche ab %s: %s", week.WeekStart.Format("02.01.2006"), weekText(week.WeekdayMinutes))),
		})
	}
	return changes
}

// DeleteHolidayWeek removes one holiday week of one Einsatzort.
func (t *TraegerStaff) DeleteHolidayWeek(ctx context.Context, actor workforce.TraegerStaffActor, recordID, contractID int64, site workforce.TraegerContractSite, weekStart calendar.Date) (workforce.TraegerStaffRecordDetail, error) {
	return t.writeContract(ctx, actor, recordID, false, func(scene contractScene) (contractWrite, error) {
		current, err := scene.contract(contractID)
		if err != nil {
			return contractWrite{}, err
		}
		var found *domain.ContractHolidayWeek
		for _, week := range current.HolidayWeeks {
			if week.SchoolID == site.SchoolID && week.WeekStart == weekStart {
				found = &week
			}
		}
		if found == nil {
			return contractWrite{}, domain.ErrContractMissing
		}
		if err := scene.rejectClosed("week_start", weekStart, []domain.ContractSite{found.ContractSite}); err != nil {
			return contractWrite{}, err
		}
		return contractWrite{
			apply: func(ctx context.Context) error {
				_, err := t.store.DeleteContractHolidayWeek(ctx, actor.OrganizationID, contractID, site.SchoolID, weekStart)
				return err
			},
			changes: weekChanges(domain.StaffChangeRemoved, []domain.ContractHolidayWeek{*found}),
		}, nil
	})
}

// DeleteContract removes a contract entered by mistake. It must not have
// started before the first open day of any Einsatzort; a contract that ran
// ends with a last day instead. Each Einsatzort no other contract names gets
// its own schedule back from the contract's first day on.
func (t *TraegerStaff) DeleteContract(ctx context.Context, actor workforce.TraegerStaffActor, recordID, contractID int64) (workforce.TraegerStaffRecordDetail, error) {
	return t.writeContract(ctx, actor, recordID, false, func(scene contractScene) (contractWrite, error) {
		current, err := scene.contract(contractID)
		if err != nil {
			return contractWrite{}, err
		}
		if err := scene.rejectClosed("starts_on", current.StartsOn, current.Sites()); err != nil {
			return contractWrite{}, err
		}
		released := make(map[domain.ContractSite]calendar.Date)
		for _, site := range current.Sites() {
			released[site] = current.StartsOn
		}
		return contractWrite{
			released: released,
			apply: func(ctx context.Context) error {
				return t.store.DeleteStaffContract(ctx, actor.OrganizationID, contractID)
			},
			changes: []domain.TraegerStaffChange{{Kind: domain.StaffChangeRemoved, Field: domain.StaffChangeFieldContract,
				ValueText: new(contractText(current))}},
		}, nil
	})
}

// contractWrite is one checked change: what to save, its trail and the
// Einsatzorte that get their own schedule back, from which day.
type contractWrite struct {
	apply    func(context.Context) error
	changes  []domain.TraegerStaffChange
	released map[domain.ContractSite]calendar.Date
}

// writeContract runs plan against the scene, saves its write with the trail
// under the record lock and mirrors the record into its Einsatzorte. The
// scene is read again under the lock, so a concurrent write of the same
// record cannot slip between check and save.
func (t *TraegerStaff) writeContract(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, withOwnWeeks bool, plan func(contractScene) (contractWrite, error)) (workforce.TraegerStaffRecordDetail, error) {
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, err
	}
	names := schoolNames(schools)
	scene, err := t.loadScene(ctx, actor, recordID, withOwnWeeks)
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, publicContractError(err, names)
	}
	var released map[domain.ContractSite]calendar.Date
	err = t.released(ctx, actor, func(ctx context.Context) error {
		locked, err := t.store.FindStaffRecord(ctx, actor.OrganizationID, recordID, true)
		if err != nil {
			return err
		}
		if scene.contracts, err = t.store.ListStaffContracts(ctx, actor.OrganizationID, recordID); err != nil {
			return err
		}
		scene.record = locked
		write, err := plan(scene)
		if err != nil {
			return err
		}
		if err := write.apply(ctx); err != nil {
			return err
		}
		released = write.released
		for i := range write.changes {
			write.changes[i].RecordID, write.changes[i].AccountID = recordID, actor.AccountID
		}
		return t.store.AppendStaffChanges(ctx, actor.OrganizationID, write.changes)
	})
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, publicContractError(err, names)
	}
	failed, err := t.mirror(ctx, actor, recordID, released)
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, publicContractError(err, names)
	}
	detail, err := t.Record(ctx, actor, recordID)
	for _, schoolID := range failed {
		detail.UnsyncedSchools = append(detail.UnsyncedSchools, names[schoolID])
	}
	return detail, err
}

// contractText names a contract in the trail: kind and validity.
func contractText(contract domain.TraegerStaffContract) string {
	text := fmt.Sprintf("%s ab %s", contractKindLabels[contract.Kind], contract.StartsOn.Format("02.01.2006"))
	if !contract.EndsOn.IsZero() {
		text += " bis " + contract.EndsOn.Format("02.01.2006")
	}
	return text
}

// weekText names a Soll of Monday to Friday in hours, days with the same
// hours joined: „Mo–Do je 7 Std. · Fr 5 Std. (33 Std. pro Woche)“.
func weekText(minutes []int) string {
	days := []string{"Mo", "Di", "Mi", "Do", "Fr"}
	var parts []string
	for start := 0; start < len(minutes) && start < len(days); {
		end := start
		for end+1 < len(minutes) && end+1 < len(days) && minutes[end+1] == minutes[start] {
			end++
		}
		parts = append(parts, dayRunText(days[start], days[end], start == end, minutes[start]))
		start = end + 1
	}
	return strings.Join(parts, " · ") + " (" + hoursText(domain.WeeklyMinutes(minutes)) + " pro Woche)"
}

func dayRunText(first, last string, single bool, minutes int) string {
	switch {
	case single && minutes == 0:
		return first + " frei"
	case single:
		return first + " " + hoursText(minutes)
	case minutes == 0:
		return first + "–" + last + " frei"
	default:
		return first + "–" + last + " je " + hoursText(minutes)
	}
}

func hoursText(minutes int) string {
	hours, rest := minutes/60, minutes%60
	if rest == 0 {
		return fmt.Sprintf("%d Std.", hours)
	}
	return strings.Replace(fmt.Sprintf("%.2f Std.", float64(minutes)/60), ".", ",", 1)
}
