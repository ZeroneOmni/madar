// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeNet from "node:net";
import { Server, utils, type Connection } from "ssh2";
import { hostKeyFingerprint } from "./RouterSftp.ts";

const { STATUS_CODE } = utils.sftp;

/** An in-process SFTP server that serves in-memory files read-only, like a RouterOS router. */
export async function sftpFixture(
  files: Map<string, { data: Buffer; mtime: number }>,
  options: {
    /** Stop answering reads after this many, to model a stalled transfer. */
    stallAfter?: number;
    onRead?: (path: string, offset: number) => void;
    /** Receives each read and close answer instead of sending it, to pace them from a test. */
    hold?: (answer: () => void) => void;
    /** Answers each read with at most this many bytes, as a server may. */
    maxRead?: number;
  } = {},
) {
  const { privateKey } = NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" });
  const parsed = utils.parseKey(pem);
  if (parsed instanceof Error || Array.isArray(parsed)) throw new Error("Unreadable fixture key");
  const clients = new Set<Connection>();
  let closed = 0;
  let opened = 0;
  let reads = 0;
  const closedWaiters: (() => void)[] = [];
  const server = new Server({ hostKeys: [pem] });
  server.on("connection", (client) => {
    opened++;
    clients.add(client);
    client.on("error", () => {});
    client.on("close", () => {
      clients.delete(client);
      closed++;
      for (const wake of closedWaiters.splice(0)) wake();
    });
    client.on("authentication", (auth) => {
      if (auth.method === "password" && auth.password === "fixture") auth.accept();
      else auth.reject(["password"]);
    });
    client.on("ready", () =>
      client.on("session", (accept) => {
        accept().on("sftp", (accept) => {
          const sftp = accept();
          const handles = new Map<string, string>();
          let next = 0;
          const stat = (id: number, path: string) => {
            const file = files.get(path);
            if (!file) return sftp.status(id, STATUS_CODE.NO_SUCH_FILE);
            sftp.attrs(id, {
              mode: 0o100644,
              uid: 0,
              gid: 0,
              size: file.data.length,
              atime: file.mtime,
              mtime: file.mtime,
            });
          };
          sftp.on("STAT", stat);
          sftp.on("LSTAT", stat);
          sftp.on("OPEN", (id, path) => {
            if (!files.has(path)) return sftp.status(id, STATUS_CODE.NO_SUCH_FILE);
            const handle = Buffer.from(String(next++));
            handles.set(handle.toString(), path);
            sftp.handle(id, handle);
          });
          sftp.on("READ", (id, handle, offset, length) => {
            const path = handles.get(handle.toString());
            const file = path === undefined ? undefined : files.get(path);
            if (!file || path === undefined) return sftp.status(id, STATUS_CODE.FAILURE);
            options.onRead?.(path, offset);
            if (options.stallAfter !== undefined && ++reads > options.stallAfter) return;
            const answer = () =>
              offset >= file.data.length
                ? sftp.status(id, STATUS_CODE.EOF)
                : sftp.data(
                    id,
                    file.data.subarray(
                      offset,
                      offset + Math.min(length, options.maxRead ?? length),
                    ),
                  );
            if (options.hold) options.hold(answer);
            else answer();
          });
          sftp.on("CLOSE", (id, handle) => {
            handles.delete(handle.toString());
            const answer = () => sftp.status(id, STATUS_CODE.OK);
            if (options.hold) options.hold(answer);
            else answer();
          });
        });
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing SFTP fixture address");
  return {
    port: address.port,
    hostKey: hostKeyFingerprint(parsed.getPublicSSH()),
    /** SSH connections accepted so far. */
    connections: () => opened,
    /** Resolves once `count` client connections have closed in total. */
    closedConnections: (count: number) =>
      new Promise<void>((resolve) => {
        const check = () => (closed >= count ? resolve() : closedWaiters.push(check));
        check();
      }),
    async [Symbol.asyncDispose]() {
      for (const client of clients) client.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** A local port with nothing listening, for "connection refused". */
export async function closedPort() {
  const probe = NodeNet.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (!address || typeof address === "string") throw new Error("Missing probe address");
  return address.port;
}
