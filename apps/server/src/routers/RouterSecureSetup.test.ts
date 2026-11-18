// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeHttps from "node:https";
import { Server, type Connection } from "ssh2";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RouterSecureSetup from "./RouterSecureSetup.ts";
import * as RouterApi from "./RouterApi.ts";
import { routerFixture } from "../vouchers/routerFixture.ts";
import { TEST_KEY, TEST_CERT } from "../tlsFixture.ts";

const routerServices = RouterSecureSetup.layer.pipe(Layer.provideMerge(RouterApi.layer));

async function sshFixture(output: string) {
  const { privateKey } = NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const authentications: string[] = [];
  const commands: string[] = [];
  const clients = new Set<Connection>();
  const server = new Server({ hostKeys: [privateKey.export({ type: "pkcs1", format: "pem" })] });
  server.on("connection", (client) => {
    clients.add(client);
    client.on("error", () => {});
    client.on("close", () => clients.delete(client));
    client.on("authentication", (auth) => {
      authentications.push(auth.method);
      if (auth.method === "password" && auth.password === "fixture") auth.accept();
      else auth.reject(["password"]);
    });
    client.on("ready", () =>
      client.on("session", (accept) => {
        accept().on("exec", (accept, _reject, info) => {
          commands.push(info.command);
          const stream = accept();
          // RouterOS 6 exposes the digest in print, but rejects setting it in certificate add.
          if (
            output.startsWith("MADAR_PORT=") &&
            /\/certificate add [^;]* digest-algorithm=/.test(info.command)
          ) {
            stream.write("expected end of command (line 1 column 389)");
            stream.exit(1);
            stream.end();
            return;
          }
          stream.write(output);
          stream.exit(0);
          stream.end();
        });
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing SSH fixture address");
  return {
    port: address.port,
    authentications,
    commands,
    async [Symbol.asyncDispose]() {
      for (const client of clients) client.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

it.live(
  "inspects without credentials, requires the same approved SSH host, and verifies the API certificate",
  () =>
    Effect.gen(function* () {
      const router = yield* Effect.acquireDisposable(
        Effect.promise(() => routerFixture(0, { tls: { key: TEST_KEY, cert: TEST_CERT } })),
      );
      const fingerprint = new NodeCrypto.X509Certificate(TEST_CERT).fingerprint256
        .replaceAll(":", "")
        .toLowerCase();
      const ssh = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          sshFixture(`MADAR_PORT=${router.profile.port}\r\nMADAR_FINGERPRINT=${fingerprint}\r\n`),
        ),
      );
      yield* Effect.gen(function* () {
        const { run } = yield* RouterSecureSetup.RouterSecureSetup;
        const inspected = yield* run({
          kind: "inspect",
          profile: router.profile,
          sshPort: ssh.port,
        });
        expect(inspected.kind).toBe("host-key");
        expect(ssh.authentications).toEqual([]);
        expect(ssh.commands).toEqual([]);
        if (inspected.kind !== "host-key") throw new Error("Missing SSH identity");
        expect(
          yield* run({
            kind: "configure",
            profile: router.profile,
            sshPort: ssh.port,
            password: "fixture",
            hostKey: `SHA256:${"a".repeat(43)}`,
          }),
        ).toEqual({ kind: "failed", reason: "host-key" });
        expect(ssh.authentications).toEqual([]);
        const configured = yield* run({
          kind: "configure",
          profile: router.profile,
          sshPort: ssh.port,
          password: "fixture",
          hostKey: inspected.fingerprint,
        });
        expect(configured.kind).toBe("ready");
        expect(router.commands.map(([command]) => command)).toEqual([
          "/login",
          "/system/identity/print",
          "/system/resource/print",
        ]);
        expect(ssh.commands).toHaveLength(1);
        expect(ssh.commands[0]).not.toContain("fixture");
        expect(ssh.commands[0]).not.toMatch(/[\r\n]/);
        const instructions = yield* run({ kind: "instructions", profile: router.profile });
        expect(instructions.kind).toBe("instructions");
        if (instructions.kind === "instructions") expect(instructions.script).toContain("\n");
        if (configured.kind !== "ready") throw new Error("Missing secure profile");
        const api = yield* RouterApi.RouterApi;
        expect(
          (yield* api.connect({ profile: configured.profile, password: "fixture" }, "owner")).kind,
        ).toBe("connected");
        expect(
          yield* api.connect(
            { profile: { ...configured.profile, host: "localhost" }, password: "fixture" },
            "owner",
          ),
        ).toEqual({ kind: "failed", reason: "tls" });
      }).pipe(Effect.provide(routerServices));
    }).pipe(Effect.scoped),
);

it.live("checks WinBox fingerprints and refuses a mismatch without sending API credentials", () =>
  Effect.gen(function* () {
    const router = yield* Effect.acquireDisposable(
      Effect.promise(() => routerFixture(0, { tls: { key: TEST_KEY, cert: TEST_CERT } })),
    );
    yield* Effect.gen(function* () {
      const { run } = yield* RouterSecureSetup.RouterSecureSetup;
      const input = {
        kind: "verify" as const,
        profile: router.profile,
        port: router.profile.port,
        password: "fixture",
      };
      expect(yield* run({ ...input, fingerprint: "a".repeat(64) })).toEqual({
        kind: "failed",
        reason: "certificate",
      });
      expect(router.commands).toEqual([]);
      expect(
        yield* run({
          ...input,
          fingerprint: new NodeCrypto.X509Certificate(TEST_CERT).fingerprint,
        }),
      ).toMatchObject({ kind: "ready", profile: { tlsCertificate: TEST_CERT.trim() + "\n" } });
    }).pipe(Effect.provide(routerServices));
  }).pipe(Effect.scoped),
);

it.live(
  "rejects an HTTPS port with the right certificate without disturbing the active API session",
  () =>
    Effect.gen(function* () {
      const router = yield* Effect.acquireDisposable(Effect.promise(() => routerFixture(0)));
      const https = yield* Effect.acquireDisposable(
        Effect.promise(async () => {
          const server = NodeHttps.createServer({ key: TEST_KEY, cert: TEST_CERT });
          server.on("clientError", (_error, socket) => socket.destroy());
          await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
          const address = server.address();
          if (!address || typeof address === "string")
            throw new Error("Missing HTTPS fixture address");
          return { port: address.port, [Symbol.asyncDispose]: () => server[Symbol.asyncDispose]() };
        }),
      );
      const api = yield* RouterApi.RouterApi;
      const { run } = yield* RouterSecureSetup.RouterSecureSetup;
      expect(
        yield* api.connect({ profile: router.profile, password: "fixture" }, "owner"),
      ).toMatchObject({ kind: "connected" });
      expect(
        yield* run({
          kind: "verify",
          profile: router.profile,
          port: https.port,
          password: "fixture",
          fingerprint: new NodeCrypto.X509Certificate(TEST_CERT).fingerprint256,
        }),
      ).toEqual({ kind: "failed", reason: "api" });
      expect(yield* api.status(router.profile.id, "owner")).toMatchObject({ kind: "connected" });
    }).pipe(Effect.provide(routerServices), Effect.scoped),
);

it.live(
  "reports SSH authentication, unsupported RouterOS and permission failures without accepting partial setup",
  () =>
    Effect.gen(function* () {
      const router = yield* Effect.acquireDisposable(Effect.promise(() => routerFixture(0)));
      for (const [output, reason] of [
        ["MADAR_UNSUPPORTED", "unsupported"],
        ["failure: not enough permissions", "permission"],
        ["partial output", "setup"],
      ] as const) {
        const ssh = yield* Effect.acquireDisposable(Effect.promise(() => sshFixture(output)));
        yield* Effect.gen(function* () {
          const { run } = yield* RouterSecureSetup.RouterSecureSetup;
          const identity = yield* run({
            kind: "inspect",
            profile: router.profile,
            sshPort: ssh.port,
          });
          if (identity.kind !== "host-key") throw new Error("Missing SSH identity");
          const input = {
            kind: "configure" as const,
            profile: router.profile,
            sshPort: ssh.port,
            hostKey: identity.fingerprint,
          };
          expect(yield* run({ ...input, password: "wrong" })).toEqual({
            kind: "failed",
            reason: "authentication",
          });
          expect(ssh.commands).toEqual([]);
          expect(yield* run({ ...input, password: "fixture" })).toEqual({
            kind: "failed",
            reason,
          });
        }).pipe(Effect.provide(routerServices));
      }
    }).pipe(Effect.scoped),
);
