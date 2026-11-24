package supervisiondashboard

import (
	"context"
	"log/slog"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

type ContextStatus string

const (
	ContextOK          ContextStatus = "ok"
	ContextForbidden   ContextStatus = "forbidden"
	ContextUnavailable ContextStatus = "unavailable"
)

type ContextSections struct {
	Groups, Sessions, ReleasedRooms bool
}

type NavigationContext struct {
	Groups        *ContextGroups   `json:"groups,omitempty"`
	Sessions      *ContextSessions `json:"sessions,omitempty"`
	ReleasedRooms *ContextRooms    `json:"released_rooms,omitempty"`
}

type ContextGroups struct {
	Status       ContextStatus            `json:"status"`
	Navigation   []ContextNavigationGroup `json:"navigation"`
	OwnGroupIDs  []ident.ID               `json:"own_group_ids"`
	OwnRoomNames []string                 `json:"own_room_names"`
}

type ContextNavigationGroup struct {
	ID              ident.ID  `json:"id"`
	Name            string    `json:"name"`
	RoomID          *ident.ID `json:"room_id,omitempty"`
	RoomName        string    `json:"room_name,omitempty"`
	ViaSubstitution bool      `json:"via_substitution"`
	IsPersonal      bool      `json:"is_personal"`
	Leaders         []string  `json:"leaders,omitempty"`
}

type ContextSessions struct {
	Status         ContextStatus    `json:"status"`
	OverviewStatus ContextStatus    `json:"overview_status"`
	OwnStatus      ContextStatus    `json:"own_status"`
	Items          []ContextSession `json:"items"`
}

type ContextSession struct {
	ID           ident.ID `json:"id"`
	RoomID       ident.ID `json:"room_id"`
	RoomName     string   `json:"room_name"`
	ActivityName string   `json:"activity_name"`
	// nil means the caller's assignment could not be read.
	IsOwn *bool `json:"is_own"`
}

type ContextRooms struct {
	Status ContextStatus `json:"status"`
	Items  []ContextRoom `json:"items"`
}

type ContextRoom struct {
	ID   ident.ID `json:"id"`
	Name string   `json:"name"`
}

// ContextSessionSource reads from the caller's school transaction. A nil ID
// slice selects the school overview; a non-nil slice selects only those open
// sessions. Only the projection may pass nil, after checking overview access.
type ContextSessionSource interface {
	StaffID(context.Context) (int64, error)
	CanReadOverview(context.Context, int64, error) (bool, error)
	OpenSessions(context.Context, []int64) ([]ContextSession, error)
}

type ContextReader struct {
	Groups        func(context.Context) (ContextGroups, error)
	Sessions      ContextSessionSource
	OwnSessionIDs func(context.Context, int64) ([]int64, error)
	ReleasedRooms func(context.Context) ([]ContextRoom, error)
	CanReadRooms  func(context.Context) bool
	Savepoint     func(context.Context, func(context.Context) error) error
	Fatal         func(error) bool
	Logger        *slog.Logger
}

func (q ContextReader) SupervisionContext(ctx context.Context, sections ContextSections) (NavigationContext, error) {
	var result NavigationContext
	if sections.Groups {
		groups, err := q.readGroups(ctx)
		if err != nil {
			return result, err
		}
		result.Groups = &groups
	}
	if sections.Sessions {
		sessions, err := q.readSessions(ctx)
		if err != nil {
			return result, err
		}
		result.Sessions = &sessions
	}
	if sections.ReleasedRooms {
		rooms := ContextRooms{Status: ContextForbidden, Items: []ContextRoom{}}
		if q.CanReadRooms(ctx) {
			loaded, status, err := readContextSource(ctx, q, "released_rooms", q.ReleasedRooms)
			if err != nil {
				return result, err
			}
			rooms.Status = status
			rooms.Items = append(rooms.Items, loaded...)
		}
		result.ReleasedRooms = &rooms
	}
	return result, nil
}

func (q ContextReader) readGroups(ctx context.Context) (ContextGroups, error) {
	groups, status, err := readContextSource(ctx, q, "groups", q.Groups)
	groups.Status = status
	if status != ContextOK {
		groups.Navigation = []ContextNavigationGroup{}
		groups.OwnGroupIDs = []ident.ID{}
		groups.OwnRoomNames = []string{}
	}
	return groups, err
}

func (q ContextReader) readSessions(ctx context.Context) (ContextSessions, error) {
	result := ContextSessions{Status: ContextUnavailable, Items: []ContextSession{}}
	var staffID int64
	var staffErr error
	own, ownStatus, err := readContextSource(ctx, q, "own_supervisions", func(ctx context.Context) ([]int64, error) {
		staffID, staffErr = q.Sessions.StaffID(ctx)
		if staffErr != nil || staffID == 0 {
			return nil, staffErr
		}
		return q.OwnSessionIDs(ctx, staffID)
	})
	if err != nil {
		return result, err
	}
	result.OwnStatus = ownStatus
	overview, status, err := q.readOverview(ctx, staffID, staffErr)
	if err != nil {
		return result, err
	}
	result.OverviewStatus = status
	if status == ContextOK {
		if ownStatus == ContextOK {
			markContextOwnership(overview, own)
		}
		result.Items = append(result.Items, overview...)
		result.Status = ContextOK
		return result, nil
	}
	if ownStatus != ContextOK || len(own) == 0 {
		result.Status = ownStatus
		return result, nil
	}
	return q.readOwnSessionDisplay(ctx, result, own)
}

func markContextOwnership(sessions []ContextSession, own []int64) {
	ids := make(map[int64]bool, len(own))
	for _, id := range own {
		ids[id] = true
	}
	for i := range sessions {
		sessions[i].IsOwn = new(ids[sessions[i].ID.Int64()])
	}
}

func (q ContextReader) readOverview(ctx context.Context, staffID int64, staffErr error) ([]ContextSession, ContextStatus, error) {
	allowed := false
	items, status, err := readContextSource(ctx, q, "supervision_overview", func(ctx context.Context) ([]ContextSession, error) {
		var err error
		allowed, err = q.Sessions.CanReadOverview(ctx, staffID, staffErr)
		if err != nil || !allowed {
			return nil, err
		}
		return q.Sessions.OpenSessions(ctx, nil)
	})
	if status == ContextOK && !allowed {
		status = ContextForbidden
	}
	return items, status, err
}

func (q ContextReader) readOwnSessionDisplay(ctx context.Context, result ContextSessions, ids []int64) (ContextSessions, error) {
	items, status, err := readContextSource(ctx, q, "own_session_display", func(ctx context.Context) ([]ContextSession, error) {
		return q.Sessions.OpenSessions(ctx, ids)
	})
	if err != nil {
		return result, err
	}
	result.Status, result.OwnStatus = status, status
	for i := range items {
		items[i].IsOwn = new(true)
	}
	result.Items = append(result.Items, items...)
	return result, nil
}

// A section's SQL error is recoverable only if the rollback to the savepoint
// succeeded and the request is still live. Failed sources never expose rows.
func readContextSource[T any](ctx context.Context, q ContextReader, source string, load func(context.Context) (T, error)) (T, ContextStatus, error) {
	var loaded T
	err := q.Savepoint(ctx, func(ctx context.Context) error {
		var err error
		loaded, err = load(ctx)
		return err
	})
	if err == nil {
		return loaded, ContextOK, nil
	}
	var empty T
	if q.Fatal(err) || ctx.Err() != nil {
		return empty, ContextUnavailable, err
	}
	q.Logger.WarnContext(ctx, "supervision context source unavailable",
		"source", source,
		"error", err,
	)
	return empty, ContextUnavailable, nil
}
