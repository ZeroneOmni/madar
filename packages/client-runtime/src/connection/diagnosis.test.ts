import { describe, expect, it } from "@effect/vitest";

import { mapRemoteEnvironmentError } from "./errors.ts";
import { presentConnectionDiagnosis } from "./diagnosis.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  type ConnectionAttemptError,
  type SupervisorConnectionState,
} from "./model.ts";
import { RemoteEnvironmentAuthFetchError } from "../rpc/http.ts";

const backoff = (lastFailure: ConnectionAttemptError): SupervisorConnectionState => ({
  ...AVAILABLE_CONNECTION_STATE,
  desired: true,
  network: "online",
  phase: "backoff",
  attempt: 3,
  lastFailure,
  retryAt: Date.UTC(2026, 9, 19, 12, 0, 30),
});

const diagnose = (state: SupervisorConnectionState, via: "relay" | "direct" = "relay") =>
  presentConnectionDiagnosis({ hostLabel: "Mac mini", state, via });

describe("presentConnectionDiagnosis", () => {
  it("blames this device when it cannot reach a tunnel the relay already reached", () => {
    const failure = mapRemoteEnvironmentError(
      new RemoteEnvironmentAuthFetchError({ message: "Failed to fetch", cause: new TypeError() }),
      "relay",
    );
    // A learned LAN route makes the environment's usual route direct; the failure still names the relay.
    const diagnosis = diagnose(backoff(failure), "direct");
    expect(diagnosis?.headline).toBe("This device can't reach Mac mini's tunnel");
    expect(diagnosis?.hops).toHaveLength(4);
    expect(diagnosis?.steps.join(" ")).not.toContain("On Mac mini");
  });
});
