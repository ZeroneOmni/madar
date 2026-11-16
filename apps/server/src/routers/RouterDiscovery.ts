// @effect-diagnostics nodeBuiltinImport:off
import * as NodeDgram from "node:dgram";
import * as NodeOS from "node:os";
import * as NodeNet from "node:net";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { DiscoveredRouter, RouterDiscoveryResult } from "@madar/contracts";

const PROBE_INTERVAL = 60000;
const NEIGHBOR_LIFETIME = 180000;

function discoveryNetworks(interfaces: ReturnType<typeof NodeOS.networkInterfaces>) {
  return Object.values(interfaces).flatMap((entries) =>
    (entries ?? []).flatMap((entry) => {
      if (entry.internal || entry.family !== "IPv4") return [];
      const address = entry.address.split(".").map(Number);
      const mask = entry.netmask.split(".").map(Number);
      const broadcast = address.map((part, i) => part | (~mask[i]! & 255)).join(".");
      if (broadcast === entry.address) return [];
      return [{ address: entry.address, mask: entry.netmask, broadcast }];
    }),
  );
}

function usableAddress(address: string) {
  return NodeNet.isIPv4(address) && !/^(0|127|22[4-9]|23\d|24\d|25[0-5])\./.test(address);
}

export function parseAdvertisement(packet: Buffer, source: string): DiscoveredRouter | null {
  if (packet.length < 4 || packet.length > 4096) return null;
  const fields = new Map<number, Buffer>();
  for (let offset = 4; offset < packet.length;) {
    if (offset + 4 > packet.length) return null;
    const type = packet.readUInt16BE(offset);
    const length = packet.readUInt16BE(offset + 2);
    offset += 4;
    if (offset + length > packet.length) return null;
    fields.set(type, packet.subarray(offset, offset + length));
    offset += length;
  }
  const mac = fields.get(1);
  if (!mac || mac.length !== 6 || mac.every((byte) => byte === 0)) return null;
  const advertised = fields.get(17);
  const advertisedHost = advertised?.length === 4 ? [...advertised].join(".") : "";
  const host = usableAddress(source)
    ? source
    : usableAddress(advertisedHost)
      ? advertisedHost
      : null;
  if (!host && source !== "0.0.0.0") return null;
  const text = (type: number) =>
    (fields.get(type)?.toString("utf8") ?? "")
      .split("")
      .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join("")
      .slice(0, 128);
  return {
    host,
    mac: [...mac].map((byte) => byte.toString(16).padStart(2, "0")).join(":"),
    identity: text(5),
    version: text(7),
    board: text(12),
  };
}

export class RouterDiscovery extends Context.Service<
  RouterDiscovery,
  { readonly scan: () => Effect.Effect<RouterDiscoveryResult> }
>()("madar/routers/RouterDiscovery") {}

const make = Effect.gen(function* () {
  const clock = yield* Clock.Clock;
  let socket: NodeDgram.Socket | null = null;
  let starting = false;
  let nextProbe = 0;
  let networkKey = "";
  const routers = new Map<string, { router: DiscoveredRouter; expiresAt: number }>();
  function close() {
    const previous = socket;
    socket = null;
    try {
      previous?.close();
    } catch {
      /* A failed bind may not allocate a socket handle. */
    }
  }
  yield* Effect.addFinalizer(() => Effect.sync(close));
  const scan = Effect.fn("RouterDiscovery.scan")(function* () {
    if (starting) return { kind: "failed", reason: "busy" } as const;
    const networks = discoveryNetworks(NodeOS.networkInterfaces());
    if (!networks.length) {
      close();
      routers.clear();
      networkKey = "";
      return { kind: "failed", reason: "no-network" } as const;
    }
    const currentKey = networks
      .map(({ address, mask }) => `${address}/${mask}`)
      .sort()
      .join(",");
    if (currentKey !== networkKey) {
      routers.clear();
      nextProbe = 0;
      networkKey = currentKey;
    }
    if (!socket) {
      nextProbe = 0;
      starting = true;
      const available = yield* Effect.callback<boolean>((resume) => {
        const listener = NodeDgram.createSocket({ type: "udp4", reuseAddr: true });
        socket = listener;
        let ready = false;
        listener.on("error", () => {
          if (socket === listener) close();
          if (!ready) {
            ready = true;
            resume(Effect.succeed(false));
          }
        });
        listener.on("message", (packet, remote) => {
          if (socket !== listener || remote.port !== 5678) return;
          const router = parseAdvertisement(packet, remote.address);
          if (!router) return;
          const now = clock.currentTimeMillisUnsafe();
          for (const [key, entry] of routers) if (entry.expiresAt <= now) routers.delete(key);
          if (routers.size < 256 || routers.has(router.mac))
            routers.set(router.mac, { router, expiresAt: now + NEIGHBOR_LIFETIME });
        });
        try {
          listener.bind(5678, "0.0.0.0", () => {
            if (socket !== listener) return;
            ready = true;
            resume(Effect.succeed(true));
          });
        } catch {
          close();
          ready = true;
          resume(Effect.succeed(false));
        }
        return Effect.sync(() => {
          if (!ready) close();
        });
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            starting = false;
          }),
        ),
      );
      if (!available) return { kind: "failed", reason: "unavailable" } as const;
    }
    const listener = socket;
    if (!listener) return { kind: "failed", reason: "unavailable" } as const;
    const now = yield* clock.currentTimeMillis;
    if (now >= nextProbe) {
      nextProbe = now + PROBE_INTERVAL;
      const sent = yield* Effect.callback<boolean>((resume) => {
        const broadcasts = new Set(networks.map((network) => network.broadcast));
        let remaining = broadcasts.size;
        let success = false;
        try {
          listener.setBroadcast(true);
          for (const broadcast of broadcasts)
            listener.send(Buffer.alloc(4), 5678, broadcast, (error) => {
              if (!error) success = true;
              if (--remaining === 0) resume(Effect.succeed(success));
            });
        } catch {
          resume(Effect.succeed(false));
        }
      });
      if (!sent) return { kind: "failed", reason: "unavailable" } as const;
    }
    for (const [key, entry] of routers) if (entry.expiresAt <= now) routers.delete(key);
    return {
      kind: "complete",
      routers: [...routers.values()]
        .map(({ router }) => router)
        .sort((a, b) => (a.host ?? a.mac).localeCompare(b.host ?? b.mac)),
    } as const;
  });
  return RouterDiscovery.of({ scan });
});
export const layer = Layer.effect(RouterDiscovery, make);
