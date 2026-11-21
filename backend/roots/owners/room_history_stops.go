package owners

import (
	"context"
	"fmt"
	"strconv"

	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	presenceCompose "github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
)

// NewRoomHistoryStopReads composes the read side of the per-child stop of
// room history and mood (#3844) that Feedback and the device scan consult.
func NewRoomHistoryStopReads(db transactionruntime.Database) (studentpresence.RoomHistoryStopReads, error) {
	owner, err := presenceCompose.New(presenceCompose.Dependencies{DB: db.Pool(), Observe: presenceCompose.FailureLogger()})
	if err != nil {
		return nil, err
	}
	return presenceCompose.NewRoomHistoryStopReads(owner)
}

// NewRoomHistoryStops composes the per-child stop with its audit: each
// effective change goes to the child's change history, the visits a stop
// deletes to the deletion log, both in the command's transaction.
func NewRoomHistoryStops(db transactionruntime.Database) (studentpresence.RoomHistoryStops, error) {
	owner, err := presenceCompose.New(presenceCompose.Dependencies{DB: db.Pool(), Observe: presenceCompose.FailureLogger()})
	if err != nil {
		return nil, err
	}
	trails := peopleDirectoryAudit(db)
	return presenceCompose.NewRoomHistoryStops(owner, roomHistoryStopAudit{edits: trails.StudentFieldEdit, deletions: trails.DataDeletion})
}

// roomHistoryStopAudit writes a stop change into the Audit Platform. The
// change history holds who and when, the deletion log the count; neither
// holds a room, a time of day or a mood of the child.
type roomHistoryStopAudit struct {
	edits interface {
		CreateBatch(ctx context.Context, edits []*auditModels.StudentFieldEdit) error
	}
	deletions DataDeletionAppender
}

const (
	roomHistoryRecorded = "Wird gespeichert"
	roomHistoryStopped  = "Gestoppt"
)

func (a roomHistoryStopAudit) RecordRoomHistoryStop(ctx context.Context, event studentpresence.RoomHistoryStopEvent) error {
	oldValue, newValue := roomHistoryStopped, roomHistoryRecorded
	if event.Stopped {
		oldValue, newValue = roomHistoryRecorded, roomHistoryStopped
		if event.DeletedVisits > 0 {
			newValue = fmt.Sprintf("%s, %d Raumbesuche gelöscht", roomHistoryStopped, event.DeletedVisits)
		}
	}
	edit := &auditModels.StudentFieldEdit{
		StudentID: event.StudentID, EditedBy: event.Actor.AccountID, EditedByName: event.Actor.Name,
		FieldName: auditModels.StudentFieldRoomHistoryStop, OldValue: &oldValue, NewValue: &newValue, CreatedAt: event.At,
	}
	if err := a.edits.CreateBatch(ctx, []*auditModels.StudentFieldEdit{edit}); err != nil {
		return fmt.Errorf("record the room history stop in the change history: %w", err)
	}
	if !event.Stopped || event.DeletedVisits == 0 {
		return nil
	}
	deletion := auditModels.NewDataDeletion(event.StudentID, auditModels.DeletionTypeRoomHistoryStop, int(event.DeletedVisits),
		"account:"+strconv.FormatInt(event.Actor.AccountID, 10))
	deletion.DeletionReason = "Raumverlauf und Stimmung für dieses Kind gestoppt"
	deletion.DeletedAt = event.At
	deletion.Metadata["source"] = event.Actor.Source
	if err := a.deletions.Create(ctx, deletion); err != nil {
		return fmt.Errorf("record the deleted room visits: %w", err)
	}
	return nil
}

// MustNewRoomHistoryStops is NewRoomHistoryStops for test graphs.
func MustNewRoomHistoryStops(db transactionruntime.Database) studentpresence.RoomHistoryStops {
	stops, err := NewRoomHistoryStops(db)
	if err != nil {
		panic(err)
	}
	return stops
}
