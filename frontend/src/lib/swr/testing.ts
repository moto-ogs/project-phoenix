/**
 * Test-only access to SWR's provider, its config hook and cache type (#5007).
 * Production code never reaches this module: swr/no-cache-access accepts only
 * the public modules of ~/lib/swr outside test files.
 *
 * `useSWR` and `mutate` are the package's own exports, so a test reads the
 * double that `vi.mock("swr")` (src/test/setup.ts or the test file) installs.
 */
// swr/no-direct-import permits package imports inside this shared wrapper only.
export {
  default as useSWR,
  mutate,
  SWRConfig,
  useSWRConfig,
  type Cache,
} from "swr";
