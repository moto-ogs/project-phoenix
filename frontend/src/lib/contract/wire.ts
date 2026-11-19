// Temporary (#7563): the child routes /api/students and /api/students/{id}
// keep their BFF files for one release, because an installed app with an
// older bundle reads the shape those files build. A request that carries this
// header asks for the contract's shape instead: the files hand it to the
// catalog proxy. The current client sends it on every call to those two
// paths. Delete this module together with the two files after the next
// production deploy; the portal's catch-all then answers both paths.

export const CONTRACT_WIRE_HEADER = "X-Moto-Wire";

/** The header of a request that reads and writes the contract's shape. */
export const CONTRACT_WIRE: Readonly<Record<string, string>> = {
  [CONTRACT_WIRE_HEADER]: "contract",
};

/** Whether a request asks for the contract's shape. */
export function asksForContractWire(request: Request): boolean {
  return request.headers.get(CONTRACT_WIRE_HEADER) === "contract";
}
