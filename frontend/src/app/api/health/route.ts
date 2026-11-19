import { NextResponse } from "next/server";
import { withPrivateNoStore } from "~/lib/private-no-store";
import { isDraining } from "~/lib/process-drain.server";

/**
 * Health check endpoint for container orchestration and load balancers.
 * Returns a simple 200 OK response with timestamp.
 *
 * Used by:
 * - Docker health checks (docker-compose.prod.yml)
 * - CI/CD deployment verification
 * - Monitoring systems
 */
const DRAINING_HEADERS = { Connection: "close" };

async function GETHandler() {
  // A stopping replica leaves the load balancer's pool first (#7226). The
  // balancer keeps probing it; closing the probe's connection lets Next.js'
  // shutdown, which waits for open connections, finish.
  if (isDraining()) {
    return NextResponse.json(
      { status: "draining", service: "phoenix-frontend" },
      { status: 503, headers: DRAINING_HEADERS },
    );
  }
  return NextResponse.json({
    status: "ok",
    service: "phoenix-frontend",
    timestamp: new Date().toISOString(),
  });
}

async function HEADHandler() {
  if (isDraining())
    return new Response(null, { status: 503, headers: DRAINING_HEADERS });
  return new Response(null, { status: 200 });
}

export const GET = withPrivateNoStore(GETHandler);
export const HEAD = withPrivateNoStore(HEADHandler);
