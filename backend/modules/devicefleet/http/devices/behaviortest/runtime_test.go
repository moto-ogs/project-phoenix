package devices_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	devices "github.com/moto-ogs/project-phoenix/modules/devicefleet/http/devices"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func testRuntime() devices.Runtime {
	return devices.Runtime{
		ParseID: testpkg.ParseHTTPIDParam,
		Now:     time.Now,
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
			testutil.RespondCoded(w, r, status, "", err, nil, message)
		},
		ConflictOnField: func(w http.ResponseWriter, r *http.Request, err error, code, field string) {
			render.Status(r, http.StatusConflict)
			render.JSON(w, r, map[string]any{
				"status": "error", "error": err.Error(), "code": code,
				"errors": []map[string]string{{"field": field, "reason": err.Error()}},
			})
		},
		ConflictWithDetails: func(w http.ResponseWriter, r *http.Request, err error, code string, details map[string]any) {
			wire := make(map[string]string, len(details))
			for key, value := range details {
				wire[key] = fmt.Sprint(value)
			}
			testutil.RespondCoded(w, r, http.StatusConflict, code, err, wire, "")
		},
		// The behaviour suite runs no kiosk sessions; the API suite
		// (api/device_removal_test.go) covers the session guard.
		ActiveSession: func(context.Context, int64) (*devices.RemovalSession, error) { return nil, nil },
		AuditRemoval:  func(*http.Request, devices.RemovalAudit) {},
		ConstraintViolation: func(err error) bool {
			state := testpkg.PostgresSQLState(err)
			return state == "23503" || state == "23502"
		},
	}
}
