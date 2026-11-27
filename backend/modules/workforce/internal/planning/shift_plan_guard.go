package planning

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The working-time check of the Einsatzplanung (#4708, ADR 0242). A shift
// write for a person with a Personalakte reads the shifts and the Soll of
// all Einsatzorte through the Workforce database functions, in the school's
// own tenant transaction, and holds the record until the write commits. An
// overlap with another Einsatzort is refused; a working-time violation
// needs the planner's confirmation, and a reason where the rule asks for
// one. People without a Personalakte keep the checks of their school.

// PlanCheckReads are the reads of the check.
type PlanCheckReads interface {
	ShiftPlanRecords(ctx context.Context, staffIDs []int64) (map[int64]int64, error)
	ShiftPlanSlots(ctx context.Context, recordIDs []int64, from, to calendar.Date, lock bool) ([]workforce.ShiftPlanSlot, error)
	ShiftPlanSoll(ctx context.Context, recordIDs []int64, from, to calendar.Date) ([]workforce.ShiftPlanSollDay, error)
}

// PlanRuleSettings answers the Träger values of the Einsatzplanung for the
// school of the tenant transaction: whether shifts are planned in moto, and
// the working-time rules.
type PlanRuleSettings interface {
	StaffPlanningRules(ctx context.Context) (enabled bool, maxDailyMinutes, minRestMinutes int, checkBreaks bool, err error)
}

// WorkingTimeOverrideAudit appends the Änderungsprotokoll entry of a shift
// planned despite a warning, in the write's tenant transaction.
type WorkingTimeOverrideAudit func(context.Context, workforce.ShiftWorkingTimeOverride) error

// planGuard is the check. A nil settings reader applies the registry
// defaults: planning on, the limits of the ArbZG.
type planGuard struct {
	reads    TraegerSiteReads
	settings PlanRuleSettings
	holidays HolidayDatesReader
	audit    WorkingTimeOverrideAudit
}

// planOverride is a confirmed violation the write records once it has the
// shift's id.
type planOverride struct {
	warnings []workforce.ShiftWorkingTimeWarning
	reason   string
}

func NewPlanGuard(reads TraegerSiteReads, settings PlanRuleSettings, holidays HolidayDatesReader, audit WorkingTimeOverrideAudit) *planGuard {
	return &planGuard{reads: reads, settings: settings, holidays: holidays, audit: audit}
}

// ensurePlanningOn refuses a new shift while the Träger plans outside moto.
func (g *planGuard) ensurePlanningOn(ctx context.Context) error {
	if g == nil || g.settings == nil {
		return nil
	}
	enabled, _, _, _, err := g.settings.StaffPlanningRules(ctx)
	if err != nil {
		return fmt.Errorf("resolve staff planning setting: %w", err)
	}
	if !enabled {
		return workforce.ErrShiftPlanningOff
	}
	return nil
}

func (g *planGuard) rules(ctx context.Context) (domain.WorkingTimeRules, error) {
	if g.settings == nil {
		return domain.StatutoryWorkingTimeRules(), nil
	}
	_, maxDaily, minRest, breaks, err := g.settings.StaffPlanningRules(ctx)
	if err != nil {
		return domain.WorkingTimeRules{}, fmt.Errorf("resolve working-time rules: %w", err)
	}
	return domain.WorkingTimeRules{MaxDailyMinutes: maxDaily, MinRestMinutes: minRest, CheckBreaks: breaks}, nil
}

// check checks replacing before with after, the versions of one person's
// shifts at this school, under the confirmation the write carries. It
// returns the override the write must record, nil when nothing needs one.
func (g *planGuard) check(ctx context.Context, staffID int64, before, after []*workforce.ShiftRecord, confirmation workforce.WorkingTimeConfirmation) (*planOverride, error) {
	if g == nil {
		return nil, nil
	}
	candidates := activePlanSlots(after)
	if len(candidates) == 0 {
		return nil, nil
	}
	records, err := g.reads.ShiftPlanRecords(ctx, []int64{staffID})
	if err != nil {
		return nil, fmt.Errorf("read personalakte of staff %d: %w", staffID, err)
	}
	recordID, ok := records[staffID]
	if !ok {
		return nil, nil
	}
	from, to := planWindow(slices.Concat(candidates, activePlanSlots(before)))
	slots, err := g.reads.ShiftPlanSlots(ctx, []int64{recordID}, from, to, true)
	if err != nil {
		return nil, fmt.Errorf("read shifts of personalakte %d: %w", recordID, err)
	}
	soll, err := g.weeklySoll(ctx, recordID, from, to)
	if err != nil {
		return nil, err
	}
	rules, err := g.rules(ctx)
	if err != nil {
		return nil, err
	}
	verdict := domain.CheckPlan(rules, unchangedPlanSlots(slots, before, after), activePlanSlots(before), candidates, soll)
	if len(verdict.Overlaps) > 0 {
		other := verdict.Overlaps[0]
		return nil, &workforce.ShiftOtherSiteError{Date: other.Date, StartTime: minuteClock(other.Start), EndTime: minuteClock(other.End)}
	}
	return confirmOverride(verdict, confirmation)
}

// confirmOverride turns the warnings into the refusal of an unconfirmed
// write, or into the override a confirmed write records.
func confirmOverride(verdict domain.PlanVerdict, confirmation workforce.WorkingTimeConfirmation) (*planOverride, error) {
	if len(verdict.Warnings) == 0 {
		return nil, nil
	}
	warnings := publicWarnings(verdict.Warnings)
	reason := strings.TrimSpace(confirmation.Reason)
	if len([]rune(reason)) > workforce.MaxWorkingTimeReasonLength {
		return nil, &workforce.InvalidStaffShiftError{Reason: fmt.Sprintf("the reason must not exceed %d characters", workforce.MaxWorkingTimeReasonLength)}
	}
	if !confirmation.Confirmed || (verdict.NeedsReason() && reason == "") {
		return nil, &workforce.ShiftWorkingTimeError{Warnings: warnings, ReasonRequired: verdict.NeedsReason()}
	}
	return &planOverride{warnings: warnings, reason: reason}, nil
}

// weeklySoll sums the Soll of the Arbeitsverträge per week over every
// Einsatzort. The school's holidays and closing days count no Soll of its
// own share; the other schools' shares count in full, because this school
// cannot read their calendars (ADR 0242 point 2).
func (g *planGuard) weeklySoll(ctx context.Context, recordID int64, from, to calendar.Date) (map[string]int, error) {
	days, err := g.reads.ShiftPlanSoll(ctx, []int64{recordID}, from, to)
	if err != nil {
		return nil, fmt.Errorf("read soll of personalakte %d: %w", recordID, err)
	}
	holidays := map[calendar.Date]bool{}
	if g.holidays != nil && len(days) > 0 {
		if holidays, err = g.holidays.HolidayDates(ctx, from, to); err != nil {
			return nil, fmt.Errorf("read holidays: %w", err)
		}
	}
	return WeeklySoll(days, holidays), nil
}

// WeeklySoll sums Soll days per ISO week (keyed by its Monday), leaving out
// the holidays and closing days of the school's own share.
func WeeklySoll(days []workforce.ShiftPlanSollDay, holidays map[calendar.Date]bool) map[string]int {
	weeks := map[string]int{}
	for _, d := range days {
		if d.Own && holidays[d.Date] {
			continue
		}
		weeks[d.Date.StartOfISOWeek().String()] += d.Minutes
	}
	return weeks
}

// record appends the Änderungsprotokoll entry of a confirmed violation,
// naming the planner: the staff member of the school, or the account of the
// Personalverwaltung for a shift the Träger-Portal planned.
func (g *planGuard) record(ctx context.Context, override *planOverride, shift *workforce.ShiftRecord, actorAccountID *int64, actorStaffID int64) error {
	if g == nil || override == nil {
		return nil
	}
	if g.audit == nil {
		// A confirmed violation is never written without its entry (#4708).
		return errors.New("workforce: the Änderungsprotokoll of a working-time override is not bound")
	}
	warnings, err := json.Marshal(override.warnings)
	if err != nil {
		return fmt.Errorf("encode working-time warnings: %w", err)
	}
	event := workforce.ShiftWorkingTimeOverride{
		OccurrenceDate: shift.Date, StartTime: calendar.NormalizeWallClock(shift.StartTime), StaffShiftID: shift.ID,
		SubjectStaffID: shift.StaffID, ActorAccountID: actorAccountID, Reason: override.reason, Warnings: warnings,
	}
	if shift.TraegerAccountID != nil {
		event.ActorAccountID = shift.TraegerAccountID
	}
	if actorStaffID > 0 {
		event.ActorStaffID = &actorStaffID
	}
	if err := g.audit(ctx, event); err != nil {
		return fmt.Errorf("log working-time override: %w", err)
	}
	return nil
}

// planWindow covers the ISO weeks of the slots and the day before and after
// each, so the rest and the weekly Soll see every neighbour.
func planWindow(slots []domain.PlanSlot) (calendar.Date, calendar.Date) {
	from, to := slots[0].Date, slots[0].Date
	for _, s := range slots[1:] {
		if s.Date.Before(from) {
			from = s.Date
		}
		if s.Date.After(to) {
			to = s.Date
		}
	}
	start := from.AddDays(-1)
	if week := from.StartOfISOWeek(); week.Before(start) {
		start = week
	}
	end := to.AddDays(1)
	if week := to.StartOfISOWeek().AddDays(6); week.After(end) {
		end = week
	}
	return start, end
}

// unchangedPlanSlots are the slots of all Einsatzorte except the versions
// the write replaces or adds; a school sees its own slots with their id.
func unchangedPlanSlots(slots []workforce.ShiftPlanSlot, before, after []*workforce.ShiftRecord) []domain.PlanSlot {
	changed := map[int64]bool{}
	for _, shift := range slices.Concat(before, after) {
		if shift != nil && shift.ID > 0 {
			changed[shift.ID] = true
		}
	}
	result := make([]domain.PlanSlot, 0, len(slots))
	for _, s := range slots {
		if s.ShiftID > 0 && changed[s.ShiftID] {
			continue
		}
		result = append(result, domain.PlanSlot{SchoolID: s.SchoolID, ShiftID: s.ShiftID, Date: s.Date, Start: s.StartMinute,
			End: s.EndMinute, BreakMinutes: s.BreakMinutes, Own: s.SchoolID != 0})
	}
	return result
}

func activePlanSlots(shifts []*workforce.ShiftRecord) []domain.PlanSlot {
	result := make([]domain.PlanSlot, 0, len(shifts))
	for _, shift := range shifts {
		if shift == nil || shift.Cancelled {
			continue
		}
		result = append(result, domain.PlanSlot{
			ShiftID: shift.ID, Date: shift.Date, Start: clockMinute(shift.StartTime), End: clockMinute(shift.EndTime),
			BreakMinutes: shift.BreakMinutes, Own: true,
		})
	}
	return result
}

func publicWarnings(warnings []domain.WorkingTimeWarning) []workforce.ShiftWorkingTimeWarning {
	result := make([]workforce.ShiftWorkingTimeWarning, 0, len(warnings))
	for _, w := range warnings {
		result = append(result, workforce.ShiftWorkingTimeWarning{Kind: w.Kind, Date: w.Date, Minutes: w.Minutes, Limit: w.Limit, NeedsReason: w.NeedsReason})
	}
	return result
}

func clockMinute(value time.Time) int {
	normalized := calendar.NormalizeWallClock(value)
	return normalized.Hour()*60 + normalized.Minute()
}

func minuteClock(minute int) string {
	return fmt.Sprintf("%02d:%02d", minute/60, minute%60)
}

func valueOrZero(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

// checkSeries checks the occurrences a series write materializes. An
// occurrence that overlaps a shift at another Einsatzort is left out and
// reported like one that overlaps a shift at this school; the others need
// the confirmation of their working-time warnings.
func (g *planGuard) checkSeries(ctx context.Context, staffID int64, candidates []*workforce.ShiftRecord, confirmation workforce.WorkingTimeConfirmation) ([]*workforce.ShiftRecord, []calendar.Date, *planOverride, error) {
	if g == nil || len(candidates) == 0 {
		return candidates, nil, nil, nil
	}
	records, err := g.reads.ShiftPlanRecords(ctx, []int64{staffID})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("read personalakte of staff %d: %w", staffID, err)
	}
	recordID, ok := records[staffID]
	if !ok {
		return candidates, nil, nil, nil
	}
	from, to := planWindow(activePlanSlots(candidates))
	slots, err := g.reads.ShiftPlanSlots(ctx, []int64{recordID}, from, to, true)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("read shifts of personalakte %d: %w", recordID, err)
	}
	unchanged := unchangedPlanSlots(slots, nil, nil)
	kept := make([]*workforce.ShiftRecord, 0, len(candidates))
	var skipped []calendar.Date
	for _, candidate := range candidates {
		if verdict := domain.CheckPlan(domain.WorkingTimeRules{}, unchanged, nil, activePlanSlots([]*workforce.ShiftRecord{candidate}), nil); len(verdict.Overlaps) > 0 {
			skipped = append(skipped, candidate.Date)
			continue
		}
		kept = append(kept, candidate)
	}
	soll, err := g.weeklySoll(ctx, recordID, from, to)
	if err != nil {
		return nil, nil, nil, err
	}
	rules, err := g.rules(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	override, err := confirmOverride(domain.CheckPlan(rules, unchanged, nil, activePlanSlots(kept), soll), confirmation)
	return kept, skipped, override, err
}

// recordSeries appends the override of a series write, anchored on the
// first occurrence it concerns. actorAccountID names the Träger-Büro
// account of a series planned without a staff member (#7818).
func (g *planGuard) recordSeries(ctx context.Context, override *planOverride, written []*workforce.ShiftRecord, actorAccountID *int64, actorStaffID int64) error {
	if override == nil || len(written) == 0 {
		return nil
	}
	anchor := written[0]
	for _, shift := range written {
		if shift.Date.StartOfISOWeek() == override.warnings[0].Date.StartOfISOWeek() {
			anchor = shift
			break
		}
	}
	return g.record(ctx, override, anchor, actorAccountID, actorStaffID)
}
