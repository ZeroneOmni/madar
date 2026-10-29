# Update Madar

Download a newer desktop installer from [Madar releases](https://github.com/ZeroneOmni/madar/releases).

For a CLI installation, run:

```sh
madar update
```

To install a specific release, pass its version to `madar update <version>`. The command asks before restarting an installed background service. If you decline, run `madar service restart` when ready. Restart a manually launched server yourself after updating.

A failed background-service update can roll back to the previous version. See [server update constraints](../internals/server-updates.md) for the retained backend's compatibility and recovery rules.
