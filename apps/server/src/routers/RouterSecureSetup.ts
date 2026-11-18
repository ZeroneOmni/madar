// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";
import * as NodeTls from "node:tls";
import type * as Ssh2 from "ssh2";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { RouterProfile, RouterSecureRequest, RouterSecureResult } from "@madar/contracts";
import * as RouterApi from "./RouterApi.ts";

const requireSsh = NodeModule.createRequire(import.meta.url);

class SetupError extends Schema.TaggedError<SetupError>()("SetupError", {
  reason: Schema.Literals([
    "network",
    "authentication",
    "host-key",
    "permission",
    "unsupported",
    "certificate",
    "api",
    "setup",
  ]),
}) {}

const networkFailure = () => Effect.fail(new SetupError({ reason: "network" }));

function setupScript(host: string, name: string) {
  const san = `${NodeNet.isIP(host) ? "IP" : "DNS"}:${host}`;
  // RouterOS needs a registration delay after signing before a service can select the certificate.
  return `{
  :local version [/system resource get version];
  :if ([:pick $version 0 2] != "6.") do={ :error "MADAR_UNSUPPORTED" };
  :local service [/ip service find where name="api-ssl"];
  :local cert [/ip service get $service certificate];
  :if (($cert = "none") || ($cert = "")) do={
    /certificate add name="${name}" common-name="${host}" subject-alt-name="${san}" key-size=2048 days-valid=3650 key-usage=digital-signature,key-encipherment,key-cert-sign,tls-server;
    /certificate sign [find where name="${name}"] name="${name}";
    :delay 3s;
    :set cert "${name}";
    /ip service set $service certificate=$cert;
  };
  /ip service set $service disabled=no tls-version=only-1.2;
  :put ("MADAR_PORT=" . [/ip service get $service port]);
  :put ("MADAR_FINGERPRINT=" . [/certificate get [find where name=$cert] fingerprint]);
}`;
}

