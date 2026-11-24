// Package messaging is the staff-side (tenant portal) HTTP surface for the
// parent-OGS messaging feature: the central inbox, per-thread chats, replies,
// and starting new conversations. Mounted at /api/messages. The parent-portal
// side lives in api/parent.
package messaging

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// Resource is the staff messaging HTTP resource.
type Resource struct {
	Service communication.ParentMessagingCapability
	// Groups serves the group threads (#4784); nil leaves them unmounted.
	Groups communication.ParentGroupThreadCapability
	// TeamHandling serves "Als gelesen bestätigen" (#6486); nil leaves the
	// route unmounted.
	TeamHandling communication.ParentMessageTeamHandling
	// Mails says what became of the e-mails of OGS messages (#7058); nil
	// leaves its routes unmounted.
	Mails communication.ParentMessageMailStatus
}

// NewResource wires the staff messaging resource.
func NewResource(service communication.ParentMessagingCapability, groups communication.ParentGroupThreadCapability, handling communication.ParentMessageTeamHandling, mails communication.ParentMessageMailStatus) *Resource {
	return &Resource{Service: service, Groups: groups, TeamHandling: handling, Mails: mails}
}

// Router returns the chi router scoped to /messages.
func (rs *Resource) Router(protectedTenantRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()

	protectedTenantRoutes(r, func(r chi.Router, withTx common.Middleware) {

		// users:read is the coarse gate; per-child access is enforced in the
		// service via authorize.CanReadStudent. Starting/sending a thread
		// deliberately requires only users:read (+ CanReadStudent), NOT
		// users:update: messaging authority is defined to equal student-read
		// authority, so any staffer who may read a child may message that child's
		// guardians — school-wide since #2329, an accepted, signed-off policy (the
		// guardian always sees the sender as "OGS <Schule>", never an individual).
		read := common.RequiresPermission(permissions.UsersRead)
		r.With(read, withTx).Get("/", rs.listInbox)
		r.With(read, withTx).Get("/unread-count", rs.unreadCount)
		r.With(read, withTx).Post("/mark-all-read", rs.markAllRead)
		// The caller's own counter scope (#3673): personal, so reading the
		// inbox is the only permission it needs.
		r.With(read, withTx).Get("/count-scope", rs.getCountScope)
		r.With(read, withTx).Put("/count-scope", rs.setCountScope)
		r.With(read, withTx).Post("/threads/open", rs.openThread)
		r.With(read, withTx).Get("/threads/{threadId}", rs.getThread)
		r.With(read, withTx).Post("/threads/{threadId}", rs.postMessage)
		r.With(read, withTx).Post("/threads/{threadId}/unread", rs.markThreadUnread)
		if rs.TeamHandling != nil {
			r.With(read, withTx).Post("/threads/{threadId}/handled", rs.markThreadHandled)
		}
		r.With(read, withTx).Get("/students/{studentId}/guardians", rs.listGuardians)
		r.With(read, withTx).Get("/reachable-students", rs.listReachableStudents)
		r.With(read, withTx).Get("/students/{studentId}/threads", rs.listStudentThreads)
		rs.mountGroupThreadRoutes(r, read, withTx)
		rs.mountMessageMailRoutes(r, read, withTx)
	})

	return r
}

// --- wire shapes (int64 ids stringified per the frontend convention) ---

type ParentChatInboxThreadResponse struct {
	ThreadID         ident.ID `json:"thread_id"`
	StudentID        ident.ID `json:"student_id"`
	StudentName      string   `json:"student_name"`
	SchoolClass      string   `json:"school_class,omitempty"`
	GroupName        string   `json:"group_name,omitempty"`
	GuardianName     string   `json:"guardian_name"`
	RelationshipType string   `json:"relationship_type,omitempty"`
	// Audience is "team" or "leadership" (#5200). A caller without the
	// leadership permission never receives a leadership row.
	Audience        string          `json:"audience"`
	Readers         ReadersResponse `json:"readers"`
	LastMessageAt   *time.Time      `json:"last_message_at,omitempty"`
	LastSenderKind  string          `json:"last_sender_kind,omitempty"`
	LastMessageBody string          `json:"last_message_body,omitempty"`
	UnreadCount     int             `json:"unread_count"`
}

