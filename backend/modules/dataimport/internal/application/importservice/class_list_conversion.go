package importpkg

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/classlist"
	importModels "github.com/moto-ogs/project-phoenix/modules/dataimport"
	"github.com/moto-ogs/project-phoenix/modules/dataimport/ports"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ClassListConversion turns the class-list entries of a school into children
// without an OGS place (#4803, ADR 0282) when the moto team switches them on.
// An entry whose name a not graduated child of its class already carries
// joins that child; every other entry becomes a new child through the
// student import's batch creation. The morning marks follow the child, the
// entries go, and the class-list trail records which child each became.
// Everything runs in the caller's transaction: the settings write that
// switched the school on.
type ClassListConversion struct {
	deps     ports.ClassListConversionDeps
	students *StudentImportConfig
}

// NewClassListConversion builds the conversion over the owner commands and
// the student import whose batch creation it reuses.
func NewClassListConversion(deps ports.ClassListConversionDeps, students *StudentImportConfig) *ClassListConversion {
	return &ClassListConversion{deps: deps, students: students}
}

// ConvertClassListEntries converts every class-list entry of the school in
// context and reports how many became new children and how many joined an
// existing one. changedBy is the account the trail names; it is required.
func (c *ClassListConversion) ConvertClassListEntries(ctx context.Context, changedBy *int64) (importModels.ClassListConversion, error) {
	if changedBy == nil || *changedBy <= 0 {
		return importModels.ClassListConversion{}, errors.New("convert class list: the acting account is required for the trail")
	}
	entries, err := c.deps.Membership.ListClassListEntries(ctx, ports.ClassListEntryFilter{})
	if err != nil || len(entries) == 0 {
		return importModels.ClassListConversion{}, err
	}
	targets, err := c.existingChildren(ctx, entries)
	if err != nil {
		return importModels.ClassListConversion{}, err
	}
	result := importModels.ClassListConversion{Joined: countTargets(targets)}
	if created, err := c.createChildren(ctx, entries, targets); err != nil {
		return importModels.ClassListConversion{}, err
	} else {
		result.Created = created
	}
	if err := c.finish(ctx, entries, targets, changedBy); err != nil {
		return importModels.ClassListConversion{}, err
	}
	return result, nil
}

// existingChildren finds, per entry, the not graduated child of its class
// carrying its name whose OGS care has not ended, from one read of the
// namesakes; zero means none. An entry for a child whose care ended stands
// for the time after it: it becomes its own child without an OGS place, so
// its morning marks stay in the class views and the ended child keeps its
// OGS history.
func (c *ClassListConversion) existingChildren(ctx context.Context, entries []ports.ClassListEntry) ([]int64, error) {
	today := c.students.todayDate()
	pairs := make([]ports.PersonName, len(entries))
	for i, entry := range entries {
		pairs[i] = ports.PersonName{FirstName: entry.FirstName, LastName: entry.LastName}
	}
	persons, students, err := nameMatchView(ctx, c.deps.Persons, c.deps.Students, pairs)
	if err != nil {
		return nil, fmt.Errorf("convert class list: find existing children: %w", err)
	}
	targets := make([]int64, len(entries))
	for i, entry := range entries {
		found, err := findStudentsByNameAndClass(ctx, persons, students, entry.FirstName, entry.LastName, entry.SchoolClass)
		if err != nil {
			return nil, fmt.Errorf("convert class list: find existing children: %w", err)
		}
		targets[i] = lowestStudentID(slices.DeleteFunc(found, func(student ports.Student) bool {
			return careEndedBefore(student, today)
		}))
	}
	return targets, nil
}

// careEndedBefore reports whether the child's OGS care ended before today;
// its last care day still counts.
func careEndedBefore(student ports.Student, today timezone.Date) bool {
	return student.EnrolledUntil != "" && today.After(timezone.Date(student.EnrolledUntil))
}

// createChildren creates a child without an OGS place for every entry
// without a target and fills in its new ID. The entries carry unique names
// per class, so the new children are found again by name and class.
func (c *ClassListConversion) createChildren(ctx context.Context, entries []ports.ClassListEntry, targets []int64) (int, error) {
	var rows []importModels.StudentImportRow
	for i, entry := range entries {
		if targets[i] == 0 {
			rows = append(rows, importModels.StudentImportRow{
				FirstName: entry.FirstName, LastName: entry.LastName, SchoolClass: entry.SchoolClass, WithoutCarePlace: true,
			})
		}
	}
	if len(rows) == 0 {
		return 0, nil
	}
	unbounded := func(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) }
	if err := c.students.CreateChunk(ctx, rows, unbounded); err != nil {
		return 0, fmt.Errorf("convert class list: create children: %w", err)
	}
	created, err := c.existingChildren(ctx, entries)
	if err != nil {
		return 0, err
	}
	for i := range targets {
		if targets[i] != 0 {
			continue
		}
		if created[i] == 0 {
			return 0, fmt.Errorf("convert class list: entry %d has no child after the creation", entries[i].ID)
		}
		targets[i] = created[i]
	}
	return len(rows), nil
}

// finish moves the morning marks, deletes the entries and appends one
// "assigned" trail row per entry naming its child.
func (c *ClassListConversion) finish(ctx context.Context, entries []ports.ClassListEntry, targets []int64, changedBy *int64) error {
	moves := make([]ports.ClassListEntryMarkMove, len(entries))
	ids := make([]int64, len(entries))
	events := make([]any, len(entries))
	actor := *changedBy
	for i, entry := range entries {
		matched := targets[i]
		moves[i] = ports.ClassListEntryMarkMove{ClassListEntryID: entry.ID, StudentID: matched}
		ids[i] = entry.ID
		events[i] = &auditModels.ClassListEntryChange{
			EntryID: entry.ID, Action: auditModels.ClassListEntryActionAssigned,
			OldValue: classListEntryDisplay(entry.FirstName, entry.LastName, entry.SchoolClass), NewValue: "",
			MatchedStudentID: &matched, ChangedBy: actor,
		}
	}
	if err := c.deps.Marks.TransferClassListEntryMarks(ctx, moves); err != nil {
		return fmt.Errorf("convert class list: move morning marks: %w", err)
	}
	if err := c.deps.Removal.RemoveClassListEntries(ctx, ids); err != nil {
		return fmt.Errorf("convert class list: remove entries: %w", err)
	}
	if batch, ok := c.deps.Audit.(ports.AuditBatchCommand); ok {
		return batch.AppendAll(ctx, events)
	}
	for _, event := range events {
		if err := c.deps.Audit.Append(ctx, event); err != nil {
			return err
		}
	}
	return nil
}

func lowestStudentID(students []ports.Student) int64 {
	ids := make([]int64, 0, len(students))
	for _, student := range students {
		ids = append(ids, student.ID)
	}
	if len(ids) == 0 {
		return 0
	}
	return slices.Min(ids)
}

func countTargets(targets []int64) int {
	count := 0
	for _, target := range targets {
		if target != 0 {
			count++
		}
	}
	return count
}

// classListEntryDisplay is the trail's text of an entry: "Vorname Nachname
// (Klasse)".
func classListEntryDisplay(firstName, lastName, schoolClass string) string {
	return strings.TrimSpace(firstName) + " " + strings.TrimSpace(lastName) + " (" + strings.TrimSpace(schoolClass) + ")"
}
