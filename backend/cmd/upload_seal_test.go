package cmd

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	carePlanCompose "github.com/moto-ogs/project-phoenix/modules/careplan/compose"
	"github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	workforceCompose "github.com/moto-ogs/project-phoenix/modules/workforce/compose"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

// upload-seal seals the stored sick notes, payslips and child health
// documents of a school that predate #3840, leaves other categories, deleted
// documents and missing files alone, and converges: a second run changes
// nothing. The return package then carries the opened originals.
func TestUploadSealSealsLegacyFilesAndTheExportOpensThem(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	school := testpkg.Tenant(t)
	uploads := t.TempDir()
	staff := testpkg.CreateTestStaff(t, db, "Synthetic", "Sealed")
	student := testpkg.CreateTestStudentForTenant(t, db, school, "Synthetic", "Sealed", "1a")
	account := testpkg.CreateTestAccount(t, db, fmt.Sprintf("upload-seal-%d@example.test", staff.ID))
	suffix := strconv.FormatInt(staff.ID, 10)
	content := func(name string) []byte { return []byte("%PDF-1.4 synthetic " + name) }
	store := func(kind, name string) string {
		path := filepath.Join(uploads, kind, strconv.FormatInt(school, 10), name)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o700))
		require.NoError(t, os.WriteFile(path, content(name), 0o600))
		return path
	}
	staffDocument := func(category, name string, deleted bool) {
		_, err := db.NewRaw(`INSERT INTO users.staff_documents (tenant_id, staff_id, category, filename_display, filename_stored, size_bytes, content_type, uploaded_by, deleted_at)
VALUES (?, ?, ?, ?, ?, 1, 'application/pdf', ?, CASE WHEN ? THEN NOW() END)`, school, staff.ID, category, name, name, account.ID, deleted).Exec(t.Context())
		require.NoError(t, err)
	}
	studentDocument := func(category, name string) {
		_, err := db.NewRaw(`INSERT INTO users.student_documents (tenant_id, student_id, category, filename_display, filename_stored, size_bytes, content_type, uploaded_by)
VALUES (?, ?, ?, ?, ?, 1, 'application/pdf', ?)`, school, student.ID, category, name, name, account.ID).Exec(t.Context())
		require.NoError(t, err)
	}
	sickNote := store("staff-documents", "au-"+suffix+".pdf")
	staffDocument("au_bescheinigung", "au-"+suffix+".pdf", false)
	payslip := store("staff-documents", "lohn-"+suffix+".pdf")
	staffDocument("lohnabrechnung", "lohn-"+suffix+".pdf", false)
	certificate := store("staff-documents", "zeugnis-"+suffix+".pdf")
	staffDocument("zeugnis", "zeugnis-"+suffix+".pdf", false)
	deletedSickNote := store("staff-documents", "au-deleted-"+suffix+".pdf")
	staffDocument("au_bescheinigung", "au-deleted-"+suffix+".pdf", true)
	staffDocument("lohnabrechnung", "lohn-missing-"+suffix+".pdf", false)
	attest := store("student-documents", "attest-"+suffix+".pdf")
	studentDocument("attest", "attest-"+suffix+".pdf")
	contract := store("student-documents", "vertrag-"+suffix+".pdf")
	studentDocument("betreuungsvertrag", "vertrag-"+suffix+".pdf")

	health, bank, err := uploadFileCiphers()
	require.NoError(t, err)
	objectStore := objects.NewPrivateUploads(objects.NewLocal(uploads), objects.FileKeys{Health: health, Bank: bank})
	database := testpkg.NewDatabase(t, db)
	ctx := tenant.WithUnitOfWork(t.Context(), database.UnitOfWork())
	run := func() string {
		var output bytes.Buffer
		require.NoError(t, runUploadSealJob(ctx, workforceCompose.NewStaffDocumentFileSeal(), carePlanCompose.NewStudentDocumentFileSeal(), objectStore, school, 1, &output))
		return output.String()
	}
	first := run()
	require.Contains(t, first, "source=staff_documents scanned_total=3 changed_total=2 missing_total=1")
	require.Contains(t, first, "source=student_documents scanned_total=1 changed_total=1 missing_total=0")
	for _, path := range []string{sickNote, payslip, attest} {
		onDisk, err := os.ReadFile(path)
		require.NoError(t, err)
		require.True(t, bytes.HasPrefix(onDisk, []byte("MOTOSEAL")), path)
		require.NotContains(t, string(onDisk), "synthetic")
	}
	for _, path := range []string{certificate, deletedSickNote, contract} {
		onDisk, err := os.ReadFile(path)
		require.NoError(t, err)
		require.Equal(t, content(filepath.Base(path)), onDisk, "left unsealed: %s", path)
	}
	require.NoFileExists(t, filepath.Join(uploads, "staff-documents", strconv.FormatInt(school, 10), "lohn-missing-"+suffix+".pdf"))
	second := run()
	require.Contains(t, second, "source=staff_documents scanned_total=3 changed_total=0")
	require.Contains(t, second, "source=student_documents scanned_total=1 changed_total=0")
	require.NotContains(t, first+second, "synthetic", "the output names no file content")

	// The return package hands the sealed originals out opened.
	_, err = db.NewRaw(`DELETE FROM users.staff_documents WHERE filename_stored = ?`, "lohn-missing-"+suffix+".pdf").Exec(t.Context())
	require.NoError(t, err)
	sealed, err := tenantExportSealedFields()
	require.NoError(t, err)
	exporter, err := newTenantExporter(database, sealed, tenantExportProjectedFields(), false)
	require.NoError(t, err)
	operator := testpkg.CreateTestOperator(t, db)
	out := filepath.Join(t.TempDir(), "export")
	require.NoError(t, exporter.Export(ctx, organizationtenancy.TenantExportOptions{SchoolID: school, OperatorID: operator.ID, Output: out, Uploads: uploads}))
	exported := map[string]bool{}
	entries, err := os.ReadDir(filepath.Join(out, "objects"))
	require.NoError(t, err)
	for _, entry := range entries {
		data, err := os.ReadFile(filepath.Join(out, "objects", entry.Name()))
		require.NoError(t, err)
		require.False(t, bytes.HasPrefix(data, []byte("MOTOSEAL")), "no sealed original leaves")
		exported[strings.TrimPrefix(string(data), "%PDF-1.4 synthetic ")] = true
	}
	for _, path := range []string{sickNote, payslip, attest, certificate, contract} {
		require.True(t, exported[filepath.Base(path)], "exported opened: %s", filepath.Base(path))
	}
}
