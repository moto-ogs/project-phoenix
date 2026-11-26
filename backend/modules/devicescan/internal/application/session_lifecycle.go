package application

import (
	"context"
	"errors"
	"log/slog"

	"github.com/moto-ogs/project-phoenix/modules/devicescan"
	"github.com/moto-ogs/project-phoenix/modules/devicescan/ports"
)

// LifecycleStore is the consumer-owned session seam. Current wraps
// ports.ErrLifecycleSessionAbsent when absent and preserves the service wire text.
type LifecycleStore interface {
	Start(context.Context, int64, devicescan.StartSessionCommand) (ports.LifecycleSession, error)
	Current(context.Context, int64) (*ports.LifecycleSession, error)
	Conflict(context.Context, int64, int64) (devicescan.ConflictInfoResponse, error)
	Supervisors(context.Context, int64) ([]ports.LifecycleSupervisor, error)
	ReplaceSupervisors(context.Context, int64, []int64) (ports.LifecycleSession, error)
	CountOpenVisitsInGroupWithRevision(context.Context, int64) (int, int64, error)
	Touch(context.Context, int64) error
}

type LifecyclePeople interface {
	StaffNames(context.Context, []int64) (map[int64]ports.Person, error)
}

// SessionMirror owns the optional best-effort timetable mirror and its
// post-commit notification. A nil mirror leaves the session command unchanged.
type SessionMirror interface {
	MirrorSession(context.Context, ports.LifecycleSession, []int64)
}

type SessionHeartbeat interface {
	RecordDeviceHeartbeat(context.Context, string) error
}

type sessionLifecycle struct {
	store      LifecycleStore
	people     LifecyclePeople
	principals devicescan.PrincipalReader
	heartbeat  SessionHeartbeat
	mirror     SessionMirror
	closures   devicescan.RoomClosures
	clock      ports.Clock
	logger     *slog.Logger
}