const ssh = Effect.fn("RouterSecureSetup.ssh")(function* (
  input: Extract<RouterSecureRequest, { kind: "inspect" | "configure" }>,
) {
  return yield* Effect.callback<string, SetupError>((resume) => {
    const { Client } = requireSsh("ssh2") as typeof Ssh2;
    const client = new Client();
    let done = false;
    let output = "";
    const finish = (result: Effect.Effect<string, SetupError>) => {
      if (done) return;
      done = true;
      client.destroy();
      resume(result);
    };
    client.on("error", (error: Error & { level?: string }) => {
      finish(
        Effect.fail(
          new SetupError({
            reason: error.level === "client-authentication" ? "authentication" : "network",
          }),
        ),
      );
    });
    client.on("close", () => finish(networkFailure()));
    client.on("ready", () => {
      if (input.kind !== "configure") return;
      client.exec(
        // RouterOS 6 SSH exec accepts one line; WinBox retains the readable block.
        setupScript(input.profile.host, `madar-api-${NodeCrypto.randomBytes(6).toString("hex")}`)
          .split("\n")
          .map((line) => line.trim())
          .join(" "),
        (error, stream) => {
          if (error) return finish(Effect.fail(new SetupError({ reason: "permission" })));
          const collect = (chunk: Buffer) => {
            output += chunk.toString();
            if (output.length > 32768) finish(Effect.fail(new SetupError({ reason: "setup" })));
          };
          stream.on("data", collect);
          stream.stderr.on("data", collect);
          stream.on("error", () => finish(Effect.fail(new SetupError({ reason: "setup" }))));
          stream.on("close", (code: number) => {
            if (output.includes("MADAR_UNSUPPORTED"))
              return finish(Effect.fail(new SetupError({ reason: "unsupported" })));
            if (/not enough permissions|permission denied/i.test(output))
              return finish(Effect.fail(new SetupError({ reason: "permission" })));
            finish(
              code === 0
                ? Effect.succeed(output)
                : Effect.fail(new SetupError({ reason: "setup" })),
            );
          });
        },
      );
    });
    client.connect({
      host: input.profile.host,
      port: input.sshPort,
      username: input.profile.username,
      ...(input.kind === "configure" ? { password: input.password } : {}),
      readyTimeout: 15000,
      hostVerifier: (key: Buffer) => {
        const fingerprint = `SHA256:${NodeCrypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
        if (input.kind === "inspect") {
          finish(Effect.succeed(fingerprint));
          return false;
        }
        if (fingerprint !== input.hostKey) {
          finish(Effect.fail(new SetupError({ reason: "host-key" })));
          return false;
        }
        return true;
      },
    });
    return Effect.sync(() => {
      done = true;
      client.destroy();
    });
  }).pipe(Effect.timeoutOrElse({ duration: "2 minutes", orElse: networkFailure }));
});

const certificate = Effect.fn("RouterSecureSetup.certificate")(function* (
  profile: RouterProfile,
  port: number,
  fingerprint: string,
) {
  const now = yield* Clock.currentTimeMillis;
  return yield* Effect.callback<RouterProfile, SetupError>((resume) => {
    const socket = NodeTls.connect({
      host: profile.host,
      port,
      servername: NodeNet.isIP(profile.host) ? undefined : profile.host,
      // This socket only reads a public certificate; trust is checked before any API login.
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
    });
    socket.on("error", () => {
      socket.destroy();
      resume(networkFailure());
    });
    socket.once("secureConnect", () => {
      try {
        const cert = new NodeCrypto.X509Certificate(socket.getPeerCertificate().raw);
        const normalized = fingerprint.replace(/[: -]/g, "").toLowerCase();
        const hash = normalized.length === 40 ? "sha1" : "sha256";
        const matches = NodeCrypto.createHash(hash).update(cert.raw).digest("hex") === normalized;
        const validHost = NodeNet.isIP(profile.host)
          ? cert.checkIP(profile.host)
          : cert.checkHost(profile.host);
        if (
          !matches ||
          !validHost ||
          now < cert.validFromDate.getTime() ||
          now > cert.validToDate.getTime()
        ) {
          resume(Effect.fail(new SetupError({ reason: "certificate" })));
        } else {
          resume(
            Effect.succeed({ ...profile, port, transport: "tls", tlsCertificate: cert.toString() }),
          );
        }
      } catch {
        resume(Effect.fail(new SetupError({ reason: "certificate" })));
      } finally {
        socket.destroy();
      }
    });
    return Effect.sync(() => socket.destroy());
  }).pipe(Effect.timeoutOrElse({ duration: "10 seconds", orElse: networkFailure }));
});

export class RouterSecureSetup extends Context.Service<
  RouterSecureSetup,
  {
    readonly run: (input: RouterSecureRequest) => Effect.Effect<RouterSecureResult>;
  }
>()("madar/routers/RouterSecureSetup") {}

const make = Effect.gen(function* () {
  const api = yield* RouterApi.RouterApi;
  let running = false;
  const run = Effect.fn("RouterSecureSetup.run")(function* (input: RouterSecureRequest) {
    if (running) return { kind: "failed", reason: "busy" } as const;
    running = true;
    return yield* Effect.gen(function* () {
      if (input.kind === "instructions")
        return {
          kind: "instructions",
          script: setupScript(
            input.profile.host,
            `madar-api-${NodeCrypto.randomBytes(6).toString("hex")}`,
          ),
        } as const;
      if (input.kind === "inspect")
        return { kind: "host-key", fingerprint: yield* ssh(input) } as const;
      let port: number;
      let fingerprint: string;
      if (input.kind === "verify") {
        ({ port, fingerprint } = input);
      } else {
        const output = yield* ssh(input);
        port = Number(/^MADAR_PORT=(\d+)\s*$/m.exec(output)?.[1]);
        fingerprint = /^MADAR_FINGERPRINT=([a-fA-F0-9: -]+)\s*$/m.exec(output)?.[1]?.trim() ?? "";
        if (!Number.isInteger(port) || port < 1 || port > 65535 || !fingerprint)
          return yield* new SetupError({ reason: "setup" });
      }
      const profile = yield* certificate(input.profile, port, fingerprint);
      yield* api
        .verify({ profile, password: input.password })
        .pipe(Effect.mapError(() => new SetupError({ reason: "api" })));
      return { kind: "ready", profile } as const;
    }).pipe(
      Effect.catchTags({
        SetupError: (error) => Effect.succeed({ kind: "failed", reason: error.reason } as const),
      }),
      Effect.ensuring(
        Effect.sync(() => {
          running = false;
        }),
      ),
    );
  });
  return RouterSecureSetup.of({ run });
});
export const layer = Layer.effect(RouterSecureSetup, make);