// ReadersResponse says who can read a conversation (#5200): the one guardian
// it belongs to and the school side. Other guardians of the child do not read
// it. school.kind is "all_staff" or "leadership"; school.names carries the
// leadership persons' short names on the conversation itself and on the
// recipient list, and stays empty on inbox rows.
type ReadersResponse struct {
	Guardian GuardianReaderResponse `json:"guardian"`
	School   SchoolReadersResponse  `json:"school"`
}

type GuardianReaderResponse struct {
	AccountID        string `json:"account_id" contract_text:"required legacy field, empty when no guardian account is present"`
	Name             string `json:"name"`
	RelationshipType string `json:"relationship_type,omitempty"`
}

// SchoolReadersResponse names the school side. names carries only the
// leadership persons with a name; unnamed_count counts the leadership
// accounts without one, which the client names in its own language (#5200).
type SchoolReadersResponse struct {
	Kind         string   `json:"kind"`
	Names        []string `json:"names"`
	UnnamedCount int      `json:"unnamed_count"`
}

func toReadersResponse(readers communication.ParentMessageReaders) ReadersResponse {
	names, unnamed := communication.SplitParentMessageLeaderNames(readers.School.Names)
	accountID := ""
	if readers.Guardian.AccountID > 0 {
		accountID = ident.ID(readers.Guardian.AccountID).String()
	}
	return ReadersResponse{
		Guardian: GuardianReaderResponse{
			AccountID: accountID, Name: readers.Guardian.Name, RelationshipType: readers.Guardian.RelationshipType,
		},
		School: SchoolReadersResponse{Kind: readers.School.Kind, Names: names, UnnamedCount: unnamed},
	}
}

type ParentChatMessageResponse struct {
	ClientMessageID string          `json:"client_message_id,omitempty" contract_text:"client-supplied message deduplication key"`
	ID              ident.ID        `json:"id"`
	SenderKind      string          `json:"sender_kind"`
	SenderName      string          `json:"sender_name"`
	Body            string          `json:"body"`
	CreatedAt       time.Time       `json:"created_at"`
	Kind            string          `json:"kind"`
	EventType       string          `json:"event_type,omitempty"`
	EventActorKind  string          `json:"event_actor_kind,omitempty"`
	RequestType     string          `json:"request_type,omitempty"`
	RequestStatus   string          `json:"request_status,omitempty"`
	Payload         json.RawMessage `json:"payload,omitempty" contract_json:"The message kind selects an extensible event payload, including historical kinds"`
	RefTable        string          `json:"ref_table,omitempty"`
	RefID           *ident.ID       `json:"ref_id,omitempty"`
	AppliedAt       *time.Time      `json:"applied_at,omitempty"`
	AppliedBy       *ident.ID       `json:"applied_by,omitempty"`
	DecisionReason  string          `json:"decision_reason,omitempty"`
	ReadByStaff     bool            `json:"read_by_staff,omitempty"`
	ReadByGuardian  bool            `json:"read_by_guardian,omitempty"`
	// GroupThreadID and GroupThreadTitle name the group thread a guardian's
	// message answers (#4784).
	GroupThreadID    *ident.ID `json:"group_thread_id,omitempty"`
	GroupThreadTitle string    `json:"group_thread_title,omitempty"`
	// Attachments are the photos and files of the message (#6685).
	Attachments []ParentMessageAttachmentResponse `json:"attachments,omitempty"`
}

type ParentChatThreadDetailResponse struct {
	ThreadID         ident.ID                    `json:"thread_id"`
	StudentID        ident.ID                    `json:"student_id"`
	StudentName      string                      `json:"student_name"`
	GuardianName     string                      `json:"guardian_name"`
	RelationshipType string                      `json:"relationship_type,omitempty"`
	Audience         string                      `json:"audience"`
	Readers          ReadersResponse             `json:"readers"`
	Messages         []ParentChatMessageResponse `json:"messages"`
}