func NewSessionLifecycle(store LifecycleStore, people LifecyclePeople, principals devicescan.PrincipalReader, heartbeat SessionHeartbeat, mirror SessionMirror, closures devicescan.RoomClosures, clock ports.Clock, logger *slog.Logger) devicescan.SessionLifecycle {
	if closures == nil {
		panic("kiosk session lifecycle: room closures are required")
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &sessionLifecycle{store: store, people: people, principals: principals, heartbeat: heartbeat, mirror: mirror, closures: closures, clock: clock, logger: logger}
}

func (s *sessionLifecycle) device(ctx context.Context) (*devicescan.PrincipalDevice, error) {
	device, ok := s.principals.Device(ctx)
	if !ok || device == nil {
		return nil, devicescan.ErrDeviceUnauthorized
	}
	return device, nil
}

func (s *sessionLifecycle) StartSession(ctx context.Context, command devicescan.StartSessionCommand) (devicescan.SessionStartResponse, error) {
	device, err := s.device(ctx)
	if err != nil {
		return devicescan.SessionStartResponse{}, err
	}
	if len(command.SupervisorIDs) == 0 {
		return devicescan.SessionStartResponse{}, devicescan.Internal("at least one supervisor ID is required", nil)
	}
	group, err := s.store.Start(ctx, device.ID, command)
	if errors.Is(err, devicescan.ErrDeviceUnauthorized) {
		// The device was removed after it authenticated (#2319).
		return devicescan.SessionStartResponse{}, err
	}
	if err != nil {
		return s.startFailure(ctx, command.ActivityID, device.ID, err)
	}
	// The start resolved the session's room, the chosen or the planned one.
	// A room closed today takes no session (#7653); the caller rolls the
	// start back.
	if err := s.refuseClosedRoom(ctx, group.RoomID); err != nil {
		return devicescan.SessionStartResponse{}, err
	}
	if s.mirror != nil {
		s.mirror.MirrorSession(ctx, group, command.SupervisorIDs)
	}
	response := devicescan.SessionStartResponse{ActiveGroupID: group.ID, ActivityID: group.ActivityID, DeviceID: device.ID, StartTime: group.StartTime, Status: "started", Message: "Activity session started successfully"}
	if supervisors, lookupErr := s.store.Supervisors(ctx, group.ID); lookupErr == nil && len(supervisors) > 0 {
		response.Supervisors = s.supervisorInfos(ctx, supervisors)
	}
	return response, nil
}

func (s *sessionLifecycle) startFailure(ctx context.Context, activityID, deviceID int64, err error) (devicescan.SessionStartResponse, error) {
	var conflict *ports.SessionStartConflict
	if errors.As(err, &conflict) {
		info, lookupErr := s.store.Conflict(ctx, activityID, deviceID)
		if lookupErr == nil && info.HasConflict {
			return devicescan.SessionStartResponse{Status: "conflict", Message: info.ConflictMessage, ConflictInfo: &info}, nil
		}
	}
	var failure *devicescan.Failure
	if errors.As(err, &failure) {
		return devicescan.SessionStartResponse{}, failure
	}
	return devicescan.SessionStartResponse{}, classifyPresenceFailure(err)
}

func (s *sessionLifecycle) refuseClosedRoom(ctx context.Context, roomID int64) error {
	closed, err := s.closures.RoomClosedOn(ctx, roomID, s.clock.Day(s.clock.Now()))
	if err != nil {
		return devicescan.Internal("failed to check the room closure", err)
	}
	if closed {
		return devicescan.InvalidRequestWithCode("the room is closed today", devicescan.CodeRoomClosed)
	}
	return nil
}

func (s *sessionLifecycle) supervisorInfos(ctx context.Context, supervisors []ports.LifecycleSupervisor) []devicescan.SupervisorInfo {
	result := make([]devicescan.SupervisorInfo, 0, len(supervisors))
	if len(supervisors) == 0 {
		return result
	}
	ids := make([]int64, 0, len(supervisors))
	seen := make(map[int64]bool, len(supervisors))
	for _, supervisor := range supervisors {
		if !seen[supervisor.StaffID] {
			ids = append(ids, supervisor.StaffID)
			seen[supervisor.StaffID] = true
		}
	}
	people, err := s.people.StaffNames(ctx, ids)
	if err != nil {
		s.logger.WarnContext(ctx, "batch staff lookup failed, falling back to empty list", slog.String("error", err.Error()))
		return result
	}
	for _, supervisor := range supervisors {
		if person, ok := people[supervisor.StaffID]; ok {
			result = append(result, devicescan.SupervisorInfo{StaffID: supervisor.StaffID, FirstName: person.FirstName, LastName: person.LastName, DisplayName: person.FirstName + " " + person.LastName, Role: supervisor.Role})
		}
	}
	return result
}

func (s *sessionLifecycle) CurrentSession(ctx context.Context) (devicescan.SessionCurrentResponse, error) {
	device, err := s.device(ctx)
	if err != nil {
		return devicescan.SessionCurrentResponse{}, err
	}
	if err := s.heartbeat.RecordDeviceHeartbeat(ctx, device.DeviceID); err != nil {
		s.logger.WarnContext(ctx, "failed to update device last seen",
			slog.String("device_id", device.DeviceID),
			slog.String("error", err.Error()),
		)
	}
	response := devicescan.SessionCurrentResponse{DeviceID: device.ID}
	group, err := s.store.Current(ctx, device.ID)
	if err != nil && !errors.Is(err, ports.ErrLifecycleSessionAbsent) {
		return response, classifyPresenceFailure(err)
	}
	if group == nil {
		return response, nil
	}
	if err := s.store.Touch(ctx, group.ID); err != nil {
		s.logger.WarnContext(ctx, "failed to update session activity",
			slog.Int64("session_id", group.ID),
			slog.String("error", err.Error()),
		)
	}
	duration := s.clock.Now().Sub(group.StartTime).String()
	response.IsActive = true
	response.ActiveGroupID, response.ActivityID, response.RoomID = &group.ID, group.ActivityID, &group.RoomID
	response.StartTime, response.Duration = &group.StartTime, &duration
	response.ActivityName, response.RoomName = group.ActivityName, group.RoomName
	if count, revision, countErr := s.store.CountOpenVisitsInGroupWithRevision(ctx, group.ID); countErr == nil {
		response.ActiveStudents, response.ActiveStudentsRevision = &count, &revision
	} else {
		s.logger.WarnContext(ctx, "failed to get active student count",
			slog.Int64("session_id", group.ID),
			slog.String("error", countErr.Error()),
		)
	}
	if supervisors, lookupErr := s.store.Supervisors(ctx, group.ID); lookupErr == nil {
		if len(supervisors) > 0 {
			response.Supervisors = s.supervisorInfos(ctx, supervisors)
		}
	} else {
		s.logger.WarnContext(ctx, "failed to get supervisors",
			slog.Int64("session_id", group.ID),
			slog.String("error", lookupErr.Error()),
		)
	}
	return response, nil
}

func (s *sessionLifecycle) SessionToEnd(ctx context.Context) (devicescan.SessionToEnd, error) {
	device, err := s.device(ctx)
	if err != nil {
		return devicescan.SessionToEnd{}, err
	}
	group, err := s.store.Current(ctx, device.ID)
	if err != nil && !errors.Is(err, ports.ErrLifecycleSessionAbsent) {
		return devicescan.SessionToEnd{}, classifyPresenceFailure(err)
	}
	if group == nil {
		return devicescan.SessionToEnd{}, devicescan.InvalidRequestWithCode("no active session to end", devicescan.CodeNoSessionToEnd)
	}
	return devicescan.SessionToEnd{ID: group.ID, ActivityID: group.ActivityID, DeviceID: device.ID, StartTime: group.StartTime}, nil
}

func (s *sessionLifecycle) ReplaceSessionSupervisors(ctx context.Context, sessionID int64, ids []int64) (devicescan.UpdateSupervisorsResponse, error) {
	if _, err := s.device(ctx); err != nil {
		return devicescan.UpdateSupervisorsResponse{}, err
	}
	group, err := s.store.ReplaceSupervisors(ctx, sessionID, ids)
	if err != nil {
		return devicescan.UpdateSupervisorsResponse{}, classifyPresenceFailure(err)
	}
	active := make([]ports.LifecycleSupervisor, 0, len(group.Supervisors))
	for _, supervisor := range group.Supervisors {
		if !supervisor.Ended && supervisor.StaffID > 0 {
			active = append(active, supervisor)
		}
	}
	return devicescan.UpdateSupervisorsResponse{ActiveGroupID: group.ID, Supervisors: s.supervisorInfos(ctx, active), Status: "success", Message: "Supervisors updated successfully"}, nil
}

func (s *sessionLifecycle) TouchSession(ctx context.Context) (int64, error) {
	device, err := s.device(ctx)
	if err != nil {
		return 0, err
	}
	group, err := s.store.Current(ctx, device.ID)
	if err != nil {
		return 0, classifyPresenceFailure(err)
	}
	if group == nil {
		return 0, devicescan.NotFound("no active session found for device")
	}
	if err := s.store.Touch(ctx, group.ID); err != nil {
		return 0, classifyPresenceFailure(err)
	}
	return group.ID, nil
}
