# Security policy

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub: **Security → Report a vulnerability** on this repository. Include steps to reproduce and the affected version or commit.

You should get a first response within a week. Fixes land on `main`; there are no maintained release branches yet.

## Scope

In scope: the App code in this repository (`server/`, `client/`, `shared/`), the bundle (`databricks.yml`, `app.yaml`, `resources/`) and `scripts/`.

Out of scope: Databricks platform issues (report those to Databricks), and behavior that needs an operator to turn on a documented widening switch. See [docs/security.md](docs/security.md) for the trust model and those switches.
