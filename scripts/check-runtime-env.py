#!/usr/bin/env python3
"""Verify deployed service environment boundaries without displaying values."""

import argparse
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parents[1]
OPTIONAL_VALUES = {
    "BANK_DATA_LEGACY_KEYS",
    "EMAIL_SMTP_USER", "EMAIL_SMTP_PASSWORD", "NEXT_PUBLIC_POSTHOG_KEY",
    "NEXT_PUBLIC_SENTRY_DSN", "NEXT_PUBLIC_SENTRY_ENVIRONMENT",
    "SENTRY_DSN", "SENTRY_PYREPORTAL_DSN", "POSTHOG_API_KEY", "POSTHOG_HOST",
    "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBSCRIBER",
}
# The mail provider group (#5933) waits for its SOPS keys: #5935 adds them per
# environment. `${KEY-}` lets the stack deploy without them, and the backend
# requires the whole group once EMAIL_PROVIDER names a provider. #5935 moves these
# keys to the fail-fast forms. The upload group is required only in S3 mode.
PENDING_SOPS_VALUES = {
    "HUBSPOT_DEMO_TOKEN",
    "EMAIL_PROVIDER", "EMAIL_FROM_SECURITY_ADDRESS", "EMAIL_FROM_NOTICES_ADDRESS",
    "EMAIL_WEBHOOK_SECRETS", "LETTERMINT_TEAM_API_TOKEN", "LETTERMINT_WEBHOOK_ID",
    "EMAIL_FALLBACK_SMTP_HOST", "EMAIL_FALLBACK_SMTP_PORT", "EMAIL_FALLBACK_SMTP_USER",
    "EMAIL_FALLBACK_SMTP_PASSWORD", "EMAIL_FALLBACK_FROM_ADDRESS",
    "UPLOADS_BACKEND",
    "UPLOADS_S3_ENDPOINT",
    "UPLOADS_S3_REGION",
    "UPLOADS_S3_BUCKET",
    "UPLOADS_S3_ACCESS_KEY",
    "UPLOADS_S3_SECRET_KEY",
}


def compose_config(path, interpolate, env_file=ROOT / ".env.example"):
    command = ["docker", "compose", "--profile", "maintenance", "--env-file", str(env_file)]
    for compose_path in path if isinstance(path, list) else [path]:
        command.extend(["-f", str(compose_path)])
    command.extend(["config", "--format", "json", "--no-env-resolution"])
    if not interpolate:
        command.append("--no-interpolate")
    # Keep Docker connectivity, but never inherit shell application credentials.
    environment = {key: os.environ[key] for key in (
        "PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG",
        "XDG_RUNTIME_DIR", "SSH_AUTH_SOCK",
    ) if key in os.environ}
    result = subprocess.run(command, capture_output=True, text=True, env=environment)
    if result.returncode:
        missing = sorted(set(re.findall(r"([A-Z][A-Z0-9_]*) is required", result.stderr)))
        raise ValueError("Compose validation failed; missing names: " + ", ".join(missing))
    return json.loads(result.stdout)


def check(path, target, expected):
    raw = compose_config(path, False)
    resolved = compose_config(path, True)
    services = raw["services"]
    for name, service in services.items():
        if service.get("env_file"):
            raise ValueError(name + ": whole-file environment injection is forbidden")
    if set(services) != set(expected):
        raise ValueError("Unexpected service set")
    for name, allowed in expected.items():
        service = services[name]
        actual = set(service.get("environment", {}))
        if actual != set(allowed):
            raise ValueError(name + ": allowlist mismatch; names: " +
                             ", ".join(sorted(actual.symmetric_difference(allowed))))
        if any(".env" in str(volume.get("source", "")) for volume in service.get("volumes", [])):
            raise ValueError(name + ": dotenv mounts are forbidden")
        for key, value in service["environment"].items():
            if key in ("DB_DSN", "DEMO_DB_DSN", "API_URL", "PORT", "HOSTNAME") and name not in ("migrate", "bank-data-rekey", "upload-seal"):
                continue
            operator = "?" if key in OPTIONAL_VALUES else ":?"
            expected_binding = "${" + key + "-}" if key in PENDING_SOPS_VALUES else "${" + key + operator + key + " is required}"
            if value != expected_binding:
                raise ValueError(name + ": missing fail-fast binding for " + key)
        print(target + " " + name + ": " + ", ".join(sorted(actual)))
    dsn = urlsplit(resolved["services"]["server"]["environment"]["DB_DSN"])
    if (dsn.scheme != "postgres" or dsn.username != "phoenix_auth" or
            dsn.password is not None or dsn.hostname != "postgres" or
            dsn.port != 5432 or dsn.path != "/postgres" or
            parse_qs(dsn.query) != {"sslmode": ["require" if target == "production" else "disable"]}):
        raise ValueError("server: DSN must contain only the application role and expected endpoint")
    if services["migrate"].get("profiles") != ["maintenance"]:
        raise ValueError("migrate: must be an explicit maintenance job")
    if services["migrate"]["command"] != ["./main", "migrate"]:
        raise ValueError("migrate: unexpected command")
    if services["migrate"]["image"] != services["server"]["image"]:
        raise ValueError("migrate: must use the serving backend image")
    check_bank_rekey_service(services)
    check_upload_seal_service(services)
    if "worker" in expected:
        check_worker_service(services)


