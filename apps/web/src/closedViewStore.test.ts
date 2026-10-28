import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { type ClosedViewEntry, useClosedViewStore } from "./closedViewStore";

const ref = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-A"));
const file = {
  kind: "panel-tab",
  threadRef: ref,
  surface: {
    kind: "file",
    id: "file:config",
    relativePath: "config.txt",
    revealLine: null,
    revealRequestId: 0,
  },
} as const;

describe("closedViewStore", () => {
  it("migrates saved history by keeping file tabs and dropping retired surfaces", async () => {
    useClosedViewStore.setState({ entries: [] });
    const id = useClosedViewStore.getState().remember(file);
    const { storage, name } = useClosedViewStore.persist.getOptions();
    const valid = useClosedViewStore.getState().entries;
    await storage!.setItem(name!, {
      state: {
        entries: [
          ...valid,
          { id: "browser", kind: "browser", threadRef: ref, snapshot: { tabId: "old" } },
          ...["preview", "terminal", "diff", "pull-request", "pull-requests"].map((kind) => ({
            id: kind,
            kind: "panel-tab",
            threadRef: ref,
            surface: { kind, id: kind },
          })),
          {
            id: "invalid",
            kind: "panel-tab",
            threadRef: ref,
            surface: { kind: "file", id: "bad" },
          },
        ] as ClosedViewEntry[],
      },
      version: 2,
    });
    await useClosedViewStore.persist.rehydrate();
    expect(useClosedViewStore.getState().entries).toEqual([{ ...file, id }]);
    expect(JSON.stringify(await storage!.getItem(name!))).not.toContain('"terminal"');
  });
  it("keeps the latest closure once per file and scopes history to its environment", () => {
    useClosedViewStore.setState({ entries: [] });
    const store = useClosedViewStore.getState();
    store.remember(file);
    const second = store.remember({
      ...file,
      threadRef: scopeThreadRef(EnvironmentId.make("env-2"), ref.threadId),
    });
    const latest = store.remember(file);
    expect(useClosedViewStore.getState().entries.map((entry) => entry.id)).toEqual([
      latest,
      second,
    ]);
    store.defer(latest);
    expect(useClosedViewStore.getState().entries.map((entry) => entry.id)).toEqual([
      second,
      latest,
    ]);
    store.remove(second);
    expect(useClosedViewStore.getState().entries.map((entry) => entry.id)).toEqual([latest]);
  });
});
