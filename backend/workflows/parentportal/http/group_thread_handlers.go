package parent

import (
	"errors"
	"net/http"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// GroupThreadChildResponse is one of the guardian's own children a group
// thread reached. Other families never appear.
type GroupThreadChildResponse struct {
	StudentID ident.ID `json:"student_id"`
	FirstName string   `json:"first_name"`
	LastName  string   `json:"last_name"`
}

// GroupThreadSummaryResponse is one row of the guardian's group thread list.
type GroupThreadSummaryResponse struct {
	ID              ident.ID                   `json:"id"`
	Title           string                     `json:"title"`
	TargetLabel     string                     `json:"target_label"`
	SchoolName      string                     `json:"school_name"`
	CounterpartName string                     `json:"counterpart_name"`
	Closed          bool                       `json:"closed"`
	LastMessageAt   *time.Time                 `json:"last_message_at,omitempty"`
	LastMessageBody string                     `json:"last_message_body"`
	Unread          int                        `json:"unread"`
	Children        []GroupThreadChildResponse `json:"children"`
	// Readers says who reads the guardian's answer (#5200): it goes to the
	// child's team conversation, so school.kind is always "all_staff". Other
	// parents never see it.
	Readers ParentReadersResponse `json:"readers"`
}

// GroupMessageResponse is one OGS message of a group thread. The sender is
// always the OGS.
type GroupMessageResponse struct {
	ID        ident.ID  `json:"id"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
	// Attachments are the photos and files of the message (#6685).
	Attachments []messageAttachmentResponse `json:"attachments,omitempty"`
}

// GroupThreadViewResponse is an opened group thread.
type GroupThreadViewResponse struct {
	GroupThreadSummaryResponse
	Messages []GroupMessageResponse `json:"messages"`
}

func (rs *Resource) listGroupThreads(w http.ResponseWriter, r *http.Request) {
	accountID, ok := rs.parentAccountID(w, r)
	if !ok {
		return
	}
	threads, err := rs.ParentService.ListGroupThreads(r.Context(), accountID)
	if err != nil {
		renderParentWriteError(w, r, err)
		return
	}
	out := make([]GroupThreadSummaryResponse, 0, len(threads))
	for _, t := range threads {
		row := toGroupThreadSummary(t.Thread, t.SchoolName, t.Children)
		row.LastMessageAt, row.LastMessageBody, row.Unread = t.LastMessageAt, t.LastMessageBody, t.UnreadCount
		out = append(out, row)
	}
	common.Respond(w, r, http.StatusOK, out, "Group threads retrieved")
}

func (rs *Resource) getGroupThread(w http.ResponseWriter, r *http.Request) {
	accountID, ok := rs.parentAccountID(w, r)
	if !ok {
		return
	}
	threadID, ok := common.ParsePositiveInt64IDWithError(w, r, "groupThreadId", "invalid group thread ID")
	if !ok {
		return
	}
	detail, err := rs.ParentService.GetGroupThread(r.Context(), accountID, threadID)
	if err != nil {
		renderParentWriteError(w, r, err)
		return
	}
	out := GroupThreadViewResponse{
		GroupThreadSummaryResponse: toGroupThreadSummary(detail.Thread, detail.SchoolName, detail.Children),
		Messages:                   make([]GroupMessageResponse, 0, len(detail.Messages)),
	}
	for _, m := range detail.Messages {
		out.Messages = append(out.Messages, GroupMessageResponse{ID: ident.ID(m.ID), Body: m.Body, CreatedAt: m.CreatedAt, Attachments: toMessageAttachmentResponses(m.Attachments)})
	}
	if n := len(detail.Messages); n > 0 {
		last := detail.Messages[n-1]
		out.LastMessageAt, out.LastMessageBody = &last.CreatedAt, messagePreview(last.Body, last.Attachments)
	}
	common.Respond(w, r, http.StatusOK, out, "Group thread retrieved")
}

func toGroupThreadSummary(thread parentService.GroupThread, school string, children []*parentService.ChildSummary) GroupThreadSummaryResponse {
	out := GroupThreadSummaryResponse{
		ID: ident.ID(thread.ID), Title: thread.Title, TargetLabel: thread.TargetLabel,
		SchoolName: school, CounterpartName: ogsLabel(school), Closed: thread.ClosedAt != nil,
		Children: make([]GroupThreadChildResponse, 0, len(children)),
		Readers:  ParentReadersResponse{School: schoolReaders(parentService.MessageAudienceTeam, nil)},
	}
	for _, child := range children {
		out.Children = append(out.Children, GroupThreadChildResponse{
			StudentID: ident.ID(child.StudentID), FirstName: child.FirstName, LastName: child.LastName,
		})
	}
	return out
}

func parseOptionalGroupThreadID(raw ident.IDOrNone) (int64, error) {
	id := raw.Int64()
	if !raw.IsZero() && id <= 0 {
		return 0, errors.New("invalid group thread ID")
	}
	return id, nil
}
