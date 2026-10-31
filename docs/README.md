# Madar docs

## Using Madar

- [Install Madar](./user/install.md)
- [Open-source licenses](./user/open-source-licenses.md)

The coding workspace has been removed. User Manager workflows are not implemented yet.
The background-service and updater guides below describe retained CLI capabilities.

- [Running in the background](./user/background-service.md)
- [Updating the CLI](./user/updating.md)

---

## Working on Madar

Start with the [development runbook](./operations/development.md) and
[contribution policy](../CONTRIBUTING.md).

Internal notes preserve architectural decisions, constraints, and implementation traps that the
source alone does not explain. Most code changes do not need an internal documentation update. Follow the
[documentation rules](../AGENTS.md#documentation) before adding one.

- [Architecture overview](./internals/overview.md)
- [Glossary](./internals/glossary.md)
- [Server updates](./internals/server-updates.md)
- [Resource telemetry](./internals/resource-telemetry.md)
- [Environment auth](./internals/environment-auth.md)

### Runbooks

- [Maintaining Madar](./operations/madar.md)
- [Development and local builds](./operations/development.md)
- [Release](./operations/release.md)
- [Observability](./operations/observability.md)
