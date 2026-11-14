// @effect-diagnostics nodeBuiltinImport:off
import * as NodeNet from "node:net";
import * as NodeTls from "node:tls";
import * as NodeCrypto from "node:crypto";
import { ApiDecoder, apiAttributes, encodeApiSentence } from "../routers/apiProtocol.ts";
import type { RouterProfile } from "@madar/contracts";

export async function routerFixture(
  initial = 3,
  options: { version?: string; legacy?: boolean; tls?: NodeTls.TlsOptions } = {},
) {
  const users = new Map<string, Record<string, string>>();
  for (let i = 1; i <= initial; i++)
    users.set(`*${i}`, {
      ".id": `*${i}`,
      customer: "admin",
      username: `voucher-${String(i).padStart(4, "0")}`,
      password: "fixture-password",
      disabled: "false",
      "actual-profile": "Day",
      "shared-users": "1",
      comment: "Fixture",
      "upload-used": "100",
      "download-used": "200",
      "uptime-used": "10m",
      "last-seen": "never",
      "active-sessions": "0",
    });
  const sockets = new Set<NodeNet.Socket>();
  const commands: readonly string[][] = [];
  let sequence = initial;
  let drop = "";
  let reject = "";
  const accept = (socket: NodeNet.Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const decoder = new ApiDecoder();
    socket.on("error", () => {});
    socket.on("data", (data: Buffer) =>
      decoder.push(data, (words) => {
        (commands as string[][]).push([...words]);
        const command = words[0] ?? "";
        const attributes = apiAttributes(words);
        const tag = words.find((word) => word.startsWith(".tag="));
        const send = (words: readonly string[]) =>
          socket.write(encodeApiSentence([...words, ...(tag ? [tag] : [])]));
        const row = (value: Record<string, string>) => {
          const selected = attributes[".proplist"]?.split(",");
          send([
            "!re",
            ...Object.entries(value)
              .filter(([key]) => !selected || selected.includes(key))
              .map(([key, value]) => `=${key}=${value}`),
          ]);
        };
        if (reject === command) {
          reject = "";
          send(["!trap", "=message=fixture rejection"]);
          send(["!done"]);
          return;
        }
        if (command === "/login") {
          if (options.legacy && !attributes.response) {
            send(["!done", "=ret=0123456789abcdef0123456789abcdef"]);
            return;
          }
          const expected =
            "00" +
            NodeCrypto.createHash("md5")
              .update(Buffer.from([0]))
              .update("fixture")
              .update(Buffer.from("0123456789abcdef0123456789abcdef", "hex"))
              .digest("hex");
          if (options.legacy ? attributes.response !== expected : attributes.password !== "fixture")
            send(["!trap", "=message=invalid user name or password"]);
        } else if (command === "/system/identity/print") row({ name: "Madar test router" });
        else if (command === "/system/resource/print")
          row({ version: options.version ?? "6.48.4" });
        else if (command === "/tool/user-manager/customer/print") row({ login: "admin" });
        else if (command === "/tool/user-manager/profile/print") {
          row({ name: "Day", owner: "admin", validity: "1d", "starts-at": "logon", price: "1" });
          row({ name: "Week", owner: "admin", validity: "1w", "starts-at": "now", price: "5" });
        } else if (command === "/tool/user-manager/user/print") {
          const filters = words.filter((word) => word.startsWith("?"));
          for (const user of users.values())
            if (
              filters.every((word) => {
                const end = word.indexOf("=");
                return user[word.slice(1, end)] === word.slice(end + 1);
              })
            )
              row(user);
        } else if (command === "/tool/user-manager/user/add") {
          if ([...users.values()].some((user) => user.username === attributes.username))
            send(["!trap", "=message=already exists"]);
          else {
            const id = `*${++sequence}`;
            users.set(id, { ".id": id, ...attributes, disabled: "false", "actual-profile": "" });
          }
        } else if (command === "/tool/user-manager/session/print") {
          row({
            ".id": "*s1",
            user: attributes.user ?? "",
            customer: "admin",
            uptime: "10m",
            upload: "100",
            download: "200",
            started: "nov/14/2026 12:00:00",
          });
        } else {
          const id =
            (command.endsWith("/create-and-activate-profile")
              ? attributes.numbers
              : attributes[".id"]) ?? "";
          const user = users.get(id);
          if (!user) send(["!trap", "=message=no such item"]);
          else if (command.endsWith("/remove")) users.delete(id);
          else if (command.endsWith("/set")) {
            const { numbers: _, ...values } = attributes;
            Object.assign(user, values);
          } else if (command.endsWith("/disable")) user.disabled = "true";
          else if (command.endsWith("/enable")) user.disabled = "false";
          else if (command.endsWith("/reset-counters")) {
            user["upload-used"] = "0";
            user["download-used"] = "0";
            user["uptime-used"] = "0s";
          } else if (command.endsWith("/create-and-activate-profile"))
            user["actual-profile"] = attributes.profile!;
          else send(["!trap", "=message=no such command"]);
        }
        if (drop === command) {
          drop = "";
          socket.destroy();
          return;
        }
        send(["!done"]);
      }),
    );
  };
  const server = options.tls
    ? NodeTls.createServer(options.tls, accept)
    : NodeNet.createServer(accept);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const profile: RouterProfile = {
    id: "test",
    name: "Fixture",
    host: "127.0.0.1",
    port: address.port,
    transport: options.tls ? "tls" : "tcp",
    username: "admin",
    color: "blue",
    icon: "router",
    label: "",
  };
  return {
    profile,
    commands,
    users,
    dropAfter: (command: string) => {
      drop = command;
    },
    rejectNext: (command: string) => {
      reject = command;
    },
    disconnect: () => {
      for (const socket of sockets) socket.destroy();
    },
    [Symbol.asyncDispose]: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
