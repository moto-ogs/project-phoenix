package application

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

type RequestCorrections struct {
	Records ports.RequestCorrectionRecords
	People  ports.RequestCorrectionPeople
	Plans   ports.RequestCorrectionPlans
	Effects ports.RequestCorrectionEffects
	Excusal ports.RequestCorrectionExcusal
}

func (s *RequestCorrections) Correct(ctx context.Context, id int64, approve bool, version, reason string, actorID int64) error {
	if id <= 0 {
		return careplan.ErrCareScheduleRequestNotFound
	}
	reason = strings.TrimSpace(reason)
	if utf8.RuneCountInString(reason) > maxDecisionReasonRunes {
		return carerequests.ErrRejectReasonTooLong
	}
	request, err := s.loadCorrection(ctx, id, version)
	if err != nil {
		return err
	}
	applied, err := s.applyCorrectionDecision(ctx, request, approve)
	if err != nil {
		return err
	}
	status := "rejected"
	if approve {
		status = "approved"
	}
	var reasonPtr *string
	if reason != "" {
		reasonPtr = &reason
	}
	if err := s.Records.Redecide(ctx, id, status, reasonPtr, actorID, approve); err != nil {
		return err
	}
	payload := map[string]any{"approve": approve, "reason": reason, "from": request.Status, "to": status}
	if request.ReviewedBy != nil {
		payload["prior_reviewer"] = *request.ReviewedBy
	}
	if request.DecisionReason != nil {
		payload["prior_reason"] = *request.DecisionReason
	}
	appliedLedgerPayload(payload, applied)
	if err := s.Effects.RecordCorrection(ctx, request, actorID, payload); err != nil {
		return err
	}
	return s.Effects.NotifyCorrection(ctx, request, actorID, approve, reason)
}

func (s *RequestCorrections) applyCorrectionDecision(ctx context.Context, request *carerequests.Request, approve bool) (carerequests.PickupApplied, error) {
	if request.RequestKind == carerequests.KindPickupPermission {
		if approve {
			if request.Status == carerequests.StatusApproved {
				return carerequests.PickupApplied{}, nil
			}
			return carerequests.PickupApplied{}, s.Plans.ApplyPickupPermission(ctx, request)
		}
		if request.Status == carerequests.StatusApproved {
			return carerequests.PickupApplied{}, s.Plans.RevertPickupPermission(ctx, request)
		}
		return carerequests.PickupApplied{}, nil
	}
	if approve {
		return s.Plans.ApplyPickup(ctx, request, nil, false)
	}
	return carerequests.PickupApplied{}, s.revertPickup(ctx, request)
}

func (s *RequestCorrections) loadCorrection(ctx context.Context, id int64, version string) (*carerequests.Request, error) {
	request, student, err := lockCareRequestStudent(ctx, s.Records, s.People, id, func(row carerequests.Request) error {
		return validateCareCorrection(row, version)
	})
	if err != nil {
		return nil, err
	}
	allowed, err := s.People.CanReview(ctx, student)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, carerequests.ErrCareRequestForbidden
	}
	return &request, nil
}

func (s *RequestCorrections) revertPickup(ctx context.Context, request *carerequests.Request) error {
	if request.Status != "approved" {
		return nil
	}
	events, err := s.Effects.CorrectionHistory(ctx, request)
	if err != nil {
		return fmt.Errorf("schedule: read care request ledger: %w", err)
	}
	applied, found := latestPickupRows(events)
	if !found {
		return fmt.Errorf("%w: zu dieser Entscheidung ist kein Eintrag gespeichert, der zurückgenommen werden kann. Bitte ändere die Abholung direkt", careplan.ErrParentRequestCorrectionUnsupported)
	}
	if applied.PickupExceptionID > 0 {
		if err := s.revertPickupException(ctx, request, applied); err != nil {
			return err
		}
	}
	if applied.DepartureExceptionID > 0 {
		if err := s.revertDepartureException(ctx, request, applied); err != nil {
			return err
		}
	}
	if applied.PickupPersonID > 0 {
		if err := s.revertPickupPerson(ctx, request, applied); err != nil {
			return err
		}
	}
	if applied.PickupNoteID > 0 {
		return s.revertPickupNote(ctx, applied)
	}
	return nil
}

// revertPickupPerson deletes the day's pickup person the approval wrote
// (#8162) while it is still the one the approval left. A past day has none:
// the nightly retention deleted it.
func (s *RequestCorrections) revertPickupPerson(ctx context.Context, request *carerequests.Request, applied carerequests.PickupApplied) error {
	terms := carerequests.StoredPickupTerms(request.Payload)
	if terms == nil {
		return nil
	}
	row, err := dayPickupPerson(ctx, s.Records, request.StudentID, terms.Date)
	if err != nil {
		return err
	}
	if row == nil || row.ID != applied.PickupPersonID {
		return nil
	}
	if pickupPersonVersion(*row) != applied.PickupPersonVersion {
		return fmt.Errorf("%w: die Abholperson am %s wurde nach der Entscheidung geändert", careplan.ErrParentRequestCorrectionUnsupported, terms.Date.Format("02.01.2006"))
	}
	_, err = s.Records.DeleteApprovedPickupPerson(ctx, request.StudentID, terms.Date, row.ID)
	return err
}

