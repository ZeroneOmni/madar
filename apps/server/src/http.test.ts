import { expect, it } from "@effect/vitest";
import { describe, vi } from "vite-plus/test";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Queue from "effect/Queue";
import { HttpClient, HttpClientRequest, HttpRouter, HttpServerResponse } from "effect/http";

import { ORCHESTRATION_PROTOCOL_HEADER } from "@t3tools/contracts";

import * as ServerConfig from "./config.ts";

import * as ServerHttp from "./http.ts";

describe("browser API CORS", () => {
  it("accepts protocol negotiation with authenticated browser headers", async () => {
    const layerRoute = Layer.effectDiscard(
      Effect.gen(function* () {
        const router = yield* HttpRouter.HttpRouter;
        yield* router.add("GET", "/api/environment", HttpServerResponse.empty());
      }),
    );
    const layerApp = Layer.merge(layerRoute, ServerHttp.layerBrowserApiCors).pipe(
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "http-cors-test-" })),
      Layer.provide(NodeServices.layer),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(layerApp, { disableLogger: true });

    try {
      const response = await handler(
        new Request("https://backend.example/api/environment", {
          method: "OPTIONS",
          headers: {
            origin: "https://app.t3.codes",
            "access-control-request-method": "GET",
            "access-control-request-headers": [
              ORCHESTRATION_PROTOCOL_HEADER,
              "authorization",
              "dpop",
            ].join(", "),
          },
        }),
      );

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      const allowedHeaders = new Set(
        (response.headers.get("access-control-allow-headers") ?? "")
          .split(",")
          .map((header) => header.trim().toLowerCase()),
      );
      expect(allowedHeaders.has(ORCHESTRATION_PROTOCOL_HEADER)).toBe(true);
      expect(allowedHeaders.has("authorization")).toBe(true);
      expect(allowedHeaders.has("dpop")).toBe(true);
    } finally {
      await dispose();
    }
  });
});

const layerFileResponse = Layer.mergeAll(NodeHttpPlatform.layer, NodeServices.layer);

const makeStaticRequest = Effect.fn("HttpTest.makeStaticRequest")(function* (staticDir: string) {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const layerApp = Layer.merge(
    ServerHttp.layerStaticAndDevRoute,
    ServerHttp.layerHttpCompression,
  ).pipe(Layer.provideMerge(NodeHttpPlatform.layer));
  // HttpRouter.serve prefers outer services; inject the test FileSystem between it and NodeHttpServer.layerTest.
  const services = yield* Layer.build(
    HttpRouter.serve(layerApp, { disableListenLog: true }).pipe(
      Layer.provideMerge(ServerConfig.layer({ ...config, staticDir })),
      Layer.provideMerge(Layer.succeed(FileSystem.FileSystem, fileSystem)),
      Layer.provideMerge(NodeHttpServer.layerTest),
    ),
  );
  const client = Context.get(services, HttpClient.HttpClient);
  return (resource: string, options?: HttpClientRequest.Options) =>
    client.execute(HttpClientRequest.make(options?.method ?? "GET")(resource, options));
});

