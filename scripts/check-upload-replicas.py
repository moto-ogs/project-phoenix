#!/usr/bin/env python3
r"""Check #7225 against two local Go replicas and their two Next.js processes.

Use a disposable school with no custom login image. The probe account needs
config:update and a password-only sign-in.
Point the Go replicas at the same migrated DB and S3 bucket. Set
RATE_LIMIT_ENABLED=true and RATE_LIMIT_AUTH_REQUESTS_PER_MINUTE=1 on both.
Point each Next.js process at its own Go replica and set TENANT_DOMAIN and
NEXT_PUBLIC_TENANT_DOMAIN to localhost. Use separate Next.js directories.

Example:
  python3 scripts/check-upload-replicas.py --apis 9880 9881 --next 4800 4801 \
    --tenant default --email replica-smoke@example.test

The password is read from the terminal or REPLICA_TEST_PASSWORD.
"""

import argparse
import base64
from contextlib import closing
import getpass
from http.client import HTTPConnection
import json
import os
import re
import secrets
import sys
import time
from urllib.parse import quote


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII="
)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def request(port, path, *, method="GET", body=None, headers=None):
    with closing(HTTPConnection("127.0.0.1", port, timeout=40)) as connection:
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        return response.status, response.headers, response.read()


def check_auth(apis):
    client_ip = f"2001:db8::{secrets.token_hex(2)}:{secrets.token_hex(2)}"
    headers = {"Content-Type": "application/json", "X-Forwarded-For": client_ip}
    for attempt in range(11):
        port = apis[attempt % 2]
        status, response_headers, _ = request(
            port, "/auth/login", method="POST", body=b"{}", headers=headers,
        )
        expected = 400 if attempt < 10 else 429
        require(status == expected, f"Login attempt {attempt + 1} on {port}: {status}, expected {expected}")
    require(response_headers.get("Retry-After", "").isdigit(), "Missing Retry-After on login throttle")
    print("Shared auth limit: 10 alternating refusals returned 400, the eleventh returned 429", flush=True)


def next_headers(tenant, port):
    host = f"{tenant}.localhost:{port}"
    return {"Host": host, "Origin": f"http://{host}"}


def read_tenant_page(tenant, port):
    status, _, body = request(port, "/", headers={"Host": next_headers(tenant, port)["Host"]})
    marker = (r'\"slug\":\"' + tenant + r'\"').encode()
    require(status == 200 and marker in body, f"Next.js tenant page on {port} did not render {tenant} ({status})")
    return body


def sign_in(tenant, email, password, port):
    status, response_headers, _ = request(
        port, "/api/auth/login", method="POST",
        body=json.dumps({"tenant_slug": tenant, "email": email, "password": password}),
        headers={**next_headers(tenant, port), "Content-Type": "application/json"},
    )
    cookies = response_headers.get_all("Set-Cookie", [])
    require(status == 200 and cookies, f"Local settings account sign-in failed ({status})")
    return "; ".join(cookie.split(";", 1)[0] for cookie in cookies)


def check_upload(apis, next_ports, tenant, email, password):
    status, _, body = request(apis[0], f"/auth/tenant/resolve?slug={quote(tenant)}")
    require(status == 200, f"Local school lookup failed ({status})")
    settings = json.loads(body)["data"].get("settings") or {}
    require(not settings.get("loginImageUrl"), "Use a disposable school without a custom login image")

    next_a, next_b = next_ports
    cookie = sign_in(tenant, email, password, next_a)
    headers = {**next_headers(tenant, next_a), "Cookie": cookie}
    read_tenant_page(tenant, next_a)
    read_tenant_page(tenant, next_b)
    # Age the warm cache slightly so the 60-second assertion includes HTTP time.
    time.sleep(2)

    boundary = secrets.token_hex(16)
    form = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="login_image"; filename="replica.png"\r\n'
        'Content-Type: image/png\r\n\r\n'
    ).encode() + PNG + f"\r\n--{boundary}--\r\n".encode()
    status, _, body = request(
        next_a, "/api/settings/login-image", method="POST", body=form,
        headers={**headers, "Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    require(status == 200, f"Login image upload via replica A failed ({status})")
    changed_at = time.monotonic()
    try:
        filename = json.loads(body)["data"]["login_image_url"].rsplit("/", 1)[-1]
        status, _, body = request(apis[1], f"/public/login-image/{quote(filename, safe='')}")
        require(status == 200 and body == PNG, f"Replica B did not serve the uploaded bytes ({status})")
        print(f"Shared storage: replica B served the same {len(body)} bytes uploaded via replica A", flush=True)

        search = filename.encode()
        require(search in read_tenant_page(tenant, next_a), "Replica A did not invalidate its tenant cache")
        print("Tenant cache: replica A showed the new login image on the first read", flush=True)
        while True:
            updated = search in read_tenant_page(tenant, next_b)
            elapsed = time.monotonic() - changed_at
            require(elapsed <= 60, "Replica B did not show the new login image within 60 seconds")
            if updated:
                print(f"Tenant cache: replica B showed the new login image after {elapsed:.2f} seconds", flush=True)
                break
            time.sleep(min(0.5, 60 - elapsed))
    finally:
        status, _, _ = request(next_a, "/api/settings/login-image", method="DELETE", headers=headers)
        require(status in (200, 204), f"Could not remove the probe image from the disposable school ({status})")


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--apis", nargs=2, type=int, required=True, metavar="PORT")
    parser.add_argument("--next", nargs=2, type=int, required=True, metavar="PORT")
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--email", required=True)
    args = parser.parse_args()
    ports = args.apis + args.next
    if any(not 1 <= port <= 65535 for port in ports) or len(set(ports)) != 4:
        parser.error("give four distinct local ports")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", args.tenant):
        parser.error("give a single lowercase tenant subdomain label")
    password = os.environ.get("REPLICA_TEST_PASSWORD") or getpass.getpass("Local settings account password: ")
    try:
        check_auth(args.apis)
        check_upload(args.apis, args.next, args.tenant, args.email, password)
    except (RuntimeError, OSError) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
