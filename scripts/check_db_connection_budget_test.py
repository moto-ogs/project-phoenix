"""Connection budget of scripts/check-db-connection-budget.py (#7226)."""

import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location(
    "check_db_connection_budget", Path(__file__).with_name("check-db-connection-budget.py"))
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


def stack(**services):
    base = {"postgres": {"command": ["postgres", "-c", "shared_buffers=1GB"]},
            "migrate": {"profiles": ["maintenance"], "environment": {"DB_MAX_OPEN_CONNS": "40"}},
            "frontend": {"environment": {"PORT": "3000"}}}
    base.update(services)
    return {"services": base}


API = {"command": ["./main", "serve", "--embedded-worker=false"], "environment": {"DB_MAX_OPEN_CONNS": "40"}}
WORKER = {"command": ["./main", "worker"], "environment": {"DB_MAX_OPEN_CONNS": "40"}}


class BudgetTest(unittest.TestCase):
    def test_counts_pool_and_listen_connection_per_replica(self):
        limit, reserved, rows = CHECK.budget(stack(server=dict(API, deploy={"replicas": 2}), worker=WORKER))
        self.assertEqual((limit, reserved), (100, 3))
        self.assertEqual(rows, [("server", 2, 41, 82), ("worker", 1, 41, 41)])

    def test_embedded_worker_adds_its_wakeup_listener(self):
        _, _, rows = CHECK.budget(stack(server={"command": ["./main", "serve"], "environment": {"DB_MAX_OPEN_CONNS": "40"}}))
        self.assertEqual(rows, [("server", 1, 42, 42)])

    def test_reads_max_connections_and_reserved_slots_from_postgres_command(self):
        config = stack(server=API)
        config["services"]["postgres"]["command"] = [
            "postgres", "-c", "max_connections=200", "-c", "superuser_reserved_connections=5", "-c", "reserved_connections=2"]
        limit, reserved, _ = CHECK.budget(config)
        self.assertEqual((limit, reserved), (200, 7))

    def test_maintenance_jobs_and_services_without_pool_do_not_count(self):
        _, _, rows = CHECK.budget(stack(server=API))
        self.assertEqual([row[0] for row in rows], ["server"])


if __name__ == "__main__":
    unittest.main()
