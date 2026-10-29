import { describe, expect, it } from "@effect/vitest";

import { mapRemoteDpopEnvironmentError } from "./errors.ts";

import { NETWORK_BLOCKING_HINT } from "../errors/network.ts";
import { RemoteEnvironmentAuthFetchError, RemoteEnvironmentAuthTimeoutError } from "../rpc/http.ts";

describe("mapRemoteDpopEnvironmentError", () => {
  it.each([
    new RemoteEnvironmentAuthFetchError({
      message: "Failed to fetch remote environment endpoint.",
      cause: new TypeError("Failed to fetch"),
    }),
    new RemoteEnvironmentAuthTimeoutError("https://environment.example.test", 10_000),
  ])("suggests another network when the relay endpoint cannot be reached: $_tag", (error) => {
    const mapped = mapRemoteDpopEnvironmentError(error);
    expect(mapped).toMatchObject({
      _tag: "ConnectionTransientError",
      detail: `${error.message} ${NETWORK_BLOCKING_HINT}`,
    });
  });
});