// ReachableStudentsResponse lists the children with at least one guardian
// the recipient step would offer.
type ReachableStudentsResponse struct {
	StudentIDs []ident.ID `json:"student_ids"`
}

// MessageableGuardianResponse is one recipient for a new conversation. readers says
// who would read the conversation with this guardian in the requested
// audience (?audience=team|leadership, default team, #5200);
// leadership_available tells a leadership member whether a new leadership
// conversation may begin and is false for every other caller.
type MessageableGuardianResponse struct {
	AccountID           ident.ID        `json:"account_id"`
	Name                string          `json:"name"`
	RelationshipType    string          `json:"relationship_type,omitempty"`
	IsPrimary           bool            `json:"is_primary"`
	Readers             ReadersResponse `json:"readers"`
	LeadershipAvailable bool            `json:"leadership_available"`
}

type ParentChatPostMessageRequest struct {
	ClientMessageID      string `json:"client_message_id,omitempty" contract_text:"client-supplied message deduplication key"`
	Body                 string `json:"body"`
	HandledUpToMessageID string `json:"handled_up_to_message_id,omitempty" contract_text:"empty string means send without confirming a message"`
	// AttachmentIDs names the uploads the message carries (#6685).
	AttachmentIDs []ident.ID `json:"attachment_ids,omitempty"`
}

// OpenThreadRequest takes an optional audience, "team" (default) or
// "leadership" (#5200).
type OpenThreadRequest struct {
	StudentID         ident.ID `json:"student_id"`
	GuardianAccountID ident.ID `json:"guardian_account_id"`
	Audience          string   `json:"audience,omitempty"`
}

func toMessageResponses(messages []communication.ParentMessage, viewer ...int64) []ParentChatMessageResponse {
	out := make([]ParentChatMessageResponse, 0, len(messages))
	for _, m := range messages {
		out = append(out, ParentChatMessageResponse{
			ID:              ident.ID(m.ID),
			SenderKind:      m.SenderKind,
			SenderName:      m.SenderName,
			ClientMessageID: clientMessageIDForViewer(m.ClientMessageID, m.SenderAccountID, viewer), Body: m.Body,
			CreatedAt:        m.CreatedAt,
			Kind:             m.Kind,
			EventType:        m.EventType,
			EventActorKind:   m.EventActorKind,
			RequestType:      m.RequestType,
			RequestStatus:    m.RequestStatus,
			Payload:          m.Payload,
			RefTable:         m.RefTable,
			RefID:            (*ident.ID)(m.RefID),
			AppliedAt:        m.AppliedAt,
			AppliedBy:        (*ident.ID)(m.AppliedBy),
			DecisionReason:   m.DecisionReason,
			ReadByStaff:      m.ReadByStaff,
			ReadByGuardian:   m.ReadByGuardian,
			GroupThreadID:    (*ident.ID)(m.GroupThreadID),
			GroupThreadTitle: m.GroupThreadTitle,
			Attachments:      toAttachmentResponses(m.Attachments),
		})
	}
	return out
}

func toThreadDetail(d *communication.ParentMessageThread, viewer ...int64) ParentChatThreadDetailResponse {
	return ParentChatThreadDetailResponse{
		ThreadID:         ident.ID(d.ThreadID),
		StudentID:        ident.ID(d.StudentID),
		StudentName:      d.StudentName,
		GuardianName:     d.GuardianName,
		RelationshipType: d.RelationshipType,
		Audience:         d.Audience,
		Readers:          toReadersResponse(d.Readers),
		Messages:         toMessageResponses(d.Messages, viewer...),
	}
}