it.layer(
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-static-http-test-" }).pipe(
    Layer.provideMerge(NodeServices.layer),
  ),
)("static HTTP responses", (it) => {
  it.effect("revalidates non-HTML files and returns changed contents", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-static-cache-" });
      const assetPath = path.join(staticDir, "app.js");
      yield* fs.writeFileString(assetPath, 'export const build = "first";');
      const request = yield* makeStaticRequest(staticDir);

      const initial = yield* request("/app.js");
      expect(initial.status).toBe(200);
      expect(yield* initial.text).toContain("first");
      const etag = initial.headers["etag"]!;
      const lastModified = initial.headers["last-modified"]!;
      expect(etag).toBeTruthy();
      expect(lastModified).toBeTruthy();
      for (const headers of [
        { "if-none-match": etag },
        { "if-none-match": etag.replace(/^W\//, "") },
        { "if-none-match": `"other", ${etag}` },
        { "if-none-match": "*" },
        { "if-modified-since": lastModified },
      ]) {
        const response = yield* request("/app.js", { headers });
        expect(response.status).toBe(304);
        expect(response.headers["etag"]).toBe(etag);
        expect(response.headers["cache-control"]).toBe("no-cache");
        expect(yield* response.text).toBe("");
      }
      const mismatched = yield* request("/app.js", {
        headers: { "if-none-match": '"another-build"', "if-modified-since": lastModified },
      });
      expect(mismatched.status).toBe(200);
      expect(yield* mismatched.text).toContain("first");

      yield* fs.writeFileString(assetPath, 'export const build = "the next build";');
      const changed = yield* request("/app.js", { headers: { "if-none-match": etag } });
      expect(changed.status).toBe(200);
      expect(changed.headers["etag"]).not.toBe(etag);
      expect(yield* changed.text).toContain("next build");
    }),
  );

  it.effect("serves static files without handles and skips fallback reads for HEAD and 304", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-static-no-open-" });
      const filePath = path.join(staticDir, "app.txt");
      const body = "packaged asset";
      yield* fs.writeFileString(filePath, body);
      let reads = 0;
      // Electron asar files can be statted and read even when opening a handle fails.
      const fileSystem = FileSystem.FileSystem.of({
        ...fs,
        open: (candidate, options) =>
          candidate === filePath
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "NotFound",
                  module: "FileSystem",
                  method: "open",
                  pathOrDescriptor: candidate,
                }),
              )
            : fs.open(candidate, options),
        readFile: (candidate) =>
          Effect.gen(function* () {
            if (candidate === filePath) reads += 1;
            return yield* fs.readFile(candidate);
          }),
      });
      const request = yield* makeStaticRequest(staticDir).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
      );

      const get = yield* request("/app.txt");
      expect(get.status).toBe(200);
      expect(yield* get.text).toBe(body);
      expect(reads).toBeGreaterThan(0);
      const readsAfterGet = reads;
      const head = yield* request("/app.txt", { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(yield* head.text).toBe("");
      expect(reads).toBe(readsAfterGet);
      const unchanged = yield* request("/app.txt", {
        headers: { "if-none-match": get.headers["etag"]! },
      });
      expect(unchanged.status).toBe(304);
      expect(yield* unchanged.text).toBe("");
      expect(reads).toBe(readsAfterGet);
    }),
  );

  it.effect("serves replacement bytes with matching static fallback length and validators", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-static-replaced-" });
      const filePath = path.join(staticDir, "app.txt");
      const before = DateTime.toDateUtc(DateTime.makeUnsafe("1985-10-26T08:15:00.000Z"));
      const after = DateTime.toDateUtc(DateTime.makeUnsafe("2015-10-21T16:29:00.000Z"));
      const replacement = "the replacement asset";
      const replacementPath = path.join(staticDir, "replacement.txt");
      yield* fs.writeFileString(filePath, "old");
      yield* fs.utimes(filePath, before, before);
      yield* fs.writeFileString(replacementPath, replacement);
      yield* fs.utimes(replacementPath, after, after);
      let replaceOnOpen = false;
      const fileSystem = FileSystem.FileSystem.of({
        ...fs,
        open: (candidate, options) =>
          Effect.gen(function* () {
            if (candidate !== filePath) return yield* fs.open(candidate, options);
            if (replaceOnOpen) {
              yield* fs.rename(replacementPath, filePath);
              replaceOnOpen = false;
            }
            return yield* PlatformError.systemError({
              _tag: "NotFound",
              module: "FileSystem",
              method: "open",
              pathOrDescriptor: candidate,
            });
          }),
      });
      const request = yield* makeStaticRequest(staticDir).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
      );
      const initial = yield* request("/app.txt", { headers: { "accept-encoding": "identity" } });
      expect(yield* initial.text).toBe("old");

      replaceOnOpen = true;
      const response = yield* request("/app.txt", { headers: { "accept-encoding": "identity" } });
      expect(response.status).toBe(200);
      expect(response.headers).toMatchObject({
        "content-length": String(Buffer.byteLength(replacement)),
        "last-modified": after.toUTCString(),
      });
      expect(response.headers["etag"]).not.toBe(initial.headers["etag"]);
      expect(yield* response.text).toBe(replacement);
    }),
  );

  it.effect("serves changed HTML when deployments preserve its size and timestamp", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-static-html-" });
      const indexPath = path.join(staticDir, "index.html");
      const modifiedAt = DateTime.toDateUtc(DateTime.makeUnsafe("1985-10-26T08:15:00.000Z"));
      yield* fs.writeFileString(indexPath, "<html>old build</html>");
      yield* fs.utimes(indexPath, modifiedAt, modifiedAt);
      const request = yield* makeStaticRequest(staticDir);
      const initial = yield* request("/");
      expect(yield* initial.text).toBe("<html>old build</html>");
      const previousEtag = initial.headers["etag"] ?? '"previous-html"';
      const nextHtml = "<html>new build</html>";
      yield* fs.writeFileString(indexPath, nextHtml);
      yield* fs.utimes(indexPath, modifiedAt, modifiedAt);

      for (const [resource, headers] of [
        ["/", { "if-none-match": previousEtag }],
        ["/threads/example", { "if-modified-since": modifiedAt.toUTCString() }],
        ["/", { "if-none-match": "*" }],
      ] as const) {
        const response = yield* request(resource, { headers });
        expect(response.status).toBe(200);
        expect(yield* response.text).toBe(nextHtml);
        expect(response.headers["cache-control"]).toBe("no-cache");
        expect(response.headers["etag"]).toBeUndefined();
        expect(response.headers["last-modified"]).toBeUndefined();
      }
      const head = yield* request("/", {
        method: "HEAD",
        headers: { "if-none-match": previousEtag, "accept-encoding": "identity" },
      });
      expect(head.status).toBe(200);
      expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(nextHtml)));
      expect(yield* head.text).toBe("");
    }),
  );

  it.effect("closes static descriptors after GET, HEAD, 304, and request cancellation", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-static-close-" });
      const filePath = path.join(staticDir, "app.txt");
      const body = "file content\n".repeat(1024);
      yield* fs.writeFileString(filePath, body);
      const closed = yield* Queue.unbounded<FileSystem.File>();
      const blocked = yield* Deferred.make<void>();
      const active = new Set<FileSystem.File>();
      let blockAfterOpen = false;
      let bodyReads = 0;
      const trackedFileSystem = FileSystem.FileSystem.of({
        ...fs,
        open: (candidate, options) =>
          Effect.gen(function* () {
            if (candidate !== filePath) return yield* fs.open(candidate, options);
            let opened: FileSystem.File | undefined;
            yield* Effect.addFinalizer(() =>
              Effect.gen(function* () {
                if (opened === undefined) return;
                active.delete(opened);
                yield* Queue.offer(closed, opened);
              }),
            );
            const file = yield* fs.open(candidate, options);
            opened = file;
            active.add(file);
            if (blockAfterOpen) {
              yield* Deferred.succeed(blocked, undefined);
              return yield* Effect.never;
            }
            return new Proxy(file, {
              get(target, key) {
                if (key === "readAlloc") {
                  return (size: number) => {
                    bodyReads += 1;
                    return target.readAlloc(size);
                  };
                }
                return Reflect.get(target, key, target);
              },
            });
          }),
      });
      const request = yield* makeStaticRequest(staticDir).pipe(
        Effect.provideService(FileSystem.FileSystem, trackedFileSystem),
      );

      const get = yield* request("/app.txt");
      expect(yield* get.text).toBe(body);
      yield* Queue.take(closed);
      expect(active.size).toBe(0);
      expect(bodyReads).toBeGreaterThan(0);
      const readsAfterGet = bodyReads;
      const head = yield* request("/app.txt", {
        method: "HEAD",
        headers: { "accept-encoding": "gzip" },
      });
      expect(head.status).toBe(200);
      expect(head.headers["content-encoding"]).toBe("gzip");
      expect(yield* head.text).toBe("");
      yield* Queue.take(closed);
      expect(active.size).toBe(0);
      expect(bodyReads).toBe(readsAfterGet);
      const unchanged = yield* request("/app.txt", {
        headers: { "if-none-match": get.headers["etag"]! },
      });
      expect(unchanged.status).toBe(304);
      yield* Queue.take(closed);
      expect(active.size).toBe(0);
      expect(bodyReads).toBe(readsAfterGet);

      blockAfterOpen = true;
      const cancelled = yield* request("/app.txt").pipe(Effect.forkChild);
      yield* Deferred.await(blocked);
      expect(active.size).toBe(1);
      yield* Fiber.interrupt(cancelled);
      yield* Queue.take(closed);
      expect(active.size).toBe(0);
    }),
  );
});
