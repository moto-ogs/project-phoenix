package domain

import (
	"time"
)

const DefaultDeviceOnlineWindow = 5 * time.Minute

type UpdateDevice struct {
	ID                    int64
	DeviceID              string
	DeviceType            string
	Name                  *string
	Status                string
	APIKeyHash            *string
	MaskedAPIKey          string
	LastSeen              *time.Time
	RegisteredByID        *int64
	RoomID                *int64
	ArchivedAt            *time.Time
	TransferredToDeviceID *int64
	// RecordedBy records the edit's material changes in the history in
	// the same statement.
	RecordedBy *LifecycleRecord
}

// LifecycleRecord is the actor and time of a write that records itself in
// the device's history (#2321).
type LifecycleRecord struct {
	ActorKind  string
	AccountID  *int64
	OperatorID *int64
	OccurredAt time.Time
}

type OperationStats struct {
	Queries           int64
	Rows              int64
	StatementDuration time.Duration
}

// Add folds another statement's counters into s.
func (s *OperationStats) Add(other OperationStats) {
	s.Queries += other.Queries
	s.Rows += other.Rows
	s.StatementDuration += other.StatementDuration
}
