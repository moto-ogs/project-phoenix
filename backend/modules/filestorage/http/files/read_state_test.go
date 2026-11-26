package files_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// A folder edit and a folder delete carry the state their author read (ADR
// 0311): an edit after another edit, and a delete after a file arrived that
// the dialog did not count, are refused and write nothing.
func TestFolderWritesRefuseAChangedReadState(t *testing.T) {
	t.Parallel()
	c := setupFileStoreRoute(t)
	folder := c.createFolder(folderPayload{Name: "Formulare", Visibility: "all_staff"})
	path := fmt.Sprintf("/files/folders/%d", folder)
	read, fingerprint := c.listedFolder(folder)

	rec := c.json(http.MethodPut, path, folderPayload{Name: "Erste", Visibility: "all_staff", ExpectedVersion: read}, c.admin, permissions.AdminWildcard)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var saved struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &saved))
	stored, _ := c.listedFolder(folder)
	assert.Equal(t, stored, saved.Data.Version, "the save answers the stored version")

	rec = c.json(http.MethodPut, path, folderPayload{Name: "Zweite", Visibility: "admins", ExpectedVersion: read}, c.admin, permissions.AdminWildcard)
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), readstate.ChangedCode)
	rec = c.json(http.MethodPut, path, folderPayload{Name: "Zweite", Visibility: "admins"}, c.admin, permissions.AdminWildcard)
	require.Equal(t, http.StatusConflict, rec.Code, "an edit without a read version is refused")
	assert.Contains(t, folderIDs(c.listFolders(c.member, permissions.UsersRead)), folder, "the refused edits wrote nothing")

	rec = c.upload(folder, "Neu.pdf", fakePDF, c.admin, permissions.AdminWildcard)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	rec = c.json(http.MethodDelete, path, map[string]string{"expected_fingerprint": fingerprint}, c.admin, permissions.AdminWildcard)
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), readstate.ChangedCode)
	rec = c.do(http.MethodDelete, path, nil, "", c.admin, permissions.AdminWildcard)
	require.Equal(t, http.StatusConflict, rec.Code, "a delete without a confirmed dialog is refused")
	assert.Contains(t, folderIDs(c.listFolders(c.admin, permissions.AdminWildcard)), folder, "the refused deletes removed nothing")

	rec = c.deleteFolder(folder)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.NotContains(t, folderIDs(c.listFolders(c.admin, permissions.AdminWildcard)), folder)
}
