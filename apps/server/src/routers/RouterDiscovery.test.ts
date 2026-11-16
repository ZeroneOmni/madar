// @effect-diagnostics nodeBuiltinImport:off
import * as NodeEvents from "node:events";
import * as NodeDgram from "node:dgram";
import * as NodeOS from "node:os";
import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Deferred from "effect/Deferred";
import * as TestClock from "effect/testing/TestClock";
import * as RouterDiscovery from "./RouterDiscovery.ts";

vi.mock("node:dgram", () => ({ createSocket: vi.fn() }));
vi.mock("node:os", () => ({ networkInterfaces: vi.fn() }));

function attribute(type: number, value: Buffer | string) {
  const data = Buffer.from(value);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(type);
  header.writeUInt16BE(data.length, 2);
  return Buffer.concat([header, data]);
}
function advertisement(identity = "Office") {
  return Buffer.concat([
    Buffer.alloc(4),
    attribute(1, Buffer.from("102030405060", "hex")),
    attribute(5, identity),
    attribute(7, "6.49.18"),
    attribute(12, "hAP"),
    attribute(99, "unknown"),
  ]);
}
function yasNetAdvertisement() {
  return Buffer.from(
    "041a00000001000604f41c1bc2ef000500075941532d4e45540007000f362e34382e342028737461626c6529" +
      "000800084d696b726f54696b000a00044e100600000b000951454d492d514b4649000c0009524231313030447834" +
      "000e0001000010000d42522d4f55542f657468657236001100040a000001",
    "hex",
  );
}
function setup() {
  const socket = Object.assign(new NodeEvents.EventEmitter(), {
    bind: vi.fn((_port: number, _host: string, ready: () => void) => ready()),
    setBroadcast: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
  });
  vi.mocked(NodeDgram.createSocket).mockReturnValue(socket as unknown as NodeDgram.Socket);
  vi.mocked(NodeOS.networkInterfaces).mockReturnValue({
    Ethernet: [
      {
        address: "192.168.88.2",
        netmask: "255.255.255.0",
        family: "IPv4",
        internal: false,
        cidr: "192.168.88.2/24",
        mac: "aa:bb:cc:dd:ee:ff",
      },
    ],
    Loopback: [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4",
        internal: true,
        cidr: "127.0.0.1/8",
        mac: "00:00:00:00:00:00",
      },
    ],
  });
  return socket;
}

it("decodes MNDP metadata and ignores unknown attributes", () => {
  expect(RouterDiscovery.parseAdvertisement(advertisement(), "192.168.88.1")).toEqual({
    host: "192.168.88.1",
    mac: "10:20:30:40:50:60",
    identity: "Office",
    version: "6.49.18",
    board: "hAP",
  });
});

it("decodes the captured YAS-NET RouterOS 6.48.4 advertisement", () => {
  expect(RouterDiscovery.parseAdvertisement(yasNetAdvertisement(), "10.0.0.1")).toEqual({
    host: "10.0.0.1",
    mac: "04:f4:1c:1b:c2:ef",
    identity: "YAS-NET",
    version: "6.48.4 (stable)",
    board: "RB1100Dx4",
  });
});

it.each([0xe3, 0xe4, 0xff])(
  "accepts a nonzero header byte %i without relaxing TLV validation",
  (first) => {
    const packet = yasNetAdvertisement();
    packet[0] = first;
    expect(RouterDiscovery.parseAdvertisement(packet, "10.0.0.1")?.identity).toBe("YAS-NET");
    expect(RouterDiscovery.parseAdvertisement(packet.subarray(0, -1), "10.0.0.1")).toBeNull();
  },
);

it("rejects truncated packets, probes, invalid addresses and missing MACs", () => {
  for (const packet of [
    Buffer.alloc(0),
    Buffer.alloc(4),
    advertisement().subarray(0, 9),
    Buffer.concat([advertisement(), Buffer.from([1])]),
  ])
    expect(RouterDiscovery.parseAdvertisement(packet, "192.168.88.1")).toBeNull();
  expect(RouterDiscovery.parseAdvertisement(advertisement(), "127.0.0.1")).toBeNull();
});

it("uses the advertised IPv4 address when the sender has no address", () => {
  expect(
    RouterDiscovery.parseAdvertisement(
      Buffer.concat([advertisement(), attribute(17, Buffer.from([192, 168, 88, 1]))]),
      "0.0.0.0",
    )?.host,
  ).toBe("192.168.88.1");
});

it("keeps MAC-only neighbors visible without inventing an IP address", () => {
  expect(RouterDiscovery.parseAdvertisement(advertisement(), "0.0.0.0")).toMatchObject({
    host: null,
    mac: "10:20:30:40:50:60",
    identity: "Office",
  });
});

