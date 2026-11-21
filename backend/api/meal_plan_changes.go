package api

// The live signal of a changed meal plan day (#7666). „Heute anders“ shows
// every staff account that today's menu changed; an open overview refetches
// on meal_plan_changed. The signal carries no dish, no day and no account.

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"

	mealplanAPI "github.com/moto-ogs/project-phoenix/modules/mealplan/http"
	"github.com/moto-ogs/project-phoenix/realtime"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// mealPlanChangeSignal wraps a write of a meal plan day outside its
// transaction: a 2xx answer is already committed, so readers that refetch see
// the new menu. Like every realtime event it is lossy; the overview also
// reconciles on focus and after a reconnect. Without a broadcaster it sends
// nothing.
func mealPlanChangeSignal(changes realtime.Broadcaster) mealplanAPI.Middleware {
	if changes == nil {
		return nil
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			recorder := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(recorder, r)
			tenantID := tenant.FromContext(r.Context())
			if recorder.Status() < http.StatusOK || recorder.Status() >= http.StatusMultipleChoices || tenantID == 0 {
				return
			}
			event := realtime.NewEvent(realtime.EventMealPlanChanged, "", realtime.EventData{})
			if err := changes.BroadcastToTenant(tenantID, event); err != nil {
				slog.WarnContext(r.Context(), "SSE meal plan broadcast failed",
					slog.Int64("tenant_id", tenantID),
					slog.String("error", err.Error()),
				)
			}
		})
	}
}
