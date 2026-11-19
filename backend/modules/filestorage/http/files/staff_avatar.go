package files

import (
	"net/http"
	"path/filepath"

	"github.com/moto-ogs/project-phoenix/api/common"
)

// NewStaffAvatarHandler binds the stored-path resolver and byte storage to the
// staff avatar resource. School Membership authorizes the account lookup before
// invoking this handler; File Storage resolves and serves the stored image.
func NewStaffAvatarHandler(resolve func(string, string, string) (string, error), storage common.UploadStorage) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, avatarPath string) {
		filePath, err := resolve("public", avatarPath, "/uploads/avatars/")
		if err != nil {
			common.RenderStatus(w, r, http.StatusNotFound, "")
			return
		}
		common.ServeImage(w, r, filepath.Dir(filePath), filepath.Base(filePath), staffAvatarCacheControl(r.URL.Query().Get("v"), avatarPath), storage)
	}
}

// staffAvatarCacheControl lets the browser keep a versioned address for a
// day without asking again: the staff list adds ?v=<stored file name>, and
// each upload gets a new name, so that address never changes its bytes. Any
// other address may show an outdated picture only for five minutes.
func staffAvatarCacheControl(version, avatarPath string) string {
	if version != "" && version == filepath.Base(avatarPath) {
		return "private, max-age=86400, immutable"
	}
	return "private, max-age=300"
}
