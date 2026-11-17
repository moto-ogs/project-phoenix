package application

import (
	"context"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership/internal/domain"
)

// The data import binds the class-list batch slice outside Owner (#5827).
var _ schoolmembership.ClassListEntryBatches = (*Service)(nil)

// CreateClassListEntries is CreateClassListEntry for many entries in one
// statement: each input is validated and normalized like a single create,
// then all are written or none.
func (s *Service) CreateClassListEntries(ctx context.Context, inputs []schoolmembership.CreateClassListEntry) (result []schoolmembership.ClassListEntry, err error) {
	if len(inputs) == 0 {
		return []schoolmembership.ClassListEntry{}, nil
	}
	fields := make([]schoolmembership.ClassListEntryFields, len(inputs))
	createdBy := make([]*int64, len(inputs))
	for i, input := range inputs {
		if err := validateClassListEntryFields(&input.ClassListEntryFields); err != nil {
			return nil, err
		}
		if input.CreatedBy != nil && *input.CreatedBy <= 0 {
			input.CreatedBy = nil
		}
		fields[i], createdBy[i] = input.ClassListEntryFields, input.CreatedBy
	}
	err = s.runWrite(ctx, "create_class_list_entries", func(txCtx context.Context, stats *domain.OperationStats) error {
		var createStats domain.OperationStats
		result, createStats, err = s.store.CreateClassListEntries(txCtx, fields, createdBy)
		stats.Add(createStats)
		return err
	})
	return result, err
}

// MatchClassListEntries runs the name-and-class filter of
// ListClassListEntries for many keys in one statement.
func (s *Service) MatchClassListEntries(ctx context.Context, keys []schoolmembership.ClassListEntryFields) (result [][]schoolmembership.ClassListEntry, err error) {
	if len(keys) == 0 {
		return [][]schoolmembership.ClassListEntry{}, nil
	}
	normalized := make([]schoolmembership.ClassListEntryFields, len(keys))
	for i, key := range keys {
		key.FirstName, key.LastName, key.SchoolClass = strings.TrimSpace(key.FirstName), strings.TrimSpace(key.LastName), strings.TrimSpace(key.SchoolClass)
		if key.FirstName == "" || key.LastName == "" || key.SchoolClass == "" {
			return nil, invalid("first name, last name and school class are required to match class list entries")
		}
		normalized[i] = key
	}
	err = s.runRead(ctx, "match_class_list_entries", func(txCtx context.Context, stats *domain.OperationStats) error {
		var queryStats domain.OperationStats
		result, queryStats, err = s.store.MatchClassListEntries(txCtx, normalized)
		stats.Add(queryStats)
		return err
	})
	return result, err
}

// RemoveClassListEntries deletes the entries in one statement, all or none
// (#4803): the conversion has already moved their morning marks. First a
// child an entry joins keeps the class time the entry stood for before its
// care starts.
func (s *Service) RemoveClassListEntries(ctx context.Context, joins []schoolmembership.ClassListEntryJoin) error {
	if len(joins) == 0 {
		return nil
	}
	ids := make([]int64, 0, len(joins))
	unique := make(map[int64]bool, len(joins))
	for _, join := range joins {
		if join.EntryID <= 0 || join.StudentID <= 0 {
			return invalid("class list entry and student IDs must be positive")
		}
		ids = append(ids, join.EntryID)
		unique[join.EntryID] = true
	}
	return s.runWrite(ctx, "remove_class_list_entries", func(txCtx context.Context, stats *domain.OperationStats) error {
		keepStats, err := s.store.KeepClassTimeOfJoinedChildren(txCtx, joins)
		stats.Add(keepStats)
		if err != nil {
			return err
		}
		deleted, deleteStats, err := s.store.DeleteClassListEntries(txCtx, ids)
		stats.Add(deleteStats)
		if err != nil {
			return err
		}
		if deleted != int64(len(unique)) {
			return schoolmembership.ErrClassListEntryNotFound
		}
		return nil
	})
}