// revertPickupNote deletes the day's collector note the approval wrote
// (#4780). Ledger entries without a version keep the unconditional delete
// they were written under.
func (s *RequestCorrections) revertPickupNote(ctx context.Context, applied carerequests.PickupApplied) error {
	if applied.PickupNoteVersion == "" {
		return s.Records.DeletePickupNote(ctx, applied.PickupNoteID)
	}
	note, err := s.Records.FindPickupNote(ctx, applied.PickupNoteID)
	if err != nil {
		return err
	}
	if note == nil {
		return nil
	}
	if pickupNoteVersion(*note) != applied.PickupNoteVersion {
		return fmt.Errorf("%w: die Abholnotiz am %s wurde nach der Entscheidung geändert", careplan.ErrParentRequestCorrectionUnsupported, note.NoteDate.Format("02.01.2006"))
	}
	return s.Records.DeletePickupNote(ctx, note.ID)
}

func (s *RequestCorrections) revertPickupException(ctx context.Context, request *carerequests.Request, applied carerequests.PickupApplied) error {
	row, err := s.Records.FindException(ctx, applied.PickupExceptionID)
	if err != nil {
		return err
	}
	if row == nil {
		return nil
	}
	if changedAfterDecision(request, applied.PickupExceptionVersion, pickupExceptionVersion(*row), row.UpdatedAt) {
		return fmt.Errorf("%w: die Abholzeit am %s wurde nach der Entscheidung geändert", careplan.ErrParentRequestCorrectionUnsupported, row.ExceptionDate.Format("02.01.2006"))
	}
	if row.ExcusedAuto {
		if err := s.Excusal.ReleaseBeforeDelete(ctx, row); err != nil {
			return err
		}
	}
	return s.Records.DeleteException(ctx, row.ID)
}

func (s *RequestCorrections) revertDepartureException(ctx context.Context, request *carerequests.Request, applied carerequests.PickupApplied) error {
	row, err := s.Records.FindDepartureException(ctx, applied.DepartureExceptionID)
	if err != nil {
		return err
	}
	if row == nil {
		return nil
	}
	if changedAfterDecision(request, applied.DepartureExceptionVersion, departureExceptionVersion(*row), row.UpdatedAt) {
		return fmt.Errorf("%w: die Abholart am %s wurde nach der Entscheidung geändert", careplan.ErrParentRequestCorrectionUnsupported, row.ExceptionDate.Format("02.01.2006"))
	}
	return s.Records.DeleteDepartureException(ctx, row.ID)
}

// changedAfterDecision compares the row with the version the decision ledger
// recorded for it. Equality is the only test: transaction start times do not
// follow commit order, so a staff edit whose transaction began before the
// approval carries an older stamp than the decision (ADR 0281, point 4).
// Ledger entries written before versions existed keep the guard they were
// written under: the row's updated_at after the request's reviewed_at. Those
// approvals stamped the rows they updated on the owner clock, after their
// transaction began, so only reviewed_at lies after an untouched row; the
// guard keeps its known limits (overlapping edits, clocks apart).
func changedAfterDecision(request *carerequests.Request, recorded, current string, rowUpdatedAt time.Time) bool {
	if recorded != "" {
		return current != recorded
	}
	return request.ReviewedAt != nil && rowUpdatedAt.After(*request.ReviewedAt)
}

// latestPickupRows reads the generation written by the latest decision or
// correction. A later transition without IDs invalidates the previous generation;
// falling back would target rows from an approval already taken back.
func latestPickupRows(events []ports.RequestCorrectionEvent) (carerequests.PickupApplied, bool) {
	var applied carerequests.PickupApplied
	var found bool
	for _, event := range events {
		if event.Type != "decided" && event.Type != "corrected" {
			continue
		}
		pickupID, pickupOK := correctionExceptionID(event.Payload["pickup_exception_id"])
		departureID, departureOK := correctionExceptionID(event.Payload["departure_exception_id"])
		noteID, noteOK := correctionExceptionID(event.Payload["pickup_note_id"])
		personID, personOK := correctionExceptionID(event.Payload["pickup_person_id"])
		applied = carerequests.PickupApplied{
			PickupExceptionID: pickupID, PickupExceptionVersion: correctionRowVersion(event.Payload["pickup_exception_version"]),
			DepartureExceptionID: departureID, DepartureExceptionVersion: correctionRowVersion(event.Payload["departure_exception_version"]),
			PickupNoteID: noteID, PickupNoteVersion: correctionRowVersion(event.Payload["pickup_note_version"]),
			PickupPersonID: personID, PickupPersonVersion: correctionRowVersion(event.Payload["pickup_person_version"]),
		}
		found = pickupOK || departureOK || noteOK || personOK
	}
	return applied, found
}

func correctionRowVersion(value any) string {
	version, _ := value.(string)
	return version
}

func correctionExceptionID(value any) (int64, bool) {
	if typed, ok := value.(ident.ID); ok {
		value = typed.Int64()
	}
	switch id := value.(type) {
	case float64:
		return int64(id), id > 0
	case int64:
		return id, id > 0
	default:
		return 0, false
	}
}

func validateCareCorrection(request carerequests.Request, version string) error {
	if request.Status != "approved" && request.Status != "rejected" {
		return careplan.ErrParentRequestNotDecided
	}
	if err := readstate.Check(version, readstate.Of(request.UpdatedAt)); err != nil {
		return err
	}
	if request.RequestKind != "pickup_change" && request.RequestKind != carerequests.KindPickupPermission {
		return fmt.Errorf("%w: Betreuungszeiten speichern keinen Stand von vor der Entscheidung. Bitte ändere den Wochenplan des Kindes direkt", careplan.ErrParentRequestCorrectionUnsupported)
	}
	return nil
}