# Staging and production run the Worker as its own process, so the API can
# run as several replicas (#7226). The demo keeps the embedded Worker: its
# sidecar shares the network namespace of the one server container.
def check_worker_service(services):
    server, worker = services["server"], services.get("worker")
    if worker is None:
        raise ValueError("worker: staging and production run a standalone worker")
    if worker.get("command") != ["./main", "worker"] or worker["image"] != server["image"]:
        raise ValueError("worker: must run ./main worker from the serving backend image")
    if worker["environment"] != server["environment"] or worker.get("volumes") != server.get("volumes"):
        raise ValueError("worker: must receive exactly the server's environment and volumes")
    if worker.get("ports") or worker.get("profiles"):
        raise ValueError("worker: no published port; starts with the application")
    command = server.get("command", [])
    if "--embedded-worker=false" not in command or not any(arg.startswith("--drain-delay=") for arg in command):
        raise ValueError("server: API replicas run without the embedded worker and drain on stop")


def check_bank_rekey_service(services):
    job = services["bank-data-rekey"]
    if job.get("profiles") != ["maintenance"]:
        raise ValueError("bank-data-rekey: must be an explicit maintenance job")
    if job.get("command") != ["./main", "bank-data-rekey"]:
        raise ValueError("bank-data-rekey: unexpected command")
    if job["image"] != services["server"]["image"]:
        raise ValueError("bank-data-rekey: must use the serving backend image")
    if job["environment"]["DB_DSN"] != "${DB_DSN:?DB_DSN is required}":
        raise ValueError("bank-data-rekey: privileged maintenance DSN required")
    if job.get("volumes") or job.get("ports"):
        raise ValueError("bank-data-rekey: no filesystem or listener authority")


def check_upload_seal_service(services):
    job = services["upload-seal"]
    if job.get("profiles") != ["maintenance"]:
        raise ValueError("upload-seal: must be an explicit maintenance job")
    if job.get("command") != ["./main", "upload-seal", "--uploads", "/app/public/uploads"]:
        raise ValueError("upload-seal: unexpected command")
    if job["image"] != services["server"]["image"]:
        raise ValueError("upload-seal: must use the serving backend image")
    if job["environment"]["DB_DSN"] != "${DB_DSN:?DB_DSN is required}":
        raise ValueError("upload-seal: privileged maintenance DSN required")
    if job.get("ports"):
        raise ValueError("upload-seal: no listener authority")
    uploads = [volume for volume in services["server"].get("volumes", []) if volume.get("target") == "/app/public/uploads"]
    if job.get("volumes") != uploads:
        raise ValueError("upload-seal: exactly the server's uploads volume is required")


def check_missing_config(path, directory):
    lines = (ROOT / ".env.example").read_text().splitlines()
    for key in ("NEXTAUTH_SECRET", "PHOENIX_AUTH_PASSWORD", "POSTGRES_PASSWORD", "DB_DSN", "BANK_DATA_KEYS", "BANK_DATA_LEGACY_KEYS"):
        fixture = Path(directory) / "missing.env"
        fixture.write_text("\n".join(line for line in lines if not line.startswith(key + "=")) + "\n")
        try:
            compose_config(path, True, fixture)
        except ValueError as error:
            if key not in str(error):
                raise ValueError("Missing configuration failed without naming " + key) from None
        else:
            raise ValueError("Missing configuration was accepted: " + key)
    print("Missing required configuration: rejected with key names")
    fixture = Path(directory) / "pending.env"
    fixture.write_text("\n".join(line for line in lines if line.split("=")[0] not in PENDING_SOPS_VALUES) + "\n")
    compose_config(path, True, fixture)
    print("Optional provider keys missing from SOPS: stack still deploys")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", help="Check a historical Compose revision against the current policy")
    args = parser.parse_args()
    expected = json.loads((ROOT / "environments/runtime-env-allowlist.json").read_text())
    try:
        with tempfile.TemporaryDirectory(prefix="phoenix-env-check-") as directory:
            for target in ("staging", "production", "demo"):
                relative = "environments/" + target + ".compose.yml"
                path = ROOT / relative
                if args.revision:
                    result = subprocess.run(["git", "show", args.revision + ":" + relative],
                                            cwd=ROOT, capture_output=True, text=True, check=True)
                    path = Path(directory) / (target + ".yml")
                    path.write_text(result.stdout)
                # Only the demo stack carries the sidecar; revisions before #3482 lack it.
                sidecar = target == "demo" and (not args.revision or "  demo-runtime:" in path.read_text())
                # Revisions before #7226 run the embedded Worker everywhere.
                worker = target != "demo" and (not args.revision or "  worker:" in path.read_text())
                omitted = ({"demo-runtime"} if not sidecar else set()) | ({"worker"} if not worker else set())
                service_keys = {name: list(keys) for name, keys in expected.items() if name not in omitted and name != "server-demo-only"}
                if target == "demo" and (not args.revision or "HUBSPOT_DEMO_TOKEN:" in path.read_text()):
                    service_keys["server"] += expected["server-demo-only"]
                check(path, target, service_keys)
                check_missing_config(path, directory)
                if sidecar:
                    check_demo_runtime(path, bool(args.revision))
        print("Runtime environment boundaries: PASS")
    except (ValueError, KeyError, subprocess.CalledProcessError) as error:
        print("Runtime environment boundaries: FAIL: " + str(error), file=sys.stderr)
        return 1
    return 0


