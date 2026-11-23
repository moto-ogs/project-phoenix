package application

import (
	"context"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain"
	internalports "github.com/moto-ogs/project-phoenix/modules/timetable/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// Homework of the classes and the OGS feedback on it (#4796). The service
// validates and normalizes; which class and which child the caller may reach
// is decided by the class-day projection and the Lernzeit roster before.
// Every operation sees only the homework slice of the owner's store.

// homeworkOperation runs one homework operation in the owner's transaction
// and observation, over the homework store alone.
func (s *Service) homeworkOperation(ctx context.Context, operation string, callback func(context.Context, internalports.HomeworkStore, *domain.OperationStats) error) error {
	return s.runWrite(ctx, operation, false, func(ctx context.Context, stats *domain.OperationStats) error {
		return callback(ctx, s.store, stats)
	})
}

// existingHomework runs a change or delete of an entry of the class and
// turns a missing row into ErrHomeworkNotFound.
func (s *Service) existingHomework(ctx context.Context, operation string, write func(context.Context, internalports.HomeworkStore) (bool, domain.OperationStats, error)) error {
	return s.homeworkOperation(ctx, operation, func(ctx context.Context, store internalports.HomeworkStore, stats *domain.OperationStats) error {
		found, queryStats, err := write(ctx, store)
		stats.Add(queryStats)
		if err == nil && !found {
			return timetable.ErrHomeworkNotFound
		}
		return err
	})
}

func (s *Service) ClassHomework(ctx context.Context, classes []string, date calendar.Date) (result []timetable.HomeworkEntry, err error) {
	if _, err := calendar.ParseDate(date.String()); err != nil {
		return nil, fmt.Errorf("%w: %w", timetable.ErrInvalidHomework, err)
	}
	keys := classArrivalKeys(classes)
	if len(keys) == 0 {
		return []timetable.HomeworkEntry{}, nil
	}
	err = s.homeworkOperation(ctx, "list_class_homework", func(ctx context.Context, store internalports.HomeworkStore, stats *domain.OperationStats) error {
		values, queryStats, listErr := store.ListClassHomework(ctx, keys, date)
		stats.Add(queryStats)
		result = values
		return listErr
	})
	return result, err
}

func (s *Service) HomeworkFeedbackOn(ctx context.Context, date calendar.Date, studentIDs []int64) (result []timetable.HomeworkFeedback, err error) {
	if _, err := calendar.ParseDate(date.String()); err != nil {
		return nil, fmt.Errorf("%w: %w", timetable.ErrInvalidHomeworkFeedback, err)
	}
	ids := positiveIDs(studentIDs)
	if len(ids) == 0 {
		return []timetable.HomeworkFeedback{}, nil
	}
	err = s.homeworkOperation(ctx, "list_homework_feedback", func(ctx context.Context, store internalports.HomeworkStore, stats *domain.OperationStats) error {
		values, queryStats, listErr := store.ListHomeworkFeedback(ctx, date, ids)
		stats.Add(queryStats)
		result = values
		return listErr
	})
	return result, err
}

func (s *Service) AddHomework(ctx context.Context, in timetable.HomeworkInput) (result timetable.HomeworkEntry, err error) {
	subject, description, err := timetable.NormalizedHomework(in.Subject, in.Description)
	if err != nil {
		return timetable.HomeworkEntry{}, err
	}
	in.SchoolClass = strings.TrimSpace(in.SchoolClass)
	if _, dateErr := calendar.ParseDate(in.Date.String()); dateErr != nil || in.SchoolClass == "" || in.StaffID <= 0 {
		return timetable.HomeworkEntry{}, timetable.ErrInvalidHomework
	}
	in.Subject, in.Description = subject, description
	err = s.homeworkOperation(ctx, "add_class_homework", func(ctx context.Context, store internalports.HomeworkStore, stats *domain.OperationStats) error {
		value, queryStats, insertErr := store.InsertClassHomework(ctx, in)
		stats.Add(queryStats)
		result = value
		return insertErr
	})
	return result, err
}

func (s *Service) ChangeHomework(ctx context.Context, in timetable.HomeworkChange) (result timetable.HomeworkEntry, err error) {
	subject, description, err := timetable.NormalizedHomework(in.Subject, in.Description)
	if err != nil {
		return timetable.HomeworkEntry{}, err
	}
	key, err := homeworkClassKey(in.ID, in.SchoolClass)
	if err != nil {
		return timetable.HomeworkEntry{}, err
	}
	in.Subject, in.Description = subject, description
	err = s.homeworkOperation(ctx, "change_class_homework", func(ctx context.Context, store internalports.HomeworkStore, stats *domain.OperationStats) error {
		// The row lock comes first: the check and the update see the entry
		// no other change of it is writing (ADR 0311).
		stored, found, lockStats, lockErr := store.LockClassHomework(ctx, timetable.HomeworkRef{ID: in.ID, SchoolClass: in.SchoolClass}, key)
		stats.Add(lockStats)
		if lockErr != nil {
			return lockErr
		}
		if !found {
			return timetable.ErrHomeworkNotFound
		}
		if checkErr := readstate.Check(in.ExpectedVersion, timetable.HomeworkVersion(stored)); checkErr != nil {
			return checkErr
		}
		value, updated, queryStats, updateErr := store.UpdateClassHomework(ctx, in, key)
		stats.Add(queryStats)
		if updateErr == nil && !updated {
			return timetable.ErrHomeworkNotFound
		}
		result = value
		return updateErr
	})
	return result, err
}

func (s *Service) DeleteHomework(ctx context.Context, ref timetable.HomeworkRef) error {
	key, err := homeworkClassKey(ref.ID, ref.SchoolClass)
	if err != nil {
		return err
	}
	return s.existingHomework(ctx, "delete_class_homework", func(ctx context.Context, store internalports.HomeworkStore) (bool, domain.OperationStats, error) {
		return store.DeleteClassHomework(ctx, ref, key)
	})
}

// RecordHomeworkFeedback stores the feedback after checking that the child's
// class has homework on the day, in the same transaction.
func (s *Service) RecordHomeworkFeedback(ctx context.Context, in timetable.HomeworkFeedbackInput) (result timetable.HomeworkFeedback, err error) {
	note, err := timetable.NormalizedHomeworkFeedback(in.Status, in.Note)
	if err != nil {
		return timetable.HomeworkFeedback{}, err
	}
	keys := classArrivalKeys([]string{in.SchoolClass})
	if _, dateErr := calendar.ParseDate(in.Date.String()); dateErr != nil || len(keys) == 0 || in.StudentID <= 0 {
		return timetable.HomeworkFeedback{}, timetable.ErrInvalidHomeworkFeedback
	}
	in.Note = note
	err = s.homeworkOperation(ctx, "record_homework_feedback", func(ctx context.Context, store internalports.HomeworkStore, stats *domain.OperationStats) error {
		homework, queryStats, listErr := store.ListClassHomework(ctx, keys, in.Date)
		stats.Add(queryStats)
		if listErr != nil {
			return listErr
		}
		if len(homework) == 0 {
			return timetable.ErrHomeworkFeedbackWithoutHomework
		}
		// The child's day is locked before its feedback is read, also when
		// there is none yet, so two first feedbacks do not both pass the
		// check (ADR 0311).
		stored, lockStats, lockErr := store.LockHomeworkFeedback(ctx, in.StudentID, in.Date)
		stats.Add(lockStats)
		if lockErr != nil {
			return lockErr
		}
		if checkErr := readstate.Check(in.ExpectedVersion, timetable.HomeworkFeedbackVersion(stored)); checkErr != nil {
			return checkErr
		}
		value, upsertStats, upsertErr := store.UpsertHomeworkFeedback(ctx, in)
		stats.Add(upsertStats)
		result = value
		return upsertErr
	})
	return result, err
}

// DeleteExpiredHomework deletes what a window of retentionDays no longer
// keeps, counted back from the Berlin calendar day.
func (s *Service) DeleteExpiredHomework(ctx context.Context, retentionDays int) (deleted int, err error) {
	if retentionDays <= 0 {
		return 0, fmt.Errorf("%w, got %d", timetable.ErrHomeworkRetentionWindow, retentionDays)
	}
	cutoff := calendar.Date(s.today()).AddDays(-retentionDays)
	err = s.homeworkOperation(ctx, "delete_expired_homework", func(ctx context.Context, store internalports.HomeworkStore, stats *domain.OperationStats) error {
		count, queryStats, deleteErr := store.DeleteHomeworkBefore(ctx, cutoff)
		stats.Add(queryStats)
		deleted = count
		return deleteErr
	})
	return deleted, err
}

// homeworkClassKey validates the reference of an entry and returns the
// class key it is matched by.
func homeworkClassKey(id int64, schoolClass string) (string, error) {
	keys := classArrivalKeys([]string{schoolClass})
	if id <= 0 || len(keys) == 0 {
		return "", timetable.ErrInvalidHomework
	}
	return keys[0], nil
}

// positiveIDs drops non-positive and repeated IDs.
func positiveIDs(ids []int64) []int64 {
	seen := make(map[int64]bool, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id > 0 && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}
