package owners

import (
	"context"
	"errors"
	"path"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
)

func fingerprintEnrollmentLegalPDF(ctx context.Context, tenantID int64, documentURL string) (string, error) {
	storedURL, ok := enrollment.NormalizeTenantLegalDocumentURL(documentURL, tenantID)
	if !ok {
		return "", nil
	}
	dir, filename := path.Split(storedURL)
	file, _, err := (objects.UploadFiles{}).Open(ctx, "public"+strings.TrimSuffix(dir, "/"), filename)
	if errors.Is(err, objects.ErrNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	digest, _, err := securityruntime.ReaderFingerprint(file)
	return digest, errors.Join(err, file.Close())
}
