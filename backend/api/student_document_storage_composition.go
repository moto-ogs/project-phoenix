package api

import (
	"log/slog"

	carePlanCompose "github.com/moto-ogs/project-phoenix/modules/careplan/compose"
	careplanOwnerHTTP "github.com/moto-ogs/project-phoenix/modules/careplan/http"

	nativeUploads "github.com/moto-ogs/project-phoenix/modules/delivery/objects"

	fileCompose "github.com/moto-ogs/project-phoenix/modules/filestorage/compose"
)

// NewStudentDocumentStorage keeps backend lookup lazy, so constructing a
// resource neither opens storage nor fixes a process-global backend snapshot.
// The file rings seal and open the child health documents (#3840).
func NewStudentDocumentStorage(files nativeUploads.FileKeys) careplanOwnerHTTP.StudentDocumentStorage {
	return func(kind string, store careplanOwnerHTTP.StudentDocumentFileStore, logger *slog.Logger) (careplanOwnerHTTP.StudentDocumentFiles, error) {
		backend, err := nativeUploads.SealedPrivateUploadsBackend(files)
		if err != nil {
			return nil, err
		}
		return fileCompose.NewDocumentCoordinator(kind, backend, store, logger), nil
	}
}

// studentDocumentPermissions names the permissions of every document
// category class, the accident reports' reading and writing included (#4771).
func studentDocumentPermissions() carePlanCompose.StudentDocumentPermissions {
	health, legal, fallback := careplanOwnerHTTP.StudentDocumentPermissions()
	accidentRead, accidentManage := careplanOwnerHTTP.StudentAccidentPermissions()
	return carePlanCompose.StudentDocumentPermissions{
		Health: health, Legal: legal, Default: fallback, AccidentRead: accidentRead, AccidentManage: accidentManage,
	}
}
