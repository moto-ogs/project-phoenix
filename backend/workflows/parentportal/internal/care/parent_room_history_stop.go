package care

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// ErrRoomHistoryStopDisabled refuses a parent's stop or resume while the
// Träger has not switched the parents' stop on.
var ErrRoomHistoryStopDisabled = errors.New("parent: parents may not stop the room history at this school")

// roomHistoryStopFallbackActor names a guardian without a profile name in
// the child's change history.
const roomHistoryStopFallbackActor = "Elternteil"

// RoomHistoryStopRequest is one parent's stop or resume for a child; the
// actor goes to the child's change history.
type RoomHistoryStopRequest struct {
	StudentID, AccountID int64
	ActorName            string
}

// RoomHistoryStopPort is Student Presence's per-child stop of room history
// and mood, run in the flow's tenant unit of work. Stop deletes the child's
// completed visits; resume restores nothing.
type RoomHistoryStopPort interface {
	RoomHistoryStoppedSince(ctx context.Context, studentIDs []int64) (map[int64]time.Time, error)
	StopRoomHistory(context.Context, RoomHistoryStopRequest) error
	ResumeRoomHistory(context.Context, RoomHistoryStopRequest) error
}

// ChildRoomHistoryStop is what a guardian sees of the stop (#3844). Offered
// is false while the Träger has not let parents stop it; then nothing else
// is read. CanChange needs the relationship's consent permission.
type ChildRoomHistoryStop struct {
	Offered   bool
	Stopped   bool
	StoppedAt *time.Time
	CanChange bool
}

// GetChildRoomHistoryStop reads the stop for a guardian with portal access.
func (s *Service) GetChildRoomHistoryStop(ctx context.Context, accountID, studentID int64) (ChildRoomHistoryStop, error) {
	var view ChildRoomHistoryStop
	err := s.WithPermittedChild(ctx, accountID, studentID, GuardianPermissionPortalAccess, s.requireRoomHistoryStopWiring,
		func(txCtx context.Context, child *Child) error {
			var err error
			view, err = s.readRoomHistoryStop(txCtx, child, studentID)
			return err
		})
	if err != nil {
		return ChildRoomHistoryStop{}, err
	}
	return view, nil
}

// StopChildRoomHistory stops the room history and the mood of the child and
// deletes its room history. It needs the relationship's consent permission
// and the Träger's switch; stopping a stopped child changes nothing.
func (s *Service) StopChildRoomHistory(ctx context.Context, accountID, studentID int64) (ChildRoomHistoryStop, error) {
	return s.setRoomHistoryStop(ctx, accountID, studentID, true)
}

// ResumeChildRoomHistory lifts the stop; moto records again from now on.
func (s *Service) ResumeChildRoomHistory(ctx context.Context, accountID, studentID int64) (ChildRoomHistoryStop, error) {
	return s.setRoomHistoryStop(ctx, accountID, studentID, false)
}

func (s *Service) setRoomHistoryStop(ctx context.Context, accountID, studentID int64, stop bool) (ChildRoomHistoryStop, error) {
	var view ChildRoomHistoryStop
	err := s.WithPermittedChildForWrite(ctx, accountID, studentID, GuardianPermissionConsentManage, s.requireRoomHistoryStopWiring,
		func(txCtx context.Context, child *Child) error {
			var err error
			view, err = s.changeRoomHistoryStop(txCtx, child, accountID, studentID, stop)
			return err
		})
	if err != nil {
		return ChildRoomHistoryStop{}, err
	}
	return view, nil
}

func (s *Service) requireRoomHistoryStopWiring(*Child) error {
	if s.StudentConsents == nil || s.Settings == nil {
		return fmt.Errorf("parent: room history stop dependencies not wired")
	}
	return nil
}

// changeRoomHistoryStop runs the stop or resume under the child write guard
// and answers the new state.
func (s *Service) changeRoomHistoryStop(ctx context.Context, child *Child, accountID, studentID int64, stop bool) (ChildRoomHistoryStop, error) {
	enabled, err := s.roomHistoryStopEnabled(ctx, child.TenantID)
	if err != nil {
		return ChildRoomHistoryStop{}, err
	}
	if !enabled {
		return ChildRoomHistoryStop{}, ErrRoomHistoryStopDisabled
	}
	request := RoomHistoryStopRequest{StudentID: studentID, AccountID: accountID, ActorName: roomHistoryStopFallbackActor}
	if name, _ := s.actorSnapshot(ctx, accountID); name != nil {
		request.ActorName = *name
	}
	change := s.StudentConsents.ResumeRoomHistory
	if stop {
		change = s.StudentConsents.StopRoomHistory
	}
	if err := change(ctx, request); err != nil {
		return ChildRoomHistoryStop{}, fmt.Errorf("parent: set room history stop: %w", err)
	}
	return s.readRoomHistoryStop(ctx, child, studentID)
}

func (s *Service) readRoomHistoryStop(ctx context.Context, child *Child, studentID int64) (ChildRoomHistoryStop, error) {
	enabled, err := s.roomHistoryStopEnabled(ctx, child.TenantID)
	if err != nil || !enabled {
		return ChildRoomHistoryStop{}, err
	}
	stops, err := s.StudentConsents.RoomHistoryStoppedSince(ctx, []int64{studentID})
	if err != nil {
		return ChildRoomHistoryStop{}, fmt.Errorf("parent: read room history stop: %w", err)
	}
	view := ChildRoomHistoryStop{Offered: true, CanChange: child.HasPermission(GuardianPermissionConsentManage)}
	if since, stopped := stops[studentID]; stopped {
		view.Stopped, view.StoppedAt = true, &since
	}
	return view, nil
}

func (s *Service) roomHistoryStopEnabled(ctx context.Context, tenantID int64) (bool, error) {
	enabled, err := s.Settings.ResolveBoolForTenant(ctx, tenantID, KeyParentRoomHistoryStopEnabled)
	if err != nil {
		return false, fmt.Errorf("parent: resolve room history stop setting: %w", err)
	}
	return enabled, nil
}
