package api

import (
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"

	apiCommon "github.com/moto-ogs/project-phoenix/api/common"
)

// maxDrainDelay caps --drain-delay below the container stop grace period the
// deployment grants (#7226): drain delay plus shutdownTimeout must end before
// the runtime kills the process.
const maxDrainDelay = 15 * time.Second

// streamDrainer ends the open realtime streams of this process.
type streamDrainer interface {
	Drain()
}

// drainingProbes answers /health and /ready with 503 once the process
// drains, so the load balancer takes this replica out of its pool before the
// listener closes (#7226). Every other request is still served.
func drainingProbes(draining *atomic.Bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if draining.Load() && (r.URL.Path == "/health" || r.URL.Path == "/ready") {
			apiCommon.RenderStatus(w, r, http.StatusServiceUnavailable, "draining")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// beginDrain starts the stop of a replica (#7226): the probes report 503,
// responses close their connections so clients open new ones to other
// replicas, and the realtime streams end so browsers reconnect elsewhere.
// It then keeps serving for the drain delay before the listener closes; the
// load balancer's health check and Docker's DNS drop the replica meanwhile.
func (runtime *Runtime) beginDrain() {
	runtime.draining.Store(true)
	runtime.server.SetKeepAlivesEnabled(false)
	if runtime.streams != nil {
		runtime.streams.Drain()
	}
	if runtime.drainDelay <= 0 {
		return
	}
	runtime.logger.Info("draining before shutdown", slog.Duration("delay", runtime.drainDelay))
	timer := time.NewTimer(runtime.drainDelay)
	defer timer.Stop()
	<-timer.C
}

// drainAndShutdown drains, then shuts the server down.
func (runtime *Runtime) drainAndShutdown(reason error) error {
	runtime.beginDrain()
	return runtime.shutdown(reason)
}
