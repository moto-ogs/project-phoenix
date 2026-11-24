// Package requestreview is the shared request-review read projection (#2705):
// the one staff-facing list of every parent request awaiting or carrying a
// decision — Stammdaten, Betreuungszeiten, Angebote, Abwesenheiten and the
// office's own booking corrections — showing origin, type, child, requested
// change and decision. The owner queues stay separate; the projection owns
// the merged order, the keyset paging, the permission narrowing, the bulk and
// past consequences, the conflict grouping and the badge count. Every foreign
// fact enters through a consumer-owned port; the projection persists nothing
// and never writes.
package requestreview

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// ErrNotConfigured reports a missing queue or access port.
var ErrNotConfigured = errors.New("request review projection is not configured")

// Query is the single public capability of the projection.
type Query interface {
	// ListRequests serves the open queue (view=open) or the decision history
	// (view=history) as one keyset page.
	ListRequests(ctx context.Context, query ListQuery) (Page, error)
	// PendingCount is the number of open requests across the queues the
	// caller may review — the sidebar badge.
	PendingCount(ctx context.Context) (int, error)
}

// Dependencies are the consumer-owned ports the projection reads through.
// Queues and Access are required. Students, FamilyProtection and Submitters
// are optional: without them the open page omits group names and reports no
// Familienschutz, and no row of either view names who filed it. Today is the
// Berlin calendar day the composition binds (ADR 0239); it is resolved once
// per call so the queues' urgency phase and the rows' urgency and past flags
// never straddle midnight.
type Dependencies struct {
	Queues           Queues
	Access           Access
	Students         StudentDirectory
	FamilyProtection FamilyProtection
	Submitters       SubmitterDirectory
	Today            func() Date
}

type service struct{ deps Dependencies }

// New builds the projection. Missing wiring surfaces as ErrNotConfigured on
// the first call, never as a partial list.
func New(deps Dependencies) Query {
	return &service{deps: deps}
}

// NewChecked rejects incomplete native wiring during composition.
func NewChecked(deps Dependencies) (Query, error) {
	if err := (&service{deps: deps}).configured(); err != nil {
		return nil, err
	}
	return New(deps), nil
}

// Wire names of the request types. They double as the cursor's map keys.
const (
	TypeMasterData   = "master_data"
	TypeCareSchedule = "care_schedule"
	TypeOffering     = "offering"
	TypeExcused      = "excused"
	// TypeDirectCorrection is not a request: it is the office's own
	// correction to a child's bookings (#2436). History only.
	TypeDirectCorrection = "direct_correction"
)

// TypeOrder is the canonical type order — it decides the deterministic
// tie-break when two rows of different types share an instant.
var TypeOrder = []string{
	TypeMasterData,
	TypeCareSchedule,
	TypeOffering,
	TypeExcused,
	TypeDirectCorrection,
}

// Stable codes and German sentences of the bulk consequences the projection
// itself decides. Other reasons come from the owner queues.
const (
	BulkIneligiblePast     = "past"
	bulkIneligiblePastText = "Diese Anfrage betrifft nur vergangene Tage."
)

