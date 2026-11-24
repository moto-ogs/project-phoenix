/**
 * A tab keeps the bundle it loaded while a release replaces the server
 * behind it. Next.js' `deploymentId` (NEXT_DEPLOYMENT_ID, Dockerfile.prod)
 * reloads such a tab only on its next navigation; a BFF call from the old
 * bundle still reaches the new routes and reads answers in a shape its code
 * no longer knows (the Kindersuche crashed that way after 1.16.0). So every
 * BFF call names the deployment of its bundle, and the proxy refuses a call
 * from another deployment before it reaches a route: the tab learns to reload
 * instead of misreading an answer or sending a write in an old shape.
 *
 * Without a deployment ID (dev, tests, a local build) nothing is sent and
 * nothing refused.
 */
export const DEPLOYMENT_ID_HEADER = "X-Moto-Deployment-ID";

/**
 * The deployment of the running code. Next.js inlines the server value at
 * build time and sets the browser value from the page it served; a build
 * without one inlines `false`.
 */
export function deploymentId(): string | undefined {
  const id = process.env.NEXT_DEPLOYMENT_ID;
  return id ? id : undefined;
}

/** Whether a request comes from a bundle of another deployment. */
export function isOtherDeployment(headers: Pick<Headers, "get">): boolean {
  const own = deploymentId();
  const sent = headers.get(DEPLOYMENT_ID_HEADER);
  return own !== undefined && sent !== null && sent !== own;
}