func (rs *Resource) listInbox(w http.ResponseWriter, r *http.Request) {
	rows, err := rs.Service.ListParentMessageInbox(
		r.Context(),
		r.URL.Query().Get("unread") == "true",
	)
	if err != nil {
		renderMessagingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, toInboxThreadResponses(rows), "Inbox retrieved")
}

func toInboxThreadResponses(rows []communication.ParentMessageInboxThread) []ParentChatInboxThreadResponse {
	out := make([]ParentChatInboxThreadResponse, 0, len(rows))
	for _, t := range rows {
		out = append(out, ParentChatInboxThreadResponse{
			ThreadID:         ident.ID(t.ThreadID),
			StudentID:        ident.ID(t.StudentID),
			StudentName:      t.StudentName,
			SchoolClass:      t.SchoolClass,
			GroupName:        t.GroupName,
			GuardianName:     t.GuardianName,
			RelationshipType: t.RelationshipType,
			Audience:         t.Audience,
			Readers:          toReadersResponse(t.Readers),
			LastMessageAt:    t.LastMessageAt,
			LastSenderKind:   t.LastSenderKind,
			LastMessageBody:  t.LastMessageBody,
			UnreadCount:      t.UnreadCount,
		})
	}
	return out
}

// listStudentThreads returns one child's conversations (staff view), so the
// student-detail card fetches only that child's threads instead of the whole
// tenant inbox.
func (rs *Resource) listStudentThreads(w http.ResponseWriter, r *http.Request) {
	studentID, ok := parseInt64Param(w, r, "studentId", "student")
	if !ok {
		return
	}
	rows, err := rs.Service.ListParentMessageThreadsForStudent(r.Context(), studentID)
	if err != nil {
		renderMessagingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, toInboxThreadResponses(rows), "Student threads retrieved")
}

func (rs *Resource) unreadCount(w http.ResponseWriter, r *http.Request) {
	count, err := rs.Service.CountUnreadParentMessages(r.Context())
	if err != nil {
		renderMessagingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, ParentChatUnreadCountResponse{UnreadCount: count}, "Unread count retrieved")
}

func (rs *Resource) getThread(w http.ResponseWriter, r *http.Request) {
	threadID, ok := parseInt64Param(w, r, "threadId", "thread")
	if !ok {
		return
	}
	detail, err := rs.Service.GetParentMessageThread(r.Context(), threadID)
	if err != nil {
		renderMessagingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, toThreadDetail(detail, messageViewer(r)), "Thread retrieved")
}

// markAllRead marks every conversation the caller sees as unread as read for
// the caller's own account (#3663). It answers with the caller's new unread
// count, which stays above zero while team-marked conversations remain.
func (rs *Resource) markAllRead(w http.ResponseWriter, r *http.Request) {
	count, err := rs.Service.MarkAllParentMessagesRead(r.Context())
	if err != nil {
		renderMessagingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, ParentChatUnreadCountResponse{UnreadCount: count}, "Messages marked read")
}

// ParentChatUnreadCountResponse is the caller's number of unread conversations.
type ParentChatUnreadCountResponse struct {
	UnreadCount int `json:"unread_count"`
}

// CountScopeRequest sets the caller's count scope: "all", "own_groups" or
// "none".
type CountScopeRequest struct {
	Scope string `json:"scope"`
}

// CountScopeSavedResponse answers the count scope the caller saved.
type CountScopeSavedResponse struct {
	Scope string `json:"scope"`
}

// CountScopeResponse adds whether the caller has an OGS group today, so the
// setting can say when "own_groups" would count nothing.
type CountScopeResponse struct {
	Scope        string `json:"scope"`
	HasOwnGroups bool   `json:"has_own_groups"`
}

func (rs *Resource) getCountScope(w http.ResponseWriter, r *http.Request) {
	setting, err := rs.Service.ParentMessageCountScope(r.Context())
	if err != nil {
		renderMessagingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, CountScopeResponse{Scope: setting.Scope, HasOwnGroups: setting.HasOwnGroups}, "Count scope retrieved")
}

