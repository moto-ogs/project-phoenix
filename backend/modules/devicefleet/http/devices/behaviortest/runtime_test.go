package devices_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/render"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/devicefleet"
	devices "github.com/moto-ogs/project-phoenix/modules/devicefleet/http/devices"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// testRuntime binds the routes to the composed fleet; its history records
// every change under the request's authenticated account.
func testRuntime(fleet devicefleet.Capability) devices.Runtime {
	history, _ := fleet.(devicefleet.LifecycleHistory)
	return devices.Runtime{
		History: history,
		Actor: func(r *http.Request) int64 {
			claims, _ := testutil.AuthenticationContext(r.Context())
			return int64(claims.ID)
		},
		ActorNames: testActorNames,
		ParseID:    testpkg.ParseHTTPIDParam,
		Now:        time.Now,
		Permission: func(required string) devices.Middleware {
			return func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					claims, granted := testutil.AuthenticationContext(r.Context())
					allowed := claims.IsAdmin
					for _, permission := range granted {
						allowed = allowed || permission == required || permission == "*"
					}
					if !allowed {
						testutil.RespondError(w, r, http.StatusForbidden, errors.New("Forbidden"))
						return
					}
					next.ServeHTTP(w, r)
				})
			}
		},
		Success: testutil.RespondSuccess,
		Failure: func(w http.ResponseWriter, r *http.Request, status int, err error, message string) {
			// Like common.RenderError, the root's renderer answers a business
			// rejection the resource leaves unclassified with 409 and its code
			// (ADR 0311).
			code := ""
			var rejection interface{ ErrorCode() string }
			if status >= http.StatusInternalServerError && errors.As(err, &rejection) {
				status, code = http.StatusConflict, rejection.ErrorCode()
			}
			testutil.RespondCoded(w, r, status, code, err, nil, message)
		},
		ConflictOnField: func(w http.ResponseWriter, r *http.Request, err error, code, field string) {
			render.Status(r, http.StatusConflict)
			render.JSON(w, r, map[string]any{
				"status": "error", "error": err.Error(), "code": code,
				"errors": []map[string]string{{"field": field, "reason": err.Error()}},
			})
		},
		ConflictWithDetails: func(w http.ResponseWriter, r *http.Request, err error, code string, details any) {
			wire := make(map[string]string, len(details))
			for key, value := range details {
				wire[key] = fmt.Sprint(value)
			}
			testutil.RespondCoded(w, r, http.StatusConflict, code, err, wire, "")
		},
		// The behaviour suite runs no kiosk sessions; the API suite
		// (api/device_removal_test.go) covers the session guard.
		ActiveSession:     func(context.Context, int64) (*devices.RemovalSession, error) { return nil, nil },
		AuditRemoval:      func(*http.Request, devices.RemovalAudit) {},
		AuditStatusChange: func(*http.Request, devices.StatusAudit) {},
		ConstraintViolation: func(err error) bool {
			state := testpkg.PostgresSQLState(err)
			return state == "23503" || state == "23502"
		},
	}
}

// testActorNames names the accounts through the people of the request's
// tenant transaction, as the root's People Directory binding does.
func testActorNames(ctx context.Context, accountIDs []int64) (map[int64]string, error) {
	names := make(map[int64]string, len(accountIDs))
	if len(accountIDs) == 0 {
		return names, nil
	}
	raw, ok := testpkg.TransactionFromContext(ctx)
	if !ok {
		return nil, errors.New("test actor names: no request transaction")
	}
	var rows []struct {
		AccountID int64  `bun:"account_id"`
		Name      string `bun:"name"`
	}
	err := raw.(bun.Tx).NewRaw(`SELECT account_id, first_name || ' ' || last_name AS name
		FROM users.persons WHERE account_id IN (?) AND deleted_at IS NULL`, bun.List(accountIDs)).Scan(ctx, &rows)
	for _, row := range rows {
		names[row.AccountID] = row.Name
	}
	return names, err
}
