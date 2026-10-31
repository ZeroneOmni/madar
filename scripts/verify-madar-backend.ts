// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalFetchInEffect:off globalFetch:off -- standalone smoke checks exercise the built HTTP server.
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

const entry = NodePath.resolve(process.argv[2] ?? "apps/server/dist/bin.mjs");
const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "madar-backend-proof-"));
const stateDir = NodePath.join(home, "userdata");
await NodeFSP.mkdir(stateDir);
for (const filename of ["state.sqlite", "statev2.sqlite"]) {
  await NodeFSP.writeFile(NodePath.join(stateDir, filename), "legacy data must remain untouched");
}
const listener = NodeNet.createServer();
listener.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) =>
  listener.once("listening", resolve).once("error", reject),
);
const address = listener.address();
NodeAssert.ok(address && typeof address !== "string");
const port = address.port;
await new Promise<void>((resolve, reject) =>
  listener.close((error) => (error ? reject(error) : resolve())),
);
const credential = NodeCrypto.randomUUID();
const child = NodeChildProcess.spawn(process.execPath, [entry, "--bootstrap-fd", "3"], {
  stdio: ["pipe", "pipe", "pipe", "pipe"],
  windowsHide: true,
});
const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
let output = "";
try {
  const ready = new Promise<void>((resolve, reject) => {
    const signal = AbortSignal.timeout(30_000);
    signal.addEventListener(
      "abort",
      () => reject(new Error(`Backend did not become ready: ${output}`)),
      { once: true },
    );
    child.on("error", reject);
    child.on("exit", () => reject(new Error(`Backend exited before readiness: ${output}`)));
    const receive = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("Madar server ready")) resolve();
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
  });
  const bootstrap = child.stdio[3];
  NodeAssert.ok(bootstrap && "write" in bootstrap);
  bootstrap.end(
    `${JSON.stringify({ mode: "desktop", noBrowser: true, port, host: "127.0.0.1", madarHome: home, desktopBootstrapToken: credential, tailscaleServeEnabled: false, tailscaleServePort: 443 })}\n`,
  );
  await ready;
  const origin = `http://127.0.0.1:${port}`;
  const descriptor = await fetch(`${origin}/.well-known/madar/environment`);
  NodeAssert.equal(descriptor.status, 200);
  const metadata: unknown = await descriptor.json();
  NodeAssert.ok(metadata && typeof metadata === "object" && "capabilities" in metadata);
  NodeAssert.deepEqual(metadata.capabilities, { repositoryIdentity: false });
  const token = await fetch(`${origin}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: credential,
      subject_token_type: "urn:madar:params:oauth:token-type:environment-bootstrap",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    }),
  });
  NodeAssert.equal(token.status, 200);
  const session: unknown = await token.json();
  NodeAssert.ok(
    session &&
      typeof session === "object" &&
      "access_token" in session &&
      typeof session.access_token === "string",
  );
  const authenticated = await fetch(`${origin}/api/auth/session`, {
    headers: { authorization: `Bearer ${session.access_token}` },
  });
  NodeAssert.equal(authenticated.status, 200);
  for (const resource of ["/api/orchestration/shell", "/api/projects", "/ws"]) {
    NodeAssert.equal((await fetch(`${origin}${resource}`)).status, 404, resource);
  }
  for (const filename of ["state.sqlite", "statev2.sqlite"]) {
    NodeAssert.equal(
      await NodeFSP.readFile(NodePath.join(stateDir, filename), "utf8"),
      "legacy data must remain untouched",
    );
  }
  using database = new NodeSqlite.DatabaseSync(NodePath.join(stateDir, "madar.sqlite"), {
    readOnly: true,
  });
  NodeAssert.deepEqual(
    database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name),
    ["auth_pairing_links", "auth_sessions", "effect_sql_migrations"],
  );
  console.log(
    "PASS: desktop bootstrap, authentication, metadata, retired APIs, and isolated Madar schema",
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await exited;
  NodeAssert.ok(
    NodePath.resolve(home).startsWith(NodePath.join(NodeOS.tmpdir(), "madar-backend-proof-")),
  );
  await NodeFSP.rm(home, { recursive: true, force: true });
}
