package application

import (
	"context"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/ports"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type assignmentStore struct {
	ports.Store
	kept   []int64
	writes []string
	locks  *[]string
}

func (s *assignmentStore) ShareLockWorkTimeModel(_ context.Context, id int64) (bool, domain.OperationStats, error) {
	if s.locks != nil {
		*s.locks = append(*s.locks, "template", string(rune('0'+id)))
	}
	return id != 9, domain.OperationStats{}, nil
}

func (s *assignmentStore) FindWorkTimeModel(_ context.Context, id int64) (domain.WorkTimeModel, bool, domain.OperationStats, error) {
	return domain.WorkTimeModel{ID: id, RotationLength: 1, Entries: []domain.WorkTimeModelEntry{{DayOfWeek: 0, TargetMinutes: 300}}}, true, domain.OperationStats{}, nil
}

func (s *assignmentStore) StaffWorkTimeModelBindings(context.Context, []int64) (map[int64]int64, domain.OperationStats, error) {
	return map[int64]int64{}, domain.OperationStats{}, nil
}

func (s *assignmentStore) StaffSollKeptByTraeger(_ context.Context, ids []int64, _ string) ([]int64, domain.OperationStats, error) {
	var kept []int64
	for _, id := range ids {
		for _, keptID := range s.kept {
			if id == keptID {
				kept = append(kept, id)
			}
		}
	}
	return kept, domain.OperationStats{}, nil
}

func (s *assignmentStore) CloseStaffSchedules(context.Context, []int64, string) (domain.OperationStats, error) {
	s.writes = append(s.writes, "close")
	return domain.OperationStats{}, nil
}

func (s *assignmentStore) BindStaffWorkTimeModel(context.Context, []int64, int64, string) (domain.OperationStats, error) {
	s.writes = append(s.writes, "bind")
	return domain.OperationStats{}, nil
}

func (s *assignmentStore) InsertStaffSchedules(context.Context, []domain.StaffWorkSchedule) (domain.OperationStats, error) {
	s.writes = append(s.writes, "insert")
	return domain.OperationStats{}, nil
}

type assignmentLive struct{ ports.StaffAssignments }

func (assignmentLive) LiveStaffIDs(_ context.Context, ids []int64) ([]int64, error) { return ids, nil }

// assignmentTransaction records the lock order: every balance gate before
// the first staff row, both ascending.
type assignmentTransaction struct {
	absenceTypeCreationTransaction
	locks *[]string
}

func (t assignmentTransaction) LockStaffBalance(_ context.Context, staffID int64) error {
	*t.locks = append(*t.locks, "balance", string(rune('0'+staffID)))
	return nil
}

func newAssignmentService(store *assignmentStore, locks *[]string) *Service {
	store.locks = locks
	return &Service{
		store: store, transaction: assignmentTransaction{locks: locks}, assignments: assignmentLive{},
		lockStaffAssignment: func(_ context.Context, staffID int64) error {
			*locks = append(*locks, "row", string(rune('0'+staffID)))
			return nil
		},
		clock:   Clock{Time: func() time.Time { return time.Date(2026, time.October, 14, 10, 0, 0, 0, time.UTC) }},
		observe: func(ports.Observation) {},
	}
}

func TestAssignWorkTimeModelLocksAscendingAndWritesOnce(t *testing.T) {
	t.Parallel()
	store := &assignmentStore{}
	var locks []string
	result, err := newAssignmentService(store, &locks).AssignWorkTimeModel(context.Background(), workforce.AssignWorkTimeModel{ModelID: 4, StaffIDs: []int64{3, 1, 2, 1}})
	require.NoError(t, err)
	assert.Equal(t, []int64{1, 2, 3}, result.Assigned)
	assert.Equal(t, []string{"template", "4", "balance", "1", "balance", "2", "balance", "3", "row", "1", "row", "2", "row", "3"}, locks,
		"the template first, as an edit of it takes it; then the people as refreshAssignedSchedules takes them")
	assert.Equal(t, []string{"close", "bind", "insert"}, store.writes, "one statement per write, whatever the number of people")
}

// ADR 0089 section 6: while a contract of the Träger keeps the Soll, the
// school changes no schedule. One such person refuses the whole request.
func TestAssignWorkTimeModelRefusesASollTheTraegerKeeps(t *testing.T) {
	t.Parallel()
	store := &assignmentStore{kept: []int64{2}}
	var locks []string
	_, err := newAssignmentService(store, &locks).AssignWorkTimeModel(context.Background(), workforce.AssignWorkTimeModel{ModelID: 4, StaffIDs: []int64{1, 2}})
	require.ErrorIs(t, err, workforce.ErrStaffSollKeptByTraeger)
	assert.Empty(t, store.writes)
}

// An unknown template is refused before any person is locked.
func TestAssignWorkTimeModelRefusesAnUnknownTemplateBeforeLockingPeople(t *testing.T) {
	t.Parallel()
	store := &assignmentStore{}
	var locks []string
	_, err := newAssignmentService(store, &locks).AssignWorkTimeModel(context.Background(), workforce.AssignWorkTimeModel{ModelID: 9, StaffIDs: []int64{1}})
	require.ErrorIs(t, err, workforce.ErrWorkTimeModelNotFound)
	assert.Equal(t, []string{"template", "9"}, locks)
	assert.Empty(t, store.writes)
}