DEMO_UPLOADS_TARGET = "/app/public/uploads"


def check_demo_runtime_volumes(raw, server, historical):
    """The sidecar mounts exactly the server's uploads volume, nothing else.

    Revisions before #5544 mounted nothing; they stay valid as history.
    """
    volumes = raw.get("volumes") or []
    if not volumes and historical:
        return
    uploads = [volume for volume in server.get("volumes", [])
               if volume.get("target") == DEMO_UPLOADS_TARGET and volume.get("type") == "volume"]
    if len(uploads) != 1:
        raise ValueError("demo-runtime: the server must mount one uploads volume at " + DEMO_UPLOADS_TARGET)
    if len(volumes) != 1:
        raise ValueError("demo-runtime: must mount exactly the server's uploads volume, nothing else")
    volume = volumes[0]
    if (volume.get("type") != "volume" or volume.get("source") != uploads[0].get("source") or
            volume.get("target") != DEMO_UPLOADS_TARGET or volume.get("read_only")):
        raise ValueError("demo-runtime: must mount exactly the server's uploads volume, nothing else")


def check_demo_runtime(path, historical=False):
    """Sidecar rules beyond the allowlist that check() already enforced."""
    services = compose_config(path, False)["services"]
    raw = services["demo-runtime"]
    key = "DEMO_DB_DSN"
    if raw["environment"][key] != "${" + key + ":?" + key + " is required}":
        raise ValueError("demo-runtime: missing fail-fast binding for " + key)
    resolved = compose_config(path, True)["services"]["demo-runtime"]["environment"]
    dsn = urlsplit(resolved[key])
    if dsn.username != "phoenix_demo" or dsn.password is not None:
        raise ValueError("demo-runtime: DEMO_DB_DSN must contain only the phoenix_demo endpoint")
    if raw.get("env_file") or raw.get("ports"):
        raise ValueError("demo-runtime: must not receive env files or published ports")
    check_demo_runtime_volumes(raw, services["server"], historical)
    if raw.get("network_mode") != "service:server" or not raw.get("read_only"):
        raise ValueError("demo-runtime: must share the server network with a read-only filesystem")
    # Loopback in the shared network namespace: only this peer is exempt from
    # the demo server's rate limits (see docs/operations/standing-demo.md).
    # The dev tools binary runs the demo (ADR 0060); revisions before it ran
    # the demo from the server binary.
    arguments = ["demo", "--url", "http://127.0.0.1:8080", "--heartbeat", "/tmp/demo-heartbeat"]
    binaries = ["./devtools", "./main"] if historical else ["./devtools"]
    # Fallback of #3463: both processes must agree on the standing demo school.
    fallback = "--demo-standing-school"
    # The file erasure of retired demo schools (#5544) reads the mounted uploads.
    uploads = arguments + ["--uploads-root", DEMO_UPLOADS_TARGET]
    commands = [["./devtools"] + uploads]
    if historical:
        commands += [[binary] + arguments for binary in binaries]
    if raw.get("command") not in commands + [command + [fallback] for command in commands]:
        raise ValueError("demo-runtime: must use the guarded command and the server's loopback address")
    if (fallback in raw["command"]) != (fallback in services["server"].get("command", [])):
        raise ValueError("demo-runtime: server and sidecar must both select the standing demo school, or neither")
    if raw["image"] != services["server"]["image"]:
        raise ValueError("demo-runtime: must use the serving backend image")
    # A frozen runner must surface as unhealthy, and a crashed one must come back.
    if "/tmp/demo-heartbeat" not in " ".join(raw.get("healthcheck", {}).get("test", [])):
        raise ValueError("demo-runtime: healthcheck must watch the tick heartbeat")
    if raw.get("restart") != "unless-stopped":
        raise ValueError("demo-runtime: must restart after a crash")
    print("Demo runtime environment boundary: PASS")


if __name__ == "__main__":
    raise SystemExit(main())
