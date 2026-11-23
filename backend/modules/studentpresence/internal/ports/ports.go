package ports

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type Stats struct {
	Queries           int
	Rows              int64
	StatementDuration time.Duration
}

type Observation struct {
	Operation string
	Duration  time.Duration
	Stats
	Err error
}

type Store interface {
	RoomHistoryStopStore
	PrepareVisitWrites(context.Context, studentpresence.VisitWriteScope) (Stats, error)
	SetSupervisionEnd(context.Context, int64, Date, time.Time) (int64, Stats, error)
	EndOpenGroupSupervisions(context.Context, int64, int64, Date) (int, Stats, error)
	RecordSupervision(context.Context, GroupSupervision) (GroupSupervision, Stats, error)
	ReviseSupervision(context.Context, GroupSupervision) (GroupSupervision, Stats, error)
	RemoveSupervision(context.Context, int64) (Stats, error)
	EndStaffSupervisionsOn(context.Context, int64, Date) (int, Stats, error)
	EndSupervisionOn(context.Context, int64, Date) (int, Stats, error)
	SupervisedRoomsOn(context.Context, Date) ([]studentpresence.StaffRoomSupervision, Stats, error)
	StaffIDsWithSupervisionOn(context.Context, Date) ([]int64, Stats, error)
	RecordGroup(context.Context, studentpresence.LiveGroup) (studentpresence.LiveGroup, Stats, error)
	ReviseGroup(context.Context, studentpresence.LiveGroup) (studentpresence.LiveGroup, Stats, error)
	DeleteGroup(context.Context, int64) (Stats, error)
	QueryGroupSupervisions(context.Context, GroupSupervisionFilter) ([]GroupSupervision, Stats, error)
	OccupiedActivityGroupIDs(context.Context, []int64) ([]int64, Stats, error)
	RecordGroupActivity(context.Context, int64, time.Time) (Stats, error)
	LockRoomSessionWrites(context.Context, int64) (Stats, error)
	ListOpenRoomSessions(context.Context, []int64) ([]studentpresence.OpenRoomSession, Stats, error)
	ListRoomSessionHistory(context.Context, int64, time.Time, time.Time, *int64) ([]studentpresence.RoomSessionHistory, Stats, error)
	ListRoomOccupancy(context.Context, []int64) ([]studentpresence.RoomOccupancy, Stats, error)
	QueryLiveGroups(context.Context, studentpresence.LiveGroupFilter) ([]studentpresence.LiveGroup, Stats, error)
	RoomUtilization(context.Context, []studentpresence.StudentVisitWindow) ([]studentpresence.RoomUtilization, Stats, error)
	LockStaffSupervision(context.Context, int64, Date) ([]int64, Stats, error)
	UnclaimedStore
	AttendanceStore
	MorningAttendanceStore
	ClassHandoverStore
	ActivitySessionStore
	SessionAttendanceStore
	VisitStore
	GroupSessionStore
	PrivacyConsentStore
	PastPresenceStore
	LatestPresenceDate(context.Context, int64) (*string, Stats, error)
	PresenceDaysBetween(ctx context.Context, studentIDs []int64, from, to calendar.Date) ([]studentpresence.PresenceDay, Stats, error)
	CountAttendanceRecords(context.Context, int64) (int, Stats, error)
	CountStudentVisitsForDeletion(context.Context, int64) (int, Stats, error)
	LockOpenPresence(context.Context, []int64) (Stats, error)
	CloseOpenPresence(context.Context, []int64, time.Time) (Stats, error)
	ListOpenPresence(context.Context, []int64) ([]int64, Stats, error)
	LockOpenVisits(context.Context, int64) (Stats, error)
	RestoreVisits(context.Context, []int64) (Stats, error)
	LockOpenSupervisors(context.Context, int64) (Stats, error)
	LockSupervisors(context.Context, []int64) (Stats, error)
	LockGroupSupervisions(context.Context) (Stats, error)
	RestoreGroup(context.Context, int64, time.Time) (Stats, error)
	RestoreSupervisors(context.Context, []int64) (Stats, error)
}

type Transaction interface {
	Run(context.Context, func(context.Context) error) error
	Require(context.Context) error
}
