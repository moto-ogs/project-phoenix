package presence

import (
	"context"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type recordingAttendanceSyncer struct {
	checkInErr  error
	mirrorAtErr error
	loaded      []*studentpresence.Visit
	mirrored    []*studentpresence.Visit
	mirrorAt    []struct {
		studentID int64
		at        time.Time
	}
}

func (r *recordingAttendanceSyncer) MirrorCheckInForVisit(_ context.Context, visit *studentpresence.Visit) (*AttendanceSnapshot, error) {
	copy := *visit
	r.mirrored = append(r.mirrored, &copy)
	if r.checkInErr != nil {
		return nil, r.checkInErr
	}
	return &AttendanceSnapshot{Status: "present", InstanceID: 2}, nil
}

func (r *recordingAttendanceSyncer) MirrorCheckInAt(_ context.Context, studentID int64, at time.Time) (*AttendanceSnapshot, error) {
	r.mirrorAt = append(r.mirrorAt, struct {
		studentID int64
		at        time.Time
	}{studentID: studentID, at: at})
	return nil, r.mirrorAtErr
}

func (r *recordingAttendanceSyncer) MirrorCheckOutForVisit(_ context.Context, visit *studentpresence.Visit) (*AttendanceSnapshot, error) {
	copy := *visit
	r.loaded = append(r.loaded, &copy)
	return &AttendanceSnapshot{Status: "present", InstanceID: 1}, nil
}

func (r *recordingAttendanceSyncer) MirrorCheckOutAt(context.Context, int64, time.Time) error {
	return nil
}

func (r *recordingAttendanceSyncer) MirrorCheckInAtBatch(context.Context, []int64, time.Time) error {
	return nil
}

func (r *recordingAttendanceSyncer) MirrorCheckOutAtBatch(context.Context, []int64, time.Time) error {
	return nil
}

func (r *recordingAttendanceSyncer) MirrorCheckOutForVisits(_ context.Context, visits []*studentpresence.Visit, _ time.Time) error {
	for _, visit := range visits {
		copy := *visit
		r.loaded = append(r.loaded, &copy)
	}
	return nil
}

func TestPresenceVisitValidation(t *testing.T) {
	t.Parallel()

	nowTime := presenceTestNow()
	futureTime := nowTime.Add(2 * time.Hour)
	pastTime := nowTime.Add(-2 * time.Hour)

	tests := []struct {
		name    string
		visit   *studentpresence.Visit
		wantErr bool
	}{
		{
			name: "Valid visit",
			visit: &studentpresence.Visit{
				StudentID:     1,
				ActiveGroupID: 1,
				EntryTime:     nowTime,
			},
			wantErr: false,
		},
		{
			name: "Valid visit with exit time",
			visit: &studentpresence.Visit{
				StudentID:     1,
				ActiveGroupID: 1,
				EntryTime:     nowTime,
				ExitTime:      &futureTime,
			},
			wantErr: false,
		},
		{
			name: "Missing student ID",
			visit: &studentpresence.Visit{
				ActiveGroupID: 1,
				EntryTime:     nowTime,
			},
			wantErr: true,
		},
		{
			name: "Missing active group ID",
			visit: &studentpresence.Visit{
				StudentID: 1,
				EntryTime: nowTime,
			},
			wantErr: true,
		},
		{
			name: "Missing entry time",
			visit: &studentpresence.Visit{
				StudentID:     1,
				ActiveGroupID: 1,
			},
			wantErr: true,
		},
		{
			name: "Exit time before entry time",
			visit: &studentpresence.Visit{
				StudentID:     1,
				ActiveGroupID: 1,
				EntryTime:     nowTime,
				ExitTime:      &pastTime,
			},
			wantErr: true,
		},
		{
			name: "Invalid student ID",
			visit: &studentpresence.Visit{
				StudentID:     -1,
				ActiveGroupID: 1,
				EntryTime:     nowTime,
			},
			wantErr: true,
		},
		{
			name: "Invalid active group ID",
			visit: &studentpresence.Visit{
				StudentID:     1,
				ActiveGroupID: 0,
				EntryTime:     nowTime,
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, !tt.wantErr, validPresenceVisit(tt.visit))
			if tt.wantErr {
				svc := &service{ServiceDependencies: ServiceDependencies{Now: presenceTestNow}}
				require.ErrorIs(t, svc.createVisit(context.Background(), tt.visit), ErrInvalidData)
			}
		})
	}
}
