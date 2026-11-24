# API and BFF replicas behind Caddy (#7226)

Staging and production can run N Go API replicas and N Next.js replicas,
scaled independently. Shared state is in PostgreSQL and the upload store
([#7225](https://github.com/moto-ogs/project-phoenix/issues/7225), see
[replica runtime state](../agents/operations.md#replica-runtime-state)).
This page covers the processes, the load balancer, draining, the database
connection budget and scaling.

Before the worker split, apply the [monitoring cutover](../../monitoring/README.md#standalone-worker-cutover):
worker journal sources, metrics targets, and the rules that cover both process modes.

## Processes

| Service | Command | Replicas | Notes |
| --- | --- | --- | --- |
| `server` | `./main serve --embedded-worker=false --drain-delay=5s` | 1 by default, N supported | HTTP API, one realtime `LISTEN` connection each |
| `worker` | `./main worker` | 1 (more wait in standby) | Background jobs; leads only with the lease ([worker lease](worker-lease-2726.md)) |
| `frontend` | `node server.js` | 1 by default, N supported | Next.js BFF; no database connection |

`check-runtime-env.py` (CI) rejects a staging or production stack without
the standalone worker, with an embedded worker in `server`, or with a worker
whose image, environment or volumes differ from the server's. The worker
reuses the server's `environment` and `volumes` through Compose anchors.
The demo keeps the embedded worker and one server: its `demo-runtime`
sidecar shares the network namespace of that one container.

## Load balancer

`deploy/caddy/Caddyfile` balances each app over a pool (`(replica_pool)`):

| Pool | Fixed port | Replica ports |
| --- | --- | --- |
| production API | 8080 | 18080-18083 |
| production frontend | 3000 | 13000-13003 |
| staging API | 8081 | 18180-18183 |
| staging frontend | 3001 | 13100-13103 |

- `least_conn` spreads the long-lived event streams.
- Active health check every 2 s: API `/health`, frontend `/api/health`. A port
  without a running replica fails the check and gets no traffic.
- A refused connection is retried on another replica for up to 5 s
  (`lb_try_duration`). Caddy retries other failures only for GET.
- `flush_interval -1`: event-stream bytes pass at once, nothing is buffered.
  Caddy sets no read, write or stream timeout on the proxy; the keep-alive
  idle timeout is 5 min. The backend writes a heartbeat every 30 s, so an
  open stream never reaches the 75 s client watchdog or Cloudflare's 100 s
  idle limit. `check-caddyfile.mjs` rejects an app proxy without the pool,
  a pool snippet without `flush_interval -1` and any timeout of 75 s or less.

Next.js reaches the API at `API_URL=http://server:8080`. Docker's DNS
returns every running `server` container for that name and drops a stopped
one.

## Draining a replica

`docker compose stop` sends SIGTERM; the containers have a stop grace period
of 45 s (server, worker) and 20 s (frontend).

API replica (`--drain-delay=5s`):

1. `/health` and `/ready` answer 503, so Caddy's health check drops the
   replica within 2 s.
2. Every open event stream ends with a clean end of response; the browser
   reconnects through Caddy and Next.js to another replica.
3. Responses carry `Connection: close`, so Next.js and Caddy open new
   connections, which Docker's DNS and the pool send to other replicas.
4. After 5 s the listener closes, open requests finish (deadline 30 s), and
   the process exits.

Next.js replica: on SIGTERM `/api/health` answers 503 with
`Connection: close`, every open event stream ends cleanly (the proxy also
aborts its upstream request), and Next.js closes its listener and exits once
the remaining connections have closed. Without `Connection: close`, Caddy's
health probe every 2 s kept one keep-alive connection busy and Next.js waited
until the 20 s grace period killed it. Caddy retries refused connections on
the other replicas.

A stream that reconnects within the 2 s before Caddy marks a draining API
replica down can land on it once more; it ends at once and reconnects again.

The browser's `FetchEventSource` treats the end of the stream as a dropped
connection and reconnects with its backoff; the reconnect reconciles the
cached data ([SSE contract](../agents/realtime.md)).

## Database connection budget

Each process of a stack may hold its pool plus its `LISTEN` connections:

| Process | Connections |
| --- | --- |
| API without embedded worker | `DB_MAX_OPEN_CONNS` + 1 (realtime listener) |
| API with embedded worker (demo) | `DB_MAX_OPEN_CONNS` + 2 (realtime and e-mail listeners) |
| standalone worker | `DB_MAX_OPEN_CONNS` + 1 (e-mail listener) |
| demo-runtime | `DB_MAX_OPEN_CONNS` |

The sum over all replicas plus an operator reserve of 10 (release backup,
SSH read access, monitoring) must fit into `max_connections` minus the
superuser reserve (PostgreSQL defaults 100 and 3).
`scripts/check-db-connection-budget.py` computes it from the resolved
Compose file:

- PR checks validate runtime environment boundaries and regression-test the
  budget calculation, including two APIs with a pool size of 25 (88/97) and
  40 (133/97). They do not enforce the local `.env.example` pool sizes against
  deployed topology: the actual pool sizes live in encrypted SOPS values.
- Every deploy job in `build.yml` checks its stack with the decrypted
  environment before it copies anything to the server; a stack over budget
  fails there and the running release stays untouched.

Staging and production run PostgreSQL with `max_connections=200` (197
usable). With `DB_MAX_OPEN_CONNS=40`: one API and one worker use 82, plus the
reserve 92. Two API replicas need 133, three need 174; four need 215 and fail
the check. With N API replicas and one worker,
`(N + 1) × (DB_MAX_OPEN_CONNS + 1) + 10 ≤ 197`. For a fourth replica, pick one:

- lower `DB_MAX_OPEN_CONNS` (and `DB_MAX_IDLE_CONNS`) in the environment's
  SOPS file, for N = 4: at most 36;
- or raise `max_connections` in the `postgres` command of the Compose file;
  the next deploy recreates the database container while the application is
  stopped.

A maintenance job (`migrate`, `upload-seal`, `bank-data-rekey`) opens its own
pool of `DB_MAX_OPEN_CONNS`. The release runs `migrate` while the application
is stopped. Run `upload-seal` or `bank-data-rekey` beside a running stack only
when the check's free headroom covers the job, or with a smaller pool:
`docker compose run --rm -e DB_MAX_OPEN_CONNS=4 -e DB_MAX_IDLE_CONNS=4 upload-seal ...`.

### Connection poolers

The stacks connect directly to PostgreSQL. A pooler in front of it must keep
`LISTEN/NOTIFY` working for every API: use session pooling for the
application role, or keep the API's DSN direct. Transaction pooling breaks
the realtime listener. Each API checks this at startup: it sends a NOTIFY
through its pool and waits up to 5 s to receive it on its listener; without
it, the API does not start (`realtime listener startup failed`).

## Same configuration on every replica

All replicas of a service run from one Compose service, so they share image
and environment: `NEXTAUTH_SECRET` and the build (`NEXT_DEPLOYMENT_ID`) for
Next.js, `AUTH_JWT_SECRET` and the limiter settings for the API. A replica
started from another tag or another `.env` (for example `--scale` after a
configuration change without recreating the others) fails
`release-backup.sh check-replicas`, which compares image ID and environment
hash of every container of `server`, `worker` and `frontend`. Deploys and
rollbacks run it after the health wait; a mismatch fails the release, which
then rolls back. Run it by hand after every manual scaling step.

## Scaling

Scale changes go through the repository, so the next deploy keeps them.

### Scale an app up

1. Check the connection budget above: it covers three API replicas. Beyond
   that, lower `DB_MAX_OPEN_CONNS` through SOPS or raise `max_connections`
   first.
2. In `environments/<env>.compose.yml`, replace the fixed port of the service
   with its replica range and set the count, for example production API:

   ```yaml
   server:
     deploy:
       replicas: 2
     ports:
       - "127.0.0.1:18080-18083:8080"
   ```

   Compose gives each replica one port of the range. Caddy already lists the
   range; the Caddyfile must be live on the server first (it rolls out from
   `main`).
3. Merge; the release deploys the stack. `python3 scripts/check-db-connection-budget.py`
   and `release-backup.sh check-replicas` gate it.
4. Verify on the server: `docker compose ps server`, one healthy container
   per replica; Caddy's log shows no `no upstreams available`.

Once the service publishes its replica range (step 2), the count can also be
changed by hand on the server between releases, in the environment
directory; with the fixed port a second replica cannot bind:

```bash
docker compose up -d --wait --no-recreate --scale server=2 server
bash ~/scripts/<env>/release-backup.sh check-replicas
```

The next release resets the count to the Compose file.

### Scale an app down

1. Lower `deploy.replicas` in the Compose file and merge. The release stops
   all replicas anyway.
2. By hand between releases: `docker compose up -d --no-recreate --scale server=1 server`.
   Compose stops the surplus containers with SIGTERM; they drain as above.

### Drain one replica by hand

```bash
docker compose ps server                 # pick the container
docker stop --time 45 <container>        # drains, then exits
docker compose up -d --no-recreate --scale server=2 server   # replace it
```

## Failover record

Run on 2026-11-19 with the staging Compose file, both images built from this
branch, in a separate Compose project on a developer machine: two `server`,
one `worker`, two `frontend`, Caddy with the `(replica_pool)` snippet, one
seeded school. A probe in the Compose network ran two BFF session readers
(`/api/auth/session`), two API readers (`/api/me/`), one event stream through
the BFF and one directly at the API, and toggled a school setting (an event
for both streams) before and after each stop.

| Step | Result |
| --- | --- |
| Stop the API replica that held both streams' upstreams (`docker stop`) | Drained in 5.1 s; both streams ended cleanly (EOF) and reconnected within 1 s; the API stream reconnected once to the draining replica and moved on after 1 s |
| Setting change after the API stop | Event reached both streams |
| Stop the Next.js replica that held the BFF stream | Exited in 1.3 s under load (20 s before the `Connection: close` fix); the BFF stream ended cleanly and reconnected within 1 s |
| Setting change after the Next.js stop | Event reached both streams |
| Load during both stops | 1,858 API and 1,356 BFF session requests, all 200, the session valid on every response |
| Caddy log | Failed health probes against the stopped replicas only; no proxied request to a stopped replica |
| Third Next.js replica with another `NEXTAUTH_SECRET` (`--no-recreate --scale`) | `release-backup.sh check-replicas` exit 1, `frontend replicas differ in image or environment`; exit 0 after scaling back |

Not covered: a stop on the production host with Cloudflare in front, and a
browser tab instead of the probe (the browser's reconnect path is the one
`use-sse.test.ts` covers).
