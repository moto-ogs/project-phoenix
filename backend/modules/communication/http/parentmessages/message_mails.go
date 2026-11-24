package messaging

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// mountMessageMailRoutes adds what became of the e-mails of OGS messages
// (#7058). They are reads of their own, so the chat can poll them without
// reloading the conversation or moving its read state.
func (rs *Resource) mountMessageMailRoutes(r chi.Router, read, withTx func(http.Handler) http.Handler) {
	if rs.Mails == nil {
		return
	}
	r.With(read, withTx).Get("/threads/{threadId}/mails", rs.getThreadMails)
	if rs.Groups != nil {
		r.With(read, withTx).Get("/group-threads/{groupThreadId}/mails", rs.getGroupThreadMails)
	}
}

// ThreadMailsResponse maps a message ID to its mail's outcome. A message
// without a mail is absent.
type ThreadMailsResponse struct {
	Messages map[ident.ID]string `json:"messages"`
}

// GroupThreadMailsResponse maps a message ID to its mails counted by outcome,
// one mail per family. A message without a mail is absent.
type GroupThreadMailsResponse struct {
	Messages map[ident.ID]map[string]int `json:"messages"`
}

func (rs *Resource) getThreadMails(w http.ResponseWriter, r *http.Request) {
	threadID, ok := parseInt64Param(w, r, "threadId", "thread")
	if !ok {
		return
	}
	mails, err := rs.Mails.ParentMessageThreadMails(r.Context(), threadID)
	if err != nil {
		renderMessagingError(w, r, err)
		return
	}
	out := ThreadMailsResponse{Messages: make(map[ident.ID]string, len(mails))}
	for id, outcome := range mails {
		out.Messages[ident.ID(id)] = outcome
	}
	common.Respond(w, r, http.StatusOK, out, "Message mails retrieved")
}

func (rs *Resource) getGroupThreadMails(w http.ResponseWriter, r *http.Request) {
	threadID, ok := parseInt64Param(w, r, "groupThreadId", "group thread")
	if !ok {
		return
	}
	mails, err := rs.Mails.ParentGroupThreadMails(r.Context(), threadID)
	if err != nil {
		renderGroupThreadError(w, r, err)
		return
	}
	out := GroupThreadMailsResponse{Messages: make(map[ident.ID]map[string]int, len(mails))}
	for id, outcomes := range mails {
		out.Messages[ident.ID(id)] = outcomes
	}
	common.Respond(w, r, http.StatusOK, out, "Group message mails retrieved")
}