// Item is one request of any of the four types. On the wire it is an item of
// the open list, and the member named like RequestType carries its queue
// projection; HistoryPageOf turns the items of a history page into HistoryItem.
type Item struct {
	RequestType string `json:"request_type"`
	// OccurredAt is the instant the row is ordered by: the submission on the
	// open view, the decision in the history. The client merges this list with
	// the separately gated Anmeldungsänderungen (#2435) on it.
	OccurredAt      time.Time `json:"occurred_at"`
	StudentID       ident.ID  `json:"student_id"`
	StudentName     string    `json:"student_name"`
	GroupName       string    `json:"group_name,omitempty"`
	ExpectedVersion string    `json:"expected_version"`
	UrgentToday     bool      `json:"urgent_today"`
	// Past marks a request whose whole scope lies before today: approving it
	// would change nothing, so the client offers reject or "als erledigt".
	Past         bool `json:"past"`
	BulkEligible bool `json:"bulk_eligible"`
	// BulkIneligibleReason is a STABLE CODE (past, conflict, stale,
	// single_only, child_unavailable, access_revoked). The German sentence
	// travels separately so a client can render an unknown code.
	BulkIneligibleReason string `json:"bulk_ineligible_reason,omitempty"`
	BulkIneligibleText   string `json:"bulk_ineligible_text,omitempty"`
	// ConflictKeys name what this request would write. Two open requests of
	// one child sharing a key contradict each other and must be resolved
	// together, never one after the other.
	ConflictKeys []string `json:"conflict_keys,omitempty"`
	// ConflictKey is the key this request is most contended on, and
	// ConflictGroupSize how many open requests of this child share it
	// (1 = nothing to resolve). The client groups on ConflictKey.
	ConflictKey       string `json:"conflict_key,omitempty"`
	ConflictGroupSize int    `json:"conflict_group_size,omitempty"`
	// CurrentValueChanged warns that the OGS changed this value after the
	// request was filed. Emitted for Stammdaten and Abwesenheiten, where a
	// submission baseline exists; omitted for the other types.
	CurrentValueChanged *bool `json:"current_value_changed,omitempty"`
	// CurrentStatusByDate is what each requested day looks like today
	// (present, sick, excused, class_trip). Absence requests only.
	CurrentStatusByDate map[string]string `json:"current_status_by_date,omitempty"`
	// PartialAbsenceFromByDate names the requested days a staff-entered
	// partial absence holds, date -> "HH:MM" (#5698). Absence requests only;
	// approving them replaces those entries after an explicit confirmation.
	PartialAbsenceFromByDate map[string]string `json:"partial_absence_from_by_date,omitempty"`
	FamilyProtected          bool              `json:"family_protected"`
	// SubmittedByName is who filed the request (#4359), and
	// SubmittedByRelationship their stored relationship to the child. Both
	// are omitted when the school does not know the filer (any more) or keeps
	// no relationship; the client then names nobody rather than guessing.
	SubmittedByName         string `json:"submitted_by_name,omitempty"`
	SubmittedByRelationship string `json:"submitted_by_relationship,omitempty"`
	// MasterData, CareSchedule, Offering and Excused carry the projection
	// of the open list: the member named like RequestType is set.
	MasterData   *MasterDataChangeRequestResponse `json:"master_data,omitempty"`
	CareSchedule *CareRequestResponse             `json:"care_schedule,omitempty"`
	Offering     *OfferingRequestResponse         `json:"offering,omitempty"`
	Excused      *StaffExcusedRequestResponse     `json:"excused,omitempty"`
	// payload is Row.Payload, kept for the history item.
	payload Payload
	// canCorrect is Row.CanCorrect, kept for the history item.
	canCorrect bool
	// submittedBy is Row.SubmittedBy; the wire carries the name instead.
	submittedBy int64
}

// HistoryItem is one decided request, or an office correction, of
// GET /change-requests/history. The member named like RequestType carries
// its projection.
type HistoryItem struct {
	RequestType     string    `json:"request_type"`
	OccurredAt      time.Time `json:"occurred_at"`
	StudentID       ident.ID  `json:"student_id"`
	StudentName     string    `json:"student_name"`
	GroupName       string    `json:"group_name,omitempty"`
	ExpectedVersion string    `json:"expected_version"`
	// CanCorrect marks a decision staff can still rewrite.
	CanCorrect              bool                                    `json:"can_correct,omitempty"`
	FamilyProtected         bool                                    `json:"family_protected"`
	SubmittedByName         string                                  `json:"submitted_by_name,omitempty"`
	SubmittedByRelationship string                                  `json:"submitted_by_relationship,omitempty"`
	MasterData              *MasterDataChangeRequestHistoryResponse `json:"master_data,omitempty"`
	CareSchedule            *CareRequestHistoryResponse             `json:"care_schedule,omitempty"`
	Offering                *OfferingRequestHistoryResponse         `json:"offering,omitempty"`
	Excused                 *StaffExcusedRequestHistoryResponse     `json:"excused,omitempty"`
	DirectCorrection        *DirectCorrectionResponse               `json:"direct_correction,omitempty"`
}

// HistoryPage is the cursor envelope of the history.
type HistoryPage struct {
	Items []HistoryItem `json:"items"`
	// NextCursor is absent on the last page. It is only valid for the exact
	// filter set it was produced with.
	NextCursor string `json:"next_cursor,omitempty"`
}

