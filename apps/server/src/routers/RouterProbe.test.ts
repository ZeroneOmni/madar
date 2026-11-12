// @effect-diagnostics nodeBuiltinImport:off
import * as NodeNet from "node:net";
import * as Effect from "effect/Effect";
import { expect } from "vite-plus/test";
import { it } from "@effect/vitest";
import { RouterProbe, encodeSentence, layer } from "./RouterProbe.ts";

async function fixture(login: "success" | "rejected" | "legacy", version = "6.49.18 (long-term)") {
  const commands: string[] = [];
  const server = NodeNet.createServer((socket) => {
    let pending = Buffer.alloc(0);
    let stage = 0;
    let challenged = false;
    socket.on("data", (data) => {
      pending = Buffer.concat([pending, data]);
      let end: number;
      while ((end = pending.indexOf(0)) >= 0) {
        commands.push(pending.subarray(0, end).toString());
        pending = pending.subarray(end + 1);
        if (stage === 0 && login === "legacy" && !challenged) {
          challenged = true;
          socket.write(encodeSentence(["!done", "=ret=0123456789abcdef0123456789abcdef"]));
          continue;
        }
        const replies =
          stage++ === 0
            ? login === "rejected"
              ? [["!trap", "=message=private credential detail"]]
              : [["!done"]]
            : stage === 2
              ? [["!re", "=name=Office"], ["!done"]]
              : [["!re", `=version=${version}`], ["!done"]];
        for (const reply of replies) {
          const bytes = encodeSentence(reply);
          socket.write(bytes.subarray(0, 1));
          socket.write(bytes.subarray(1));
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  return {
    commands,
    check: () =>
      Effect.flatMap(RouterProbe, (probe) =>
        probe.check({
          profile: {
            id: "test",
            name: "Office",
            host: "127.0.0.1",
            port: address.port,
            username: "admin",
            transport: "tcp",
            color: "blue",
            icon: "router",
            label: "",
          },
          password: "secret",
        }),
      ).pipe(Effect.provide(layer)),
    [Symbol.asyncDispose]: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
const acquireFixture = (login: "success" | "rejected" | "legacy", version?: string) =>
  Effect.acquireRelease(
    Effect.promise(() => fixture(login, version)),
    (router) => Effect.promise(() => router[Symbol.asyncDispose]()),
  );
it.live("authenticates and reads identity and version through the binary API", () =>
  Effect.gen(function* () {
    const router = yield* acquireFixture("success");
    expect(yield* router.check()).toEqual({
      kind: "connected",
      service: "router-api",
      identity: "Office",
      version: "6.49.18 (long-term)",
    });
    expect(router.commands).toHaveLength(3);
    expect(router.commands[1]).toContain("/system/identity/print");
    expect(router.commands[2]).toContain("=.proplist=version");
  }).pipe(Effect.scoped),
);
it.live("reports rejected credentials without exposing the router response", () =>
  Effect.gen(function* () {
    const router = yield* acquireFixture("rejected");
    expect(yield* router.check()).toEqual({ kind: "failed", reason: "authentication" });
    expect(router.commands).toHaveLength(1);
  }).pipe(Effect.scoped),
);
it.live("answers the pre-6.43 login challenge before reading router identity", () =>
  Effect.gen(function* () {
    const router = yield* acquireFixture("legacy", "6.42.12");
    expect(yield* router.check()).toEqual({
      kind: "connected",
      service: "router-api",
      identity: "Office",
      version: "6.42.12",
    });
    expect(router.commands[1]).toContain("=response=00");
  }).pipe(Effect.scoped),
);
it.live("rejects a different RouterOS generation", () =>
  Effect.gen(function* () {
    const router = yield* acquireFixture("success", "7.20");
    expect(yield* router.check()).toEqual({ kind: "failed", reason: "unsupported" });
  }).pipe(Effect.scoped),
);
it("encodes UTF-8 byte lengths and two-byte API lengths", () => {
  expect(encodeSentence(["أ"]).subarray(0, 1)).toEqual(Buffer.from([2]));
  expect(encodeSentence(["a".repeat(128)]).subarray(0, 2)).toEqual(Buffer.from([0x80, 0x80]));
});
