package application

import (
	"context"
	"log/slog"
	"time"
)

const (
	staffQualificationRemindersStartupDelay = 70 * time.Second
	// staffQualificationRemindersInterval: a reminder is due for a whole
	// calendar day and claimed once, so an hourly look is enough to reach it
	// on its day and to repeat one the notification window held back.
	staffQualificationRemindersInterval = time.Hour
	staffQualificationRemindersTimeout  = 10 * time.Minute
)

// scheduleStaffQualificationRemindersTask sends the reminders of expiring
// staff qualifications of every school (#4808).
func (s *Scheduler) scheduleStaffQualificationRemindersTask() {
	if s.staffQualificationReminders == nil {
		s.getLogger().Info("staff qualification reminders not configured")
		return
	}
	s.registerTask("staff-qualification-reminders", "1h-poll", s.runStaffQualificationRemindersTask)
}

func (s *Scheduler) runStaffQualificationRemindersTask(task *ScheduledTask) {
	s.runIntervalPolling(task, "panic in staff qualification reminders task",
		"staff qualification reminders using interval polling",
		staffQualificationRemindersStartupDelay,
		func() time.Duration { return staffQualificationRemindersInterval },
		s.checkAndRunStaffQualificationReminders,
	)
}

func (s *Scheduler) checkAndRunStaffQualificationReminders(ctx context.Context, task *ScheduledTask) {
	task.mu.Lock()
	if task.Running {
		task.mu.Unlock()
		return
	}
	task.Running = true
	task.mu.Unlock()
	defer func() {
		task.mu.Lock()
		task.Running = false
		task.mu.Unlock()
	}()

	ctx, cancel := s.taskContext(ctx, staffQualificationRemindersTimeout)
	defer cancel()

	if err := s.forEachTenant(ctx, "staff-qualification-reminders", s.staffQualificationReminders); err != nil {
		s.getLogger().Error("staff qualification reminders failed",
			slog.String("error", err.Error()),
		)
	}
}

const traegerStaffProofRemindersStartupDelay = 80 * time.Second

// scheduleTraegerStaffProofRemindersTask warns before the proofs of the
// Träger's Personalstamm expire (#4707), hourly like the school's reminders.
func (s *Scheduler) scheduleTraegerStaffProofRemindersTask() {
	s.registerTask("traeger-staff-proof-reminders", "1h-poll", s.runTraegerStaffProofRemindersTask)
}

func (s *Scheduler) runTraegerStaffProofRemindersTask(task *ScheduledTask) {
	s.runIntervalPolling(task, "panic in traeger staff proof reminders task",
		"traeger staff proof reminders using interval polling",
		traegerStaffProofRemindersStartupDelay,
		func() time.Duration { return staffQualificationRemindersInterval },
		s.checkAndRunTraegerStaffProofReminders,
	)
}

func (s *Scheduler) checkAndRunTraegerStaffProofReminders(ctx context.Context, task *ScheduledTask) {
	task.mu.Lock()
	if task.Running {
		task.mu.Unlock()
		return
	}
	task.Running = true
	task.mu.Unlock()
	defer func() {
		task.mu.Lock()
		task.Running = false
		task.mu.Unlock()
	}()

	ctx, cancel := s.taskContext(ctx, staffQualificationRemindersTimeout)
	defer cancel()

	if err := s.traegerStaffProofReminders(ctx); err != nil {
		s.getLogger().Error("traeger staff proof reminders failed",
			slog.String("error", err.Error()),
		)
	}
}