// HistoryPageOf turns a page of the history view into the history's own
// envelope.
func HistoryPageOf(page Page) HistoryPage {
	history := HistoryPage{Items: make([]HistoryItem, 0, len(page.Items)), NextCursor: page.NextCursor}
	for _, item := range page.Items {
		history.Items = append(history.Items, HistoryItem{
			RequestType: item.RequestType, OccurredAt: item.OccurredAt, StudentID: item.StudentID,
			StudentName: item.StudentName, GroupName: item.GroupName, ExpectedVersion: item.ExpectedVersion,
			CanCorrect: item.canCorrect, FamilyProtected: item.FamilyProtected,
			SubmittedByName: item.SubmittedByName, SubmittedByRelationship: item.SubmittedByRelationship,
			MasterData: item.payload.MasterDataHistory, CareSchedule: item.payload.CareScheduleHistory,
			Offering: item.payload.OfferingHistory, Excused: item.payload.ExcusedHistory,
			DirectCorrection: item.payload.DirectCorrection,
		})
	}
	return history
}

// Page is the cursor envelope of the list.
type Page struct {
	Items []Item `json:"items"`
	// NextCursor is absent on the last page. It is only valid for the exact
	// filter set it was produced with.
	NextCursor string `json:"next_cursor,omitempty"`
	// ReviewAccess tells the client WHY an open list may be empty:
	// "admin" (school-wide), "group_leader" (own groups only), or "none"
	// (the school has not enabled group-leader decisions). History omits it.
	ReviewAccess string `json:"review_access,omitempty"`
}

func (s *service) configured() error {
	q := s.deps.Queues
	if q.MasterData == nil || q.CareSchedule == nil || q.Offering == nil || q.Excused == nil ||
		q.DirectCorrections == nil || s.deps.Access == nil || s.deps.Today == nil {
		return ErrNotConfigured
	}
	return nil
}

// ListRequests serves the unified Eltern request list. Which queues
// contribute follows each queue's own gate: a caller without the write-queue
// right gets only the excused queue (#2232). Per-child scoping happens inside
// the owner queues, exactly as on the per-type routes.
func (s *service) ListRequests(ctx context.Context, query ListQuery) (Page, error) {
	if err := s.configured(); err != nil {
		return Page{}, err
	}
	if err := query.validate(); err != nil {
		return Page{}, err
	}
	caller, err := s.deps.Access.Caller(ctx)
	if err != nil {
		return Page{}, err
	}
	if !caller.ReviewsWriteQueues {
		query.Types = intersectTypes(query.Types, TypeExcused)
	}
	query.today = s.deps.Today()

	page, err := s.page(ctx, &query)
	if err != nil {
		return Page{}, err
	}
	if !query.History {
		if err := s.decorateOpenPage(ctx, &page, query.Types, query.today); err != nil {
			return Page{}, err
		}
	}
	if s.deps.Submitters != nil {
		if err := s.decorateSubmitters(ctx, &page); err != nil {
			return Page{}, err
		}
	}
	return page, nil
}

// PendingCount sums every queue the caller can actually open on the
// Änderungsanfragen page: a request missing from the count is a request
// nobody looks at until someone happens to open the page. The excused queue
// always counts (its route also accepts users:absence); the three
// users:update-gated queues count only for callers who hold that right,
// because a badge for a queue that answers 403 is worse than no badge.
func (s *service) PendingCount(ctx context.Context) (int, error) {
	if err := s.configured(); err != nil {
		return 0, err
	}
	today := s.deps.Today()
	pending, err := s.deps.Queues.Excused.OpenCount(ctx, today)
	if err != nil {
		return 0, err
	}
	caller, err := s.deps.Access.Caller(ctx)
	if err != nil {
		return 0, err
	}
	if !caller.ReviewsWriteQueues {
		return pending, nil
	}
	for _, queue := range []Queue{s.deps.Queues.MasterData, s.deps.Queues.CareSchedule, s.deps.Queues.Offering} {
		count, err := queue.OpenCount(ctx, today)
		if err != nil {
			return 0, err
		}
		pending += count
	}
	return pending, nil
}
