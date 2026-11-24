package common

import "strings"

// StudentPhotoStoredURLPrefix is the persisted prefix for `users.students.photo_path`.
// Changing it is a breaking migration — must stay in sync with publicPhotoBaseDir
// in api/students/photo.go.
const StudentPhotoStoredURLPrefix = "/uploads/student-photos/"

// StudentPhotoVersion extracts the filename of a stored photo. Only the
// registered file route may turn this version into a browser address.
func StudentPhotoVersion(storedURL string) string {
	version, stored := strings.CutPrefix(storedURL, StudentPhotoStoredURLPrefix)
	if !stored || version == "." || version == ".." || strings.ContainsAny(version, "/\\") {
		return ""
	}
	return version
}
