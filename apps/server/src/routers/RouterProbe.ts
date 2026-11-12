// @effect-diagnostics nodeBuiltinImport:off
import * as NodeNet from "node:net";
import * as NodeTls from "node:tls";
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { RouterProbeInput, RouterProbeResult } from "@madar/contracts";

export class RouterProbe extends Context.Service<
  RouterProbe,
  {
    readonly check: (input: RouterProbeInput) => Effect.Effect<RouterProbeResult>;
  }
>()("madar/routers/RouterProbe") {}

export function encodeSentence(words: readonly string[]) {
  return Buffer.concat([
    ...words.map((word) => {
      const data = Buffer.from(word);
      const size = data.length;
      if (size >= 0x4000) throw new Error("API word too large");
      const prefix =
        size < 0x80 ? Buffer.from([size]) : Buffer.from([(size >> 8) | 0x80, size & 0xff]);
      return Buffer.concat([prefix, data]);
    }),
    Buffer.from([0]),
  ]);
}

export const layer = Layer.succeed(
  RouterProbe,
  RouterProbe.of({
    check: Effect.fn("RouterProbe.check")((input: RouterProbeInput) =>
      Effect.callback<RouterProbeResult>((resume) => {
        let socket: NodeNet.Socket;
        let finished = false;
        let buffer = Buffer.alloc(0);
        let sentence: string[] = [];
        let stage: "login" | "identity" | "version" = "login";
        let identity = "";
        let version = "";
        let challenged = false;
        const finish = (result: RouterProbeResult) => {
          if (finished) return;
          finished = true;
          socket.destroy();
          resume(Effect.succeed(result));
        };
        const fail = (reason: Extract<RouterProbeResult, { kind: "failed" }>["reason"]) =>
          finish({ kind: "failed", reason });
        const send = (words: string[]) => {
          try {
            socket.write(encodeSentence(words));
          } catch {
            fail("protocol");
          }
        };
        const onConnect = () =>
          send(["/login", `=name=${input.profile.username}`, `=password=${input.password}`]);
        socket =
          input.profile.transport === "tls"
            ? NodeTls.connect(
                {
                  host: input.profile.host,
                  port: input.profile.port,
                  servername: NodeNet.isIP(input.profile.host) ? undefined : input.profile.host,
                  rejectUnauthorized: true,
                },
                onConnect,
              )
            : NodeNet.connect({ host: input.profile.host, port: input.profile.port }, onConnect);
        socket.on("error", (error: NodeJS.ErrnoException) =>
          fail(
            error.code?.includes("CERT") ||
              error.code?.includes("TLS") ||
              error.code?.includes("SSL")
              ? "tls"
              : "network",
          ),
        );
        socket.on("close", () => {
          if (!finished) fail("network");
        });
        const receive = (words: string[]) => {
          if (words[0] === "!trap" || words[0] === "!fatal")
            return fail(stage === "login" ? "authentication" : "permission");
          const challenge =
            stage === "login"
              ? words.find((word) => word.startsWith("=ret="))?.slice(5)
              : undefined;
          if (challenge !== undefined) {
            if (challenged || !/^[0-9a-f]{32}$/i.test(challenge)) return fail("protocol");
            challenged = true;
            const response = NodeCrypto.createHash("md5")
              .update(Buffer.from([0]))
              .update(input.password)
              .update(Buffer.from(challenge, "hex"))
              .digest("hex");
            send(["/login", `=name=${input.profile.username}`, `=response=00${response}`]);
            return;
          }
          if (words[0] === "!re") {
            for (const word of words) {
              if (stage === "identity" && word.startsWith("=name=")) identity = word.slice(6);
              if (stage === "version" && word.startsWith("=version=")) version = word.slice(9);
            }
          }
          if (words[0] !== "!done") return;
          if (stage === "login") {
            stage = "identity";
            send(["/system/identity/print", "=.proplist=name"]);
          } else if (stage === "identity") {
            stage = "version";
            send(["/system/resource/print", "=.proplist=version"]);
          } else if (!identity || !version) fail("protocol");
          else if (!/^6\.\d+(?:\.|\s|$)/.test(version)) fail("unsupported");
          else finish({ kind: "connected", identity, version });
        };
        socket.on("data", (data: Buffer) => {
          buffer = Buffer.concat([buffer, data]);
          if (buffer.length > 65536) return fail("protocol");
          while (buffer.length && !finished) {
            const first = buffer[0]!;
            const bytes =
              first < 0x80 ? 1 : first < 0xc0 ? 2 : first < 0xe0 ? 3 : first < 0xf0 ? 4 : 0;
            if (!bytes) return fail("protocol");
            if (buffer.length < bytes) return;
            let length =
              first & (bytes === 1 ? 0x7f : bytes === 2 ? 0x3f : bytes === 3 ? 0x1f : 0x0f);
            for (let index = 1; index < bytes; index++) length = length * 256 + buffer[index]!;
            if (length > 16384) return fail("protocol");
            if (buffer.length < bytes + length) return;
            const word = buffer.subarray(bytes, bytes + length).toString("utf8");
            buffer = buffer.subarray(bytes + length);
            if (length) {
              sentence.push(word);
              if (sentence.length > 100) return fail("protocol");
            } else {
              const complete = sentence;
              sentence = [];
              receive(complete);
            }
          }
        });
        return Effect.sync(() => {
          finished = true;
          socket.destroy();
        });
      }).pipe(
        Effect.timeoutOption("8 seconds"),
        Effect.map(
          Option.getOrElse(
            () => ({ kind: "failed", reason: "timeout" }) satisfies RouterProbeResult,
          ),
        ),
      ),
    ),
  }),
);
