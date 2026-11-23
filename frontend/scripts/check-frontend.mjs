// The validators, linter and typechecker are independent. Start them together
// so adding a project-aware lint rule does not serialize two compiler loads.
import { spawn } from "node:child_process";

const node = process.execPath;

function run(command, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${command} ${args.join(" ")} exited with ${signal ?? code}`,
          ),
        );
    });
  });
}

const results = await Promise.allSettled([
  run("pnpm", "run", "check:source"),
  run(node, "./node_modules/typescript-native/bin/tsc", "--noEmit"),
  run("oxlint", ".", "--max-warnings", "0"),
]);

for (const result of results) {
  if (result.status === "rejected") {
    console.error(result.reason.message);
    process.exitCode = 1;
  }
}