func (rs *Resource) setCountScope(w http.ResponseWriter, r *http.Request) {
	var req CountScopeRequest
	if err := wire.Decode(r.Body, &req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid request body")))
		return
	}
	if err := rs.Service.SetParentMessageCountScope(r.Context(), req.Scope); err != nil {
		renderMessagingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, CountScopeSavedResponse(req), "Count scope saved")
}

// markThreadUnread marks the conversation unread for the whole team (#3654).
func (rs *Resource) markThreadUnread(w http.ResponseWriter, r *http.Request) {
	threadID, ok := parseInt64Param(w, r, "threadId", "thread")
	if !ok {
		return
	}
	if err := rs.Service.MarkParentMessageThreadUnread(r.Context(), threadID); err != nil {
		renderMessagingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, nil, "Thread marked unread")
}

// MarkHandledRequest names the last timeline row the client displayed.
type MarkHandledRequest struct {
	HandledUpToMessageID ident.ID `json:"handled_up_to_message_id"`
}

// markThreadHandled confirms the guardian activity for the whole team without a
// reply (#6486): the child card's "Als gelesen bestätigen".
func (rs *Resource) markThreadHandled(w http.ResponseWriter, r *http.Request) {
	threadID, ok := parseInt64Param(w, r, "threadId", "thread")
	if !ok {
		return
	}
	var req MarkHandledRequest
	if err := wire.Decode(r.Body, &req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid request body")))
		return
	}
	handledUpToMessageID := req.HandledUpToMessageID.Int64()
	if handledUpToMessageID <= 0 {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid handled message ID")))
		return
	}
	if err := rs.TeamHandling.MarkParentMessageThreadHandled(r.Context(), threadID, handledUpToMessageID); err != nil {
		renderMessagingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, nil, "Thread confirmed for the team")
}

func (rs *Resource) postMessage(w http.ResponseWriter, r *http.Request) {
	threadID, ok := parseInt64Param(w, r, "threadId", "thread")
	if !ok {
		return
	}
	var req ParentChatPostMessageRequest
	if err := wire.Decode(r.Body, &req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid request body")))
		return
	}
	var handledUpToMessageID int64
	if req.HandledUpToMessageID != "" {
		parsed, parseErr := strconv.ParseInt(req.HandledUpToMessageID, 10, 64)
		if parseErr != nil || parsed <= 0 {
			common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid handled message ID")))
			return
		}
		handledUpToMessageID = parsed
	}
	attachmentIDs, ok := common.ParseMessageSend(w, r, req.ClientMessageID, req.AttachmentIDs, communication.MaxMessageAttachments)
	if !ok {
		return
	}
	sendCtx := communication.WithMessageSend(r.Context(), req.ClientMessageID, attachmentIDs)

	messages, err := rs.Service.PostParentMessage(sendCtx, threadID, req.Body, handledUpToMessageID)
	if err != nil {
		renderMessagingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusCreated, toMessageResponses(messages, messageViewer(r)), "Message sent")
}

func (rs *Resource) openThread(w http.ResponseWriter, r *http.Request) {
	var req OpenThreadRequest
	if err := wire.Decode(r.Body, &req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid request body")))
		return
	}
	studentID := req.StudentID.Int64()
	if studentID <= 0 {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid student ID")))
		return
	}
	guardianID := req.GuardianAccountID.Int64()
	if guardianID <= 0 {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid guardian ID")))
		return
	}
	detail, err := rs.Service.OpenParentMessageThread(r.Context(), studentID, guardianID, req.Audience)
	if err != nil {
		renderMessagingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, toThreadDetail(detail, messageViewer(r)), "Conversation opened")
}

