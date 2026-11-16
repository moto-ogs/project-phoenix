// Variant 2 of the #2342 spike: types and zod decoders from the OpenAPI document.
import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./src/lib/contract-spike/openapi/openapi.json",
  output: { path: "./src/lib/contract-spike/openapi/generated" },
  // Without dates.offset the decoder rejects "2026-09-09T12:00:00+02:00",
  // which Go sends for a Berlin time.Time (measured).
  plugins: ["@hey-api/typescript", { name: "zod", dates: { offset: true } }],
});
