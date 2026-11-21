package importapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/modules/dataimport"
	importAPI "github.com/moto-ogs/project-phoenix/modules/dataimport/http"
	"github.com/stretchr/testify/require"
)

const importAnswerAccountID int64 = 7

type answerFileDecoder struct{ dataimport.FileDecoder }

func (answerFileDecoder) ClassList(io.Reader, dataimport.FileFormat) ([]dataimport.ClassListEntryImportRow, error) {
	return []dataimport.ClassListEntryImportRow{{FirstName: "Ada", LastName: "Becker", SchoolClass: "1a"}}, nil
}
func (answerFileDecoder) OpeningBalances(io.Reader, dataimport.FileFormat) ([]dataimport.OpeningBalanceImportRow, error) {
	return []dataimport.OpeningBalanceImportRow{{PersonnelNumber: "42", HoursBalance: "2"}}, nil
}

type answerImporter[T any] struct{ t *testing.T }

func (s answerImporter[T]) Import(_ context.Context, req dataimport.ImportRequest[T]) (*dataimport.ImportResult[T], error) {
	require.Len(s.t, req.Rows, 1)
	require.Equal(s.t, importAnswerAccountID, req.UserID)
	stamp := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	return &dataimport.ImportResult[T]{ImportSummary: dataimport.ImportSummary{StartedAt: stamp, CompletedAt: stamp, TotalRows: 1, CreatedCount: 1, DryRun: req.DryRun}}, nil
}
func (s answerImporter[T]) ImportBatches(ctx context.Context, req dataimport.ImportRequest[T], audit dataimport.BatchAudit) (*dataimport.ImportResult[T], error) {
	require.Equal(s.t, "list.csv", audit.Filename)
	return s.Import(ctx, req)
}
func (s answerImporter[T]) RecordAuditInTransaction(context.Context, string, string, *dataimport.ImportResult[T], int64, bool, int64) error {
	return nil
}

// Exercise the mounted handlers and the real response renderer, not only
// their services: each import family has a different registered wire type.
func TestClassListAndOpeningBalanceRoutesAnswerWithinTheContract(t *testing.T) {
	t.Parallel()
	for _, family := range []string{"class-list-entries", "opening-balances"} {
		for _, action := range []string{"preview", "import"} {
			t.Run(family+"/"+action, func(t *testing.T) {
				t.Parallel()
				responses := api.ImportHTTPResponsesForTests()
				identity := func(next http.Handler) http.Handler { return next }
				opening := answerImporter[dataimport.OpeningBalanceImportRow]{t}
				resource := importAPI.NewResource(importAPI.Dependencies{
					Files: answerFileDecoder{}, ClassList: answerImporter[dataimport.ClassListEntryImportRow]{t},
					Runtime: importAPI.Runtime{
						RequireAnyPermission: func(...string) importAPI.Middleware { return identity }, TemplateTransaction: identity,
						WithinTenant: func(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) },
						TenantID:     func(context.Context) int64 { return 3 }, AccountID: func(context.Context) (int64, error) { return importAnswerAccountID, nil },
						OpeningDecider:      func(context.Context, int64) (int64, error) { return 9, nil },
						ValidateOpeningDate: func(raw string) (string, error) { return raw, nil },
						OpeningImport: func(string, string, int64) (dataimport.RowImporter[dataimport.OpeningBalanceImportRow], error) {
							return opening, nil
						},
						Success: responses.Success, Failure: responses.Failure,
					},
				})
				router := chi.NewRouter()
				router.Mount("/api/import", resource.Router())
				var body bytes.Buffer
				form := multipart.NewWriter(&body)
				file, err := form.CreateFormFile("file", "list.csv")
				require.NoError(t, err)
				_, err = io.WriteString(file, "Vorname,Nachname\nAda,Becker\n")
				require.NoError(t, err)
				require.NoError(t, form.WriteField("effective_date", "2026-11-20"))
				require.NoError(t, form.WriteField("note", "Takeover"))
				require.NoError(t, form.Close())
				req := httptest.NewRequest(http.MethodPost, "/api/import/"+family+"/"+action, &body)
				req.Header.Set("Content-Type", form.FormDataContentType())
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req)
				require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
				var answer struct {
					Data dataimport.ImportSummary `json:"data"`
				}
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &answer))
				require.Equal(t, 1, answer.Data.CreatedCount)
				require.Equal(t, action == "preview", answer.Data.DryRun)
			})
		}
	}
}
