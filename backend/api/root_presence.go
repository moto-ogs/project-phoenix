package api

import (
	"context"

	facilitiesModule "github.com/moto-ogs/project-phoenix/modules/facilities"
	facilitiesCompose "github.com/moto-ogs/project-phoenix/modules/facilities/compose"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/schoolstructure"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	workforceCompose "github.com/moto-ogs/project-phoenix/modules/workforce/compose"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
)

// FacilitiesRooms are the retained room service with its occupancy and
// history over Student Presence, and the running sessions the yard reads.
type FacilitiesRooms struct {
	RoomService facilitiesCompose.RoomService
	OpenGroups  facilitiesCompose.OpenGroupCatalog
	// Closures are the room closures (#7653) the rooms routes keep and the
	// kiosk's session start refuses.
	Closures facilitiesModule.Closures
}

// buildFacilitiesRooms builds the retained room service, the open groups of
// the yard over Student Presence and the room closures.
func buildFacilitiesRooms(db transactionruntime.Database, env owners.RootEnvironment, presence studentpresence.Owner, rooms facilitiesModule.Catalog, timetableOwner timetable.Capability, membership schoolmembership.Capability, persons peopledirectory.Capability) (FacilitiesRooms, error) {
	closures, err := owners.BuildRoomClosures(db, env.Now)
	if err != nil {
		return FacilitiesRooms{}, owners.StepError("compose room closures", err)
	}
	return FacilitiesRooms{
		Closures: closures,
		RoomService: facilitiesCompose.NewRoomService(facilitiesCompose.RoomServiceConfig{
			Rooms:     rooms,
			Occupancy: facilitiesCompose.OccupancyProjection(RoomOccupancyPresence{presence}, roomActivityNames{timetableOwner}, membership, persons),
			History:   facilitiesCompose.HistoryProjection(RoomHistoryPresence{presence}, roomActivityNames{timetableOwner}, membership, persons),
			Today:     env.Today,
		}),
		OpenGroups: facilitiesCompose.NewOpenGroupCatalog(FacilitiesGroupSupervisions(presence), FacilitiesRoomSessions(presence), FacilitiesGroupVisits(presence)),
	}, nil
}

// buildFacilitiesPresence joins the Facilities room views to the presence
// owner and retains the supervision views that run over the same sources.
func buildFacilitiesPresence(
	db transactionruntime.Database, env owners.RootEnvironment,
	presence owners.PresenceOwner, rooms facilitiesModule.Catalog,
	timetableOwner timetable.Capability, membership schoolmembership.Capability,
	persons peopledirectory.Capability, groups schoolstructure.Owner,
	structure owners.StructureRows, workTime workforceCompose.WorkTime,
) (FacilitiesRooms, owners.GroupSubstitutions, studentpresence.SupervisionRecords, error) {
	facilitiesRooms, err := buildFacilitiesRooms(db, env, presence.Presence, rooms, timetableOwner, membership, persons)
	if err != nil {
		return FacilitiesRooms{}, nil, nil, err
	}
	return facilitiesRooms,
		owners.NewGroupSubstitutionRepository(structure.Groups, membership, workTime, env.Today),
		owners.NewGroupSupervisionRecords(presence.SessionRecords, groups), nil
}

// roomClosureActor names the account of the request that closes a room, so
// its notice leaves that person out (#8234).
func roomClosureActor(ctx context.Context) int64 {
	return int64(sessiontoken.ClaimsFromCtx(ctx).ID)
}