it.effect(
  "keeps listening between snapshots, includes other subnets, and limits probes to once a minute",
  () =>
    Effect.gen(function* () {
      const socket = setup();
      socket.send.mockImplementation((_packet, _port, _host, callback) => callback(null));
      const api = yield* RouterDiscovery.RouterDiscovery;
      expect(yield* api.scan()).toEqual({ kind: "complete", routers: [] });
      expect(socket.close).not.toHaveBeenCalled();
      expect(socket.send).toHaveBeenCalledWith(
        Buffer.alloc(4),
        5678,
        "192.168.88.255",
        expect.any(Function),
      );
      socket.emit("message", advertisement(), { address: "192.168.88.1", port: 5678 });
      socket.emit("message", advertisement("Updated"), { address: "192.168.88.1", port: 5678 });
      socket.emit("message", yasNetAdvertisement(), { address: "10.0.0.1", port: 5678 });
      socket.emit("message", advertisement(), { address: "192.168.88.3", port: 1234 });
      const result = yield* api.scan();
      expect(result).toMatchObject({
        kind: "complete",
        routers: [
          { host: "10.0.0.1", identity: "YAS-NET" },
          { host: "192.168.88.1", identity: "Updated" },
        ],
      });
      expect(socket.send).toHaveBeenCalledOnce();
      yield* TestClock.adjust("1 minute");
      yield* api.scan();
      expect(socket.send).toHaveBeenCalledTimes(2);
    }).pipe(Effect.provide(RouterDiscovery.layer)),
);

it.effect("expires silent neighbors and clears results when connected networks change", () =>
  Effect.gen(function* () {
    const socket = setup();
    socket.send.mockImplementation((_packet, _port, _host, callback) => callback(null));
    const api = yield* RouterDiscovery.RouterDiscovery;
    yield* api.scan();
    socket.emit("message", advertisement(), { address: "0.0.0.0", port: 5678 });
    expect(yield* api.scan()).toMatchObject({ routers: [{ host: null }] });
    yield* TestClock.adjust("3 minutes");
    expect(yield* api.scan()).toEqual({ kind: "complete", routers: [] });
    socket.emit("message", yasNetAdvertisement(), { address: "10.0.0.1", port: 5678 });
    expect(yield* api.scan()).toMatchObject({ routers: [{ identity: "YAS-NET" }] });
    const interfaces = NodeOS.networkInterfaces();
    vi.mocked(NodeOS.networkInterfaces).mockReturnValue({
      Ethernet: interfaces.Ethernet?.map((entry) => ({ ...entry, address: "192.168.90.2" })),
    });
    expect(yield* api.scan()).toEqual({ kind: "complete", routers: [] });
  }).pipe(Effect.provide(RouterDiscovery.layer)),
);

it.effect("releases the socket on interruption and allows another search", () =>
  Effect.gen(function* () {
    const socket = setup();
    const started = yield* Deferred.make<void>();
    socket.bind.mockImplementation(() => Deferred.doneUnsafe(started, Effect.void));
    const api = yield* RouterDiscovery.RouterDiscovery;
    const scan = yield* Effect.forkChild(api.scan());
    yield* Deferred.await(started);
    yield* Fiber.interrupt(scan);
    expect(socket.close).toHaveBeenCalledOnce();
    socket.bind.mockImplementation(() => {
      socket.emit("error", new Error("port unavailable"));
    });
    expect(yield* api.scan()).toEqual({ kind: "failed", reason: "unavailable" });
  }).pipe(Effect.provide(RouterDiscovery.layer)),
);

it.effect("reports when no connected IPv4 network exists", () =>
  Effect.gen(function* () {
    setup();
    vi.mocked(NodeOS.networkInterfaces).mockReturnValue({});
    const api = yield* RouterDiscovery.RouterDiscovery;
    expect(yield* api.scan()).toEqual({ kind: "failed", reason: "no-network" });
  }).pipe(Effect.provide(RouterDiscovery.layer)),
);

it.effect("releases the persistent listener when its service scope closes", () =>
  Effect.gen(function* () {
    const socket = setup();
    socket.send.mockImplementation((_packet, _port, _host, callback) => callback(null));
    yield* Effect.gen(function* () {
      const api = yield* RouterDiscovery.RouterDiscovery;
      yield* api.scan();
      expect(socket.close).not.toHaveBeenCalled();
    }).pipe(Effect.provide(RouterDiscovery.layer));
    expect(socket.close).toHaveBeenCalledOnce();
  }),
);

it.effect("reopens a failed listener and resumes receiving advertisements", () =>
  Effect.gen(function* () {
    const socket = setup();
    socket.send.mockImplementation((_packet, _port, _host, callback) => callback(null));
    const api = yield* RouterDiscovery.RouterDiscovery;
    yield* api.scan();
    socket.emit("error", new Error("network changed"));
    expect(socket.close).toHaveBeenCalledOnce();
    const replacement = setup();
    replacement.send.mockImplementation((_packet, _port, _host, callback) => callback(null));
    yield* api.scan();
    expect(replacement.bind).toHaveBeenCalledOnce();
    expect(replacement.send).toHaveBeenCalledOnce();
    replacement.emit("message", yasNetAdvertisement(), { address: "10.0.0.1", port: 5678 });
    expect(yield* api.scan()).toMatchObject({ routers: [{ identity: "YAS-NET" }] });
  }).pipe(Effect.provide(RouterDiscovery.layer)),
);
