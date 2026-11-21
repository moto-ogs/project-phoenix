package messaging_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	messaging "github.com/moto-ogs/project-phoenix/modules/communication/http/parentmessages"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/stretchr/testify/require"
)

// staffWithoutGroups is a verified staff member without an OGS group today.
type staffWithoutGroups struct{}

func (staffWithoutGroups) HasCurrentStaff(context.Context) (bool, error) { return true, nil }
func (staffWithoutGroups) MyGroupIDs(context.Context) ([]int64, error)   { return nil, nil }

// The inbox of the staff portal under its production path: a staff member
// opens the conversation with a guardian, marks it unread for the team,
// confirms it for the team, and sets which conversations the counter counts.
func TestStaffInboxCountsMarksAndConfirmsConversations(t *testing.T) {
	t.Parallel()
	router, chain := messagingFixture(t, owners.StaffStudentReads{Caller: staffWithoutGroups{}})
	sender, colleague := staffToken(t, "Ina", "admin:*"), staffToken(t, "Kai", "admin:*")
	send := func(token, method, path, payload string, out any) {
		t.Helper()
		rec := call(t, router, token, method, path, "application/json", bytes.NewBufferString(payload))
		require.Contains(t, []int{http.StatusOK, http.StatusCreated}, rec.Code, rec.Body.String())
		if out != nil {
			envelope := struct{ Data any }{Data: out}
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope))
		}
	}
	unread := func(token string) int {
		t.Helper()
		var count messaging.ParentChatUnreadCountResponse
		send(token, http.MethodGet, "/unread-count", "", &count)
		return count.UnreadCount
	}

	// Opening the conversation sends nothing; the first message starts it.
	var opened messaging.ParentChatThreadDetailResponse
	send(sender, http.MethodPost, "/threads/open", fmt.Sprintf(`{"student_id":%q,"guardian_account_id":%q}`, fmt.Sprint(chain.StudentID), fmt.Sprint(chain.AccountID)), &opened)
	require.Equal(t, fmt.Sprint(chain.StudentID), opened.StudentID)
	require.Empty(t, opened.Messages)
	var messages []messaging.ParentChatMessageResponse
	send(sender, http.MethodPost, "/threads/"+opened.ThreadID, `{"body":"Bitte Turnbeutel mitgeben"}`, &messages)
	require.Len(t, messages, 1)
	var thread messaging.ParentChatThreadDetailResponse
	send(colleague, http.MethodGet, "/threads/"+opened.ThreadID, "", &thread)
	require.Len(t, thread.Messages, 1)
	require.Equal(t, opened.ThreadID, thread.ThreadID)

	// Unread for the whole team, then confirmed for the whole team.
	send(sender, http.MethodPost, "/threads/"+opened.ThreadID+"/unread", "", nil)
	require.Equal(t, 1, unread(colleague), "the team sees the conversation as unread")
	send(sender, http.MethodPost, "/threads/"+opened.ThreadID+"/handled", fmt.Sprintf(`{"handled_up_to_message_id":%q}`, messages[0].ID), nil)
	require.Zero(t, unread(colleague), "the confirmation clears it for the team")

	// Marking all read answers the caller's new count.
	send(sender, http.MethodPost, "/threads/"+opened.ThreadID+"/unread", "", nil)
	var afterAll messaging.ParentChatUnreadCountResponse
	send(colleague, http.MethodPost, "/mark-all-read", "", &afterAll)
	require.Equal(t, unread(colleague), afterAll.UnreadCount)

	// The counter's scope is the caller's own.
	var scope messaging.CountScopeResponse
	send(colleague, http.MethodGet, "/count-scope", "", &scope)
	require.Equal(t, "all", scope.Scope)
	require.False(t, scope.HasOwnGroups)
	var saved messaging.CountScopeSavedResponse
	send(colleague, http.MethodPut, "/count-scope", `{"scope":"none"}`, &saved)
	require.Equal(t, "none", saved.Scope)
	send(colleague, http.MethodGet, "/count-scope", "", &scope)
	require.Equal(t, "none", scope.Scope)
	send(sender, http.MethodGet, "/count-scope", "", &scope)
	require.Equal(t, "all", scope.Scope, "another staff member keeps the default")
}
