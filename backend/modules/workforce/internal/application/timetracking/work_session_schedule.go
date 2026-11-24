package timetracking

import (
	"context"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// ---------------------------------------------------------------------------
// Staff work-schedule operations (issue #584: moved verbatim out of api/staff)
// ---------------------------------------------------------------------------

func (s *workSessionService) AssignScheduleTemplate(ctx context.Context, staff *StaffScheduleBinding, modelID int64) error {
	model, err := s.workModelRepo.FindByID(ctx, modelID)
	if err != nil {
		return fmt.Errorf("template not found: %w", err)
	}
	// An archived template is no longer offered (#6891). A staff member
	// already bound to it may keep it, so saving the unchanged choice works.
	alreadyBound := staff.WorkTimeModelID != nil && *staff.WorkTimeModelID == model.ID
	if model.Archived && !alreadyBound {
		return fmt.Errorf("%w: work time model %d cannot be newly assigned", workforce.ErrWorkTimeModelArchived, model.ID)
	}

	entries := modelEntriesToScheduleRows(model.Entries, model.RotationLength)
	anchor := model.RotationAnchorDate
	if err := s.scheduleRepo.ReplaceSchedule(ctx, staff.ID, entries, anchor); err != nil {
		return fmt.Errorf("write assigned schedule snapshot: %w", err)
	}

	staff.WorkTimeModelID = &model.ID
	staffAnchor := anchor
	staff.RotationAnchorDate = &staffAnchor
	if err := s.staffRepo.BindSchedule(ctx, *staff); err != nil {
		return fmt.Errorf("bind template to staff: %w", err)
	}
	return nil
}

func (s *workSessionService) ApplyCustomScheduleRows(ctx context.Context, staff *StaffScheduleBinding, entries []*WorkScheduleRow, anchor, validFrom calendar.Date) error {
	// An omitted anchor keeps the staff-level one; the new version must be
	// stamped with that same effective anchor, or it would silently re-parity
	// once the staff anchor moves.
	effective := anchor
	if effective.IsZero() && staff.RotationAnchorDate != nil {
		effective = *staff.RotationAnchorDate
	}
	// First rotational schedule with no anchor uses its start day; a later
	// template assignment would otherwise re-parity historical A/B weeks and Saldo.
	if effective.IsZero() && isRotationalSchedule(entries) {
		effective = validFrom
		if effective.IsZero() {
			effective = calendar.DateFromTime(s.now())
		}
	}
	if err := s.scheduleRepo.ReplaceScheduleWithValidFrom(ctx, staff.ID, entries, effective, validFrom); err != nil {
		return fmt.Errorf("write custom schedule: %w", err)
	}

	staff.WorkTimeModelID = nil
	if !effective.IsZero() {
		staff.RotationAnchorDate = &effective
	}
	if err := s.staffRepo.BindSchedule(ctx, *staff); err != nil {
		return fmt.Errorf("unbind template: %w", err)
	}

	return nil
}

func (s *workSessionService) SaveCustomScheduleAsTemplate(ctx context.Context, staff *StaffScheduleBinding, name string, rotation int, anchor calendar.Date, entries []*WorkTimeTemplateEntry) error {
	if anchor.IsZero() {
		anchor = calendar.DateFromTime(s.now())
	}
	model := &WorkTimeTemplate{
		Name:               name,
		RotationLength:     rotation,
		RotationAnchorDate: anchor,
	}
	if err := s.workModelRepo.Create(ctx, model, entries); err != nil {
		return err
	}
	scheduleRows := modelEntriesToScheduleRows(entries, rotation)
	if err := s.scheduleRepo.ReplaceSchedule(ctx, staff.ID, scheduleRows, anchor); err != nil {
		return fmt.Errorf("write saved template schedule snapshot: %w", err)
	}

	staff.WorkTimeModelID = &model.ID
	staff.RotationAnchorDate = &anchor
	if err := s.staffRepo.BindSchedule(ctx, *staff); err != nil {
		return fmt.Errorf("bind freshly created template: %w", err)
	}
	return nil
}

func (s *workSessionService) UpdateSchedule(ctx context.Context, staff *StaffScheduleBinding, in ScheduleUpdateInput) error {
	mode := in.Mode
	if mode == "" {
		// Backwards compatibility: missing mode + flat entries means the
		// caller still uses the single-week, no-rotation contract.
		mode = "custom"
		if in.RotationLength == 0 {
			in.RotationLength = 1
		}
	}
	if mode == "template" {
		if in.ModelID == nil || *in.ModelID == 0 {
			return scheduleValidationErrorf("model_id is required for mode=template")
		}
		if err := s.lockScheduleTemplate(ctx, *in.ModelID); err != nil {
			return err
		}
	}
	if err := s.checkScheduleRead(ctx, staff, in.ExpectedVersion); err != nil {
		return err
	}

	var err error
	switch mode {
	case "template":
		err = s.AssignScheduleTemplate(ctx, staff, *in.ModelID)
	case "custom":
		err = s.applyCustomSchedule(ctx, staff, in)
	default:
		return scheduleValidationErrorf("invalid mode %q", mode)
	}
	if err != nil {
		return err
	}
	s.broadcastTimeTrackingChanged(ctx)
	return nil
}

func (s *workSessionService) applyCustomSchedule(ctx context.Context, staff *StaffScheduleBinding, in ScheduleUpdateInput) error {
	rotation := in.RotationLength
	if rotation == 0 {
		rotation = 1
	}
	if rotation < 1 || rotation > MaxScheduleRotation {
		return scheduleValidationErrorf("rotation_length must be between 1 and %d", MaxScheduleRotation)
	}

	anchor := calendar.Date("")
	if in.RotationAnchorDate != "" {
		parsed, err := calendar.ParseDate(in.RotationAnchorDate)
		if err != nil {
			return scheduleValidationErrorf("invalid rotation_anchor_date: %v", err)
		}
		anchor = parsed
	}

	entries, templateEntries, err := buildScheduleEntries(in.Entries, rotation)
	if err != nil {
		return err
	}

	if in.SaveAsTemplateName != "" {
		if err := s.SaveCustomScheduleAsTemplate(ctx, staff, in.SaveAsTemplateName, rotation, anchor, templateEntries); err != nil {
			return fmt.Errorf("save as template: %w", err)
		}
		return nil
	}

	return s.ApplyCustomScheduleRows(ctx, staff, entries, anchor, calendar.Date(in.ValidFrom))
}

// lockScheduleTemplate holds the template a person is bound to before the
// person's gate, as an edit of the template takes it before the people it
// refreshes. Without it the edit misses a person bound meanwhile, who keeps
// the old template's snapshot while bound to the edited one. A missing
// template stays the template read's not-found.
func (s *workSessionService) lockScheduleTemplate(ctx context.Context, modelID int64) error {
	if s.templateLocks == nil {
		return errors.New("assign schedule template: the template lock is not composed")
	}
	if _, _, err := s.templateLocks.ShareLockWorkTimeModel(ctx, modelID); err != nil {
		return fmt.Errorf("lock work time model: %w", err)
	}
	return nil
}

// checkScheduleRead takes the staff member's balance gate, which every
// schedule writer holds, reads the binding and the running schedule under
// it and refuses a save whose author read another schedule (ADR 0311). The
// binding the caller read before the gate is replaced by the stored one,
// so the write starts from what was compared.
func (s *workSessionService) checkScheduleRead(ctx context.Context, staff *StaffScheduleBinding, expected string) error {
	if err := s.lockStaffBalanceWrites(ctx, staff.ID); err != nil {
		return err
	}
	assignment, err := s.staffRepo.ScheduleAssignment(ctx, staff.ID)
	if err != nil {
		return fmt.Errorf("read schedule binding: %w", err)
	}
	if assignment != nil {
		staff.WorkTimeModelID = assignment.WorkTimeModelID
		staff.RotationAnchorDate = assignment.RotationAnchorDate
	}
	rows, err := s.scheduleRepo.GetCurrentByStaffID(ctx, staff.ID)
	if err != nil {
		return fmt.Errorf("read running schedule: %w", err)
	}
	return readstate.Check(expected, storedScheduleVersion(*staff, rows))
}

// storedScheduleVersion is workforce.ScheduleVersion over the binding and
// the running rows as the schedule GET shows them.
func storedScheduleVersion(staff StaffScheduleBinding, rows []*WorkScheduleRow) string {
	canonical := make([]workforce.ScheduleVersionRow, 0, len(rows))
	for _, row := range rows {
		if row == nil {
			continue
		}
		version := workforce.ScheduleVersionRow{
			WeekIndex: row.WeekIndex, RotationLength: row.RotationLength, DayOfWeek: row.DayOfWeek,
			TargetMinutes: row.TargetMinutes, ValidFrom: row.ValidFrom.String(),
		}
		if row.StartTime != nil {
			version.StartTime = row.StartTime.Format(workforce.ClockLayout)
		}
		if row.RotationAnchorDate != nil {
			version.RotationAnchorDate = row.RotationAnchorDate.String()
		}
		canonical = append(canonical, version)
	}
	anchor := ""
	if staff.RotationAnchorDate != nil {
		anchor = staff.RotationAnchorDate.String()
	}
	return workforce.ScheduleVersion(staff.WorkTimeModelID, anchor, canonical)
}
