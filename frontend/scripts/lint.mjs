import { spawn } from "node:child_process";
import { constants } from "node:os";
import config from "../.oxlintrc.json" with { type: "json" };

function lint(args) {
  return new Promise((resolve, reject) => {
    // exec keeps the original command's exit status, even if oxlint is missing.
    const child = spawn(
      "sh",
      ["-c", 'exec oxlint "$@"', "oxlint", ".", ...args],
      {
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve(code ?? 128 + constants.signals[signal]);
    });
  });
}

const args = process.argv.slice(2);
const noWarnings =
  args.length === 2 && args[0] === "--max-warnings" && args[1] === "0";

if ((args.length === 0 || noWarnings) && !config.extends && !config.overrides) {
  // Oxlint runs JS rules on one thread. Overlap the identifier rule's
  // in-process TypeScript work with the other rules, not with typecheck.
  const [regular, numeric] = await Promise.all([
    lint([...args, "--config", ".oxlint-regular.mjs"]),
    lint([...args, "--config", ".oxlint-numeric.mjs"]),
  ]);
  process.exitCode = Math.max(regular, numeric);
} else {
  // Keep extended configs, overrides, and other options (e.g. JSON or fix)
  // on one run rather than guessing how to partition them.
  process.exitCode = await lint(args);
}
