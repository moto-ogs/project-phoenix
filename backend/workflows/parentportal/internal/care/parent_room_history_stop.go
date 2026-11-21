package care

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// The room history row of the consent list (#3844): moto records the
// child's rooms and mood, or the stop is set.
const (
	ChildConsentRoomHistory    = "room_history"
	ChildConsentStateRecording = "recording"
	ChildConsentStateStopped   = "stopped"
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

// withRoomHistoryStop appends the room history row when the Träger lets
// parents stop it. A guardian with the consent permission may change it. A
// graph without settings offers no row; the commands refuse there.
func (s *Service) withRoomHistoryStop(ctx context.Context, student *PortalStudent, canManage bool, consents []ChildConsent) ([]ChildConsent, error) {
	if s.Settings == nil {
		return consents, nil
	}
	enabled, err := s.roomHistoryStopEnabled(ctx, student.TenantID)
	if err != nil || !enabled {
		return consents, err
	}
	stops, err := s.StudentConsents.RoomHistoryStoppedSince(ctx, []int64{student.ID})
	if err != nil {
		return nil, fmt.Errorf("parent: read room history stop: %w", err)
	}
	row := ChildConsent{Key: ChildConsentRoomHistory, State: ChildConsentStateRecording, CanWithdraw: canManage}
	if since, stopped := stops[student.ID]; stopped {
		row = ChildConsent{Key: ChildConsentRoomHistory, State: ChildConsentStateStopped, ChangedAt: &since, CanGrant: canManage}
	}
	return append(consents, row), nil
}

func (s *Service) roomHistoryStopEnabled(ctx context.Context, tenantID int64) (bool, error) {
	enabled, err := s.Settings.ResolveBoolForTenant(ctx, tenantID, KeyParentRoomHistoryStopEnabled)
	if err != nil {
		return false, fmt.Errorf("parent: resolve room history stop setting: %w", err)
	}
	return enabled, nil
}

// StopChildRoomHistory stops the room history and the mood of the child and
// deletes its room history. It needs the relationship's consent permission
// and the Träger's switch; stopping a stopped child changes nothing.
func (s *Service) StopChildRoomHistory(ctx context.Context, accountID, studentID int64) ([]ChildConsent, error) {
	return s.setRoomHistoryStop(ctx, accountID, studentID, true)
}

// ResumeChildRoomHistory lifts the stop; moto records again from now on.
func (s *Service) ResumeChildRoomHistory(ctx context.Context, accountID, studentID int64) ([]ChildConsent, error) {
	return s.setRoomHistoryStop(ctx, accountID, studentID, false)
}

func (s *Service) setRoomHistoryStop(ctx context.Context, accountID, studentID int64, stop bool) ([]ChildConsent, error) {
	var consents []ChildConsent
	err := s.WithPermittedChildForWrite(ctx, accountID, studentID, GuardianPermissionConsentManage, func(*Child) error {
		if s.StudentRepo == nil || s.StudentConsents == nil || s.Settings == nil {
			return fmt.Errorf("parent: room history stop dependencies not wired")
		}
		return nil
	}, func(txCtx context.Context, child *Child) error {
		enabled, err := s.roomHistoryStopEnabled(txCtx, child.TenantID)
		if err != nil {
			return err
		}
		if !enabled {
			return ErrRoomHistoryStopDisabled
		}
		request := RoomHistoryStopRequest{StudentID: studentID, AccountID: accountID, ActorName: roomHistoryStopFallbackActor}
		if name, _ := s.actorSnapshot(txCtx, accountID); name != nil {
			request.ActorName = *name
		}
		if stop {
			err = s.StudentConsents.StopRoomHistory(txCtx, request)
		} else {
			err = s.StudentConsents.ResumeRoomHistory(txCtx, request)
		}
		if err != nil {
			return fmt.Errorf("parent: set room history stop: %w", err)
		}
		student, err := s.StudentRepo.FindByID(txCtx, studentID)
		if err != nil {
			return err
		}
		consents, err = s.loadChildConsents(txCtx, student, true)
		return err
	})
	if err != nil {
		return nil, err
	}
	return consents, nil
}
