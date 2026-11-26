package staffmessaging

import (
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// Group chat handlers (#4776). Authorization lives in the service: membership
// for every route, plus creator or leadership for the managing ones.

type groupRequest struct {
	Name       string     `json:"name"`
	AccountIDs []ident.ID `json:"account_ids"`
}

// renameGroupRequest is the body of PUT /threads/{threadID}/name.
type renameGroupRequest struct {
	Name string `json:"name"`
}

// parseAccountIDs turns the wire IDs into account ids.
func parseAccountIDs(raw []ident.ID) ([]int64, bool) {
	ids := make([]int64, 0, len(raw))
	for _, value := range raw {
		id := value.Int64()
		if id <= 0 {
			return nil, false
		}
		ids = append(ids, id)
	}
	return ids, true
}

func decodeGroupRequest(w http.ResponseWriter, r *http.Request) (groupRequest, []int64, bool) {
	var body groupRequest
	if err := wire.Decode(r.Body, &body); err != nil {
		refusal := common.ErrorInvalidRequest(err)
		if wire.InvalidIDAt(err, "/account_ids") {
			refusal = common.ErrorInvalidRequestMessage("Ungültige Konto-ID.")
		}
		common.RenderError(w, r, refusal)
		return body, nil, false
	}
	ids, ok := parseAccountIDs(body.AccountIDs)
	if !ok {
		common.RenderError(w, r, common.ErrorInvalidRequestMessage("Ungültige Konto-ID."))
		return body, nil, false
	}
	return body, ids, true
}

func (rs *Resource) createGroup(w http.ResponseWriter, r *http.Request) {
	body, ids, ok := decodeGroupRequest(w, r)
	if !ok {
		return
	}
	detail, err := rs.Service.CreateStaffMessageGroup(r.Context(), body.Name, ids)
	if err != nil {
		renderStaffMessagingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusCreated, toThreadDetail(detail, currentAccountID(r)), "Group created")
}

func (rs *Resource) renameGroup(w http.ResponseWriter, r *http.Request) {
	threadID, ok := common.ParsePositiveInt64IDWithError(w, r, "threadID", "invalid thread ID")
	if !ok {
		return
	}
	var body renameGroupRequest
	if err := wire.Decode(r.Body, &body); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	detail, err := rs.Service.RenameStaffMessageGroup(r.Context(), threadID, body.Name)
	if err != nil {
		renderStaffMessagingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, toThreadDetail(detail, currentAccountID(r)), "Group renamed")
}

func (rs *Resource) addGroupMembers(w http.ResponseWriter, r *http.Request) {
	threadID, ok := common.ParsePositiveInt64IDWithError(w, r, "threadID", "invalid thread ID")
	if !ok {
		return
	}
	_, ids, ok := decodeGroupRequest(w, r)
	if !ok {
		return
	}
	detail, err := rs.Service.AddStaffMessageGroupMembers(r.Context(), threadID, ids)
	if err != nil {
		renderStaffMessagingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, toThreadDetail(detail, currentAccountID(r)), "Members added")
}

func (rs *Resource) removeGroupMember(w http.ResponseWriter, r *http.Request) {
	threadID, ok := common.ParsePositiveInt64IDWithError(w, r, "threadID", "invalid thread ID")
	if !ok {
		return
	}
	accountID, ok := common.ParsePositiveInt64IDWithError(w, r, "accountID", "invalid account ID")
	if !ok {
		return
	}
	detail, err := rs.Service.RemoveStaffMessageGroupMember(r.Context(), threadID, accountID)
	if err != nil {
		renderStaffMessagingError(w, r, err)
		return
	}
	if detail == nil {
		// The caller removed themselves: that is leaving, and the group is no
		// longer theirs to show. The answer says so with data null, one shape
		// with the thread of the other case (#2352).
		common.Respond(w, r, http.StatusOK, (*ThreadDetailResponse)(nil), "Group left")
		return
	}
	thread := toThreadDetail(detail, currentAccountID(r))
	common.Respond(w, r, http.StatusOK, &thread, "Member removed")
}

func (rs *Resource) leaveGroup(w http.ResponseWriter, r *http.Request) {
	threadID, ok := common.ParsePositiveInt64IDWithError(w, r, "threadID", "invalid thread ID")
	if !ok {
		return
	}
	// Leaving is removing oneself; the service authorizes membership.
	if _, err := rs.Service.RemoveStaffMessageGroupMember(r.Context(), threadID, currentAccountID(r)); err != nil {
		renderStaffMessagingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, nil, "Group left")
}