func (rs *Resource) listGuardians(w http.ResponseWriter, r *http.Request) {
	studentID, ok := parseInt64Param(w, r, "studentId", "student")
	if !ok {
		return
	}
	guardians, err := rs.Service.ListMessageableGuardians(r.Context(), studentID, r.URL.Query().Get("audience"))
	if err != nil {
		renderMessagingError(w, r, err)
		return
	}
	out := make([]MessageableGuardianResponse, 0, len(guardians))
	for _, g := range guardians {
		out = append(out, MessageableGuardianResponse{
			AccountID:           ident.ID(g.AccountID),
			Name:                g.Name,
			RelationshipType:    g.RelationshipType,
			IsPrimary:           g.IsPrimary,
			Readers:             toReadersResponse(g.Readers),
			LeadershipAvailable: g.LeadershipAvailable,
		})
	}
	common.Respond(w, r, http.StatusOK, out, "Guardians retrieved")
}

func (rs *Resource) listReachableStudents(w http.ResponseWriter, r *http.Request) {
	ids, err := rs.Service.ListParentMessageReachableStudents(r.Context())
	if err != nil {
		renderMessagingError(w, r, err)
		return
	}
	out := ReachableStudentsResponse{StudentIDs: make([]ident.ID, 0, len(ids))}
	for _, id := range ids {
		out.StudentIDs = append(out.StudentIDs, ident.ID(id))
	}
	common.Respond(w, r, http.StatusOK, out, "Reachable students retrieved")
}

func parseInt64Param(w http.ResponseWriter, r *http.Request, param, label string) (int64, bool) {
	return common.ParsePositiveInt64IDWithError(w, r, param, "invalid "+label+" ID")
}

// renderMessagingError maps service sentinels to HTTP status codes.
func renderMessagingError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, communication.ErrMessageSendConflict) {
		common.RenderError(w, r, common.ErrorConflictWithCode(err, common.CodeCommunicationMessageSendConflict))
		return
	}
	switch {
	case errors.Is(err, communication.ErrMessageAttachmentLimit):
		common.RenderError(w, r, common.ErrorConflictWithCode(err, common.CodeFilesAttachmentLimitReached))
	case errors.Is(err, communication.ErrMessageAttachmentUnavailable):
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
	case errors.Is(err, communication.ErrParentMessageThreadNotFound):
		common.RenderError(w, r, common.ErrorNotFound(err))
	case errors.Is(err, communication.ErrParentMessagingDisabled):
		common.RenderError(w, r, common.ErrorForbiddenWithCode(err, common.CodeCommunicationParentMessagingDisabled))
	case errors.Is(err, communication.ErrParentMessagingForbidden):
		common.RenderError(w, r, common.ErrorForbidden(err))
	case errors.Is(err, communication.ErrParentMessageEmptyBody),
		errors.Is(err, communication.ErrParentMessageBodyTooLong),
		errors.Is(err, communication.ErrParentMessageInvalidGuardian),
		errors.Is(err, communication.ErrParentMessageInvalidCountScope),
		errors.Is(err, communication.ErrParentMessageInvalidAudience):
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
	case errors.Is(err, communication.ErrParentMessageLeadershipUnavailable):
		common.RenderError(w, r, common.ErrorForbiddenWithCode(err, common.CodeCommunicationLeadershipMessagesUnavailable))
	case errors.Is(err, communication.ErrParentMessageGuardianAccessRevoked):
		common.RenderError(w, r, common.ErrorConflictMessage("Der Empfänger hat keinen Zugriff mehr auf dieses Kind."))
	case errors.Is(err, communication.ErrParentMessageHandledBoundaryRequired):
		common.RenderError(w, r, common.ErrorConflictMessage("Der Nachrichtenverlauf hat sich geändert. Bitte lade die Seite neu."))
	default:
		common.RenderError(w, r, common.ErrorInternalServerWrap("messaging request failed", err))
	}
}

// Only the author receives the opaque key. Another account may legitimately
// use the same key in its own namespace; that must not confirm this viewer's send.
func clientMessageIDForViewer(key string, sender int64, viewer []int64) string {
	if len(viewer) == 0 || viewer[0] <= 0 || viewer[0] != sender {
		return ""
	}
	return key
}

func messageViewer(r *http.Request) int64 {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil {
		return 0
	}
	return principal.AccountID()
}
