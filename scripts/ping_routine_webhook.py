#!/usr/bin/env python3
"""POST to BricksBot routine webhook (Lakeflow Job task). Never log secrets.

Databricks Apps ingress requires a valid OAuth access token. A static webhook
secret alone is rejected with HTTP 401 `{}` before App code runs.

Auth strategy (first success wins):
  1. BRICKSBOT_APPS_OAUTH_BEARER env (tests)
  2. OAuth M2M client credentials from secret scope keys
     `{secret_key}-client-id` / `{secret_key}-client-secret` (optional)
     or `apps-oauth-client-id` / `apps-oauth-client-secret`
  3. Databricks SDK Config().authenticate() (Job run-as)

Shared routine secret: dbutils.secrets.get(scope, key) or BRICKSBOT_ROUTINE_WEBHOOK_SECRET.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

WEBHOOK_HEADER = "x-bricksbot-webhook-key"


def _fail(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def _dbutils():
    from pyspark.dbutils import DBUtils  # type: ignore
    from pyspark.context import SparkContext  # type: ignore

    return DBUtils(SparkContext.getOrCreate())


def _read_secret(scope: str, key: str) -> str:
    override = os.environ.get("BRICKSBOT_ROUTINE_WEBHOOK_SECRET", "").strip()
    if override:
        return override
    try:
        return _dbutils().secrets.get(scope, key)
    except Exception as exc:  # pragma: no cover
        _fail(
            f"Could not read secret from scope {scope!r} key {key!r}: {exc}. "
            "Set BRICKSBOT_ROUTINE_WEBHOOK_SECRET for local dry-run.",
        )


def _try_secret(scope: str, key: str) -> str | None:
    try:
        return _dbutils().secrets.get(scope, key)
    except Exception:
        return None


def _m2m_bearer(scope: str, secret_key: str) -> str | None:
    """Optional SP client credentials stored next to the webhook secret."""
    pairs = [
        (f"{secret_key}-client-id", f"{secret_key}-client-secret"),
        ("apps-oauth-client-id", "apps-oauth-client-secret"),
    ]
    client_id = client_secret = None
    for id_key, secret_key_name in pairs:
        client_id = _try_secret(scope, id_key)
        client_secret = _try_secret(scope, secret_key_name)
        if client_id and client_secret:
            break
    if not client_id or not client_secret:
        return None

    host = (
        os.environ.get("DATABRICKS_HOST")
        or os.environ.get("DATABRICKS_WORKSPACE_URL")
        or ""
    ).rstrip("/")
    if not host:
        try:
            from databricks.sdk.core import Config  # type: ignore

            host = (Config().host or "").rstrip("/")
        except Exception:
            host = ""
    if not host:
        print("M2M secrets found but DATABRICKS_HOST missing; skipping M2M", file=sys.stderr)
        return None

    token_url = f"{host}/oidc/v1/token"
    data = urllib.parse.urlencode(
        {"grant_type": "client_credentials", "scope": "all-apis"}
    ).encode()
    req = urllib.request.Request(token_url, data=data, method="POST")
    # Basic auth with client id/secret
    import base64

    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    req.add_header("Authorization", f"Basic {basic}")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode())
    except Exception as exc:
        print(f"M2M token request failed: {exc}", file=sys.stderr)
        return None
    access = payload.get("access_token")
    if not access:
        print("M2M token response missing access_token", file=sys.stderr)
        return None
    print("Using OAuth M2M client-credentials token for Apps ingress")
    return f"Bearer {access}"


def _sdk_bearer() -> tuple[str | None, str]:
    try:
        from databricks.sdk.core import Config  # type: ignore

        cfg = Config()
        auth_type = str(getattr(cfg, "auth_type", None) or "unknown")
        headers = cfg.authenticate()
        auth = headers.get("Authorization") or headers.get("authorization")
        if not auth:
            return None, auth_type
        return auth, auth_type
    except Exception as exc:
        return None, f"sdk_error:{exc}"


def _oauth_authorization_header(scope: str, secret_key: str) -> str:
    override = os.environ.get("BRICKSBOT_APPS_OAUTH_BEARER", "").strip()
    if override:
        return override if override.lower().startswith("bearer ") else f"Bearer {override}"

    m2m = _m2m_bearer(scope, secret_key)
    if m2m:
        return m2m

    auth, auth_type = _sdk_bearer()
    if auth:
        print(f"Using SDK OAuth for Apps ingress (auth_type={auth_type})")
        return auth

    _fail(
        "Could not obtain OAuth token for Databricks Apps ingress. "
        "Store SP client credentials in the secret scope as "
        "apps-oauth-client-id / apps-oauth-client-secret (CAN_USE on the App), "
        f"or ensure Job run-as SDK auth works (last auth_type={auth_type}).",
    )


def main(argv: list[str]) -> None:
    if len(argv) != 5:
        _fail(
            "Usage: ping_routine_webhook.py "
            "<app_base_url> <routine_id> <secret_scope> <secret_key>",
            2,
        )

    app_base_url = argv[1].strip()
    routine_id = argv[2].strip()
    secret_scope = argv[3].strip()
    secret_key = argv[4].strip()

    if not app_base_url or not routine_id:
        _fail(
            "routine_webhook_app_base_url and routine_webhook_routine_id must be set "
            "(bundle target variables) before running this Job.",
        )

    secret = _read_secret(secret_scope, secret_key)
    oauth = _oauth_authorization_header(secret_scope, secret_key)
    print(f"Authorization attached: {oauth.split(' ', 1)[0]}")

    url = f"{app_base_url.rstrip('/')}/api/webhooks/routines/{routine_id}"
    body = json.dumps({"webhookKey": secret}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": oauth,
            WEBHOOK_HEADER: secret,
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            status = response.status
            payload = response.read(4096).decode("utf-8", errors="replace")
    except urllib.error.HTTPError as err:
        snippet = err.read(4096).decode("utf-8", errors="replace")
        if err.code == 401 and snippet.strip() in ("{}", ""):
            _fail(
                f"Webhook HTTP 401 {{}} for routine {routine_id}: Apps ingress rejected "
                "the OAuth token (anonymous). Use M2M client credentials secrets "
                "(apps-oauth-client-id / apps-oauth-client-secret) for a SP with CAN_USE "
                "on the App.",
            )
        _fail(f"Webhook HTTP {err.code} for routine {routine_id}: {snippet.strip()}")
    except urllib.error.URLError as err:
        _fail(f"Webhook request failed for routine {routine_id}: {err.reason}")

    if status != 201:
        _fail(f"Webhook HTTP {status} for routine {routine_id}: {payload.strip()}")

    print(f"OK routine {routine_id} webhook HTTP {status}")


if __name__ == "__main__":
    main(sys.argv)
