#!/usr/bin/env python3
"""Check the PostgreSQL connection budget of one deployed Compose stack (#7226).

Every long-running process that opens the application pool may hold up to
DB_MAX_OPEN_CONNS connections, times its replica count, plus its dedicated
LISTEN connections: an API keeps one for realtime signals (an API with the
embedded Worker one more for e-mail wake-ups), a standalone Worker one for
e-mail wake-ups. Together with an operator reserve (release backup, SSH read
access, monitoring) they must fit into max_connections minus the slots
PostgreSQL reserves for superusers. A stack that does not fit fails here,
before a deployment touches the running release.

    check-db-connection-budget.py COMPOSE_FILE ENV_FILE

Prints numbers only, never configuration values.
"""

import json
import os
from pathlib import Path
import subprocess
import sys

POSTGRES_DEFAULT_MAX_CONNECTIONS = 100
POSTGRES_DEFAULT_SUPERUSER_RESERVED = 3
# Release backup (pg_dump), developer read access over SSH, monitoring.
OPERATOR_RESERVE = 10


def resolved_config(compose_file, env_file):
    command = ["docker", "compose", "--env-file", str(env_file), "-f", str(compose_file),
               "config", "--format", "json"]
    environment = {key: os.environ[key] for key in (
        "PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_RUNTIME_DIR",
    ) if key in os.environ}
    result = subprocess.run(command, capture_output=True, text=True, env=environment)
    if result.returncode:
        raise ValueError("Compose configuration could not be resolved")
    return json.loads(result.stdout)


def postgres_setting(command, name, default):
    values = [arg.split("=", 1)[1] for arg in command or [] if arg.startswith(name + "=")]
    return int(values[-1]) if values else default


def listeners(command):
    """Dedicated LISTEN connections one process of this command opens."""
    if len(command or []) < 2:
        return 0
    if command[1] == "serve":
        return 1 if "--embedded-worker=false" in command else 2
    if command[1] == "worker":
        return 1
    return 0


def replicas(service):
    return int(service.get("deploy", {}).get("replicas") or service.get("scale") or 1)


def budget(config):
    services = config["services"]
    postgres = services["postgres"].get("command")
    max_connections = postgres_setting(postgres, "max_connections", POSTGRES_DEFAULT_MAX_CONNECTIONS)
    reserved = (postgres_setting(postgres, "superuser_reserved_connections", POSTGRES_DEFAULT_SUPERUSER_RESERVED)
                + postgres_setting(postgres, "reserved_connections", 0))
    rows = []
    for name, service in sorted(services.items()):
        if service.get("profiles"):
            continue  # maintenance jobs run by hand, see the operations doc
        pool = service.get("environment", {}).get("DB_MAX_OPEN_CONNS")
        if pool is None:
            continue
        count = replicas(service)
        per_process = int(pool) + listeners(service.get("command"))
        rows.append((name, count, per_process, count * per_process))
    return max_connections, reserved, rows


def main(argv):
    if len(argv) != 3:
        print(__doc__.strip().splitlines()[-3].strip(), file=sys.stderr)
        return 2
    try:
        max_connections, reserved, rows = budget(resolved_config(Path(argv[1]), Path(argv[2])))
    except (ValueError, KeyError, TypeError) as error:
        print("Connection budget: FAIL: " + str(error), file=sys.stderr)
        return 1
    used = sum(row[3] for row in rows) + OPERATOR_RESERVE
    available = max_connections - reserved
    for name, count, per_process, total in rows:
        print(f"{name}: {count} x {per_process} = {total}")
    print(f"operator reserve: {OPERATOR_RESERVE}")
    print(f"total {used} of {available} (max_connections {max_connections} minus {reserved} reserved)")
    if used > available:
        print("Connection budget: FAIL: lower DB_MAX_OPEN_CONNS, run fewer replicas or raise "
              "max_connections; see docs/operations/replicas-7226.md", file=sys.stderr)
        return 1
    print(f"Connection budget: PASS ({available - used} free for a maintenance job)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
