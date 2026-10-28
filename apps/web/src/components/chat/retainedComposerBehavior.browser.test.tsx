import { useRef } from "react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import {
  composerTargetKey,
  useComposerDraftStore,
  type ComposerImageAttachment,
  type ComposerFileAttachment,
} from "../../composerDraftStore";
import { usePromptStashStore } from "../../promptStashStore";
import { terminalContextRecord } from "../../lib/composerContextRecords";
import type { TerminalContextDraft } from "../../lib/terminalContext";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "../composerContextPresentation";
import { useComposerStash } from "./useComposerStash";
import { useComposerContextImport } from "./useComposerContextImport";
import type { ComposerPromptEditorHandle } from "../ComposerPromptEditor";

const ref = scopeThreadRef(EnvironmentId.make("retained-behavior"), ThreadId.make("thread"));
const keybindings = mergeWithDefaultKeybindings([]);
const context: TerminalContextDraft = {
  id: "legacy-context",
  threadId: ref.threadId,
  terminalId: "old-terminal",
  terminalLabel: "Terminal 1",
  lineStart: 1,
  lineEnd: 1,
  text: "Saved diagnostic output",
  createdAt: "2026-10-01T00:00:00Z",
};
function StashHarness({ image }: { image: ComposerImageAttachment }) {
  const promptRef = useRef("Keep this image");
  const composerImagesRef = useRef([image]);
  const composerFilesRef = useRef<ComposerFileAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([context]);
  const targetKey = useRef(composerTargetKey(ref));
  const editor = useRef<ComposerPromptEditorHandle | null>(null);
  const imports = useRef(new Map<string, number>());
  useComposerStash({
    environmentId: ref.environmentId,
    composerDraftTarget: ref,
    promptRef,
    composerImagesRef,
    composerFilesRef,
    composerTerminalContextsRef,
    keybindings,
    projectSelectionRequired: false,
    pendingUserInputs: [],
    activePendingProgress: null,
    prompt: "Keep this image",
    composerMenuOpen: false,
    isComposerModelPickerOpen: false,
    isComposerCollapsedMobile: false,
    composerPreviewAnnotations: [],
    composerReviewComments: [],
    composerThreadContexts: [],
    attachmentTargetKeyRef: targetKey,
    composerDraftTargetKeyRef: targetKey,
    composerEditorRef: editor,
    pendingThreadImportsRef: imports,
    setComposerCursor: () => undefined,
    setComposerTrigger: () => undefined,
    importContextRecords: () => new Map(),
    expandMobileComposer: () => undefined,
  });
  return <p>Image draft</p>;
}
function ImportHarness() {
  const targetKey = useRef(composerTargetKey(ref));
  const composerFilesRef = useRef<ComposerFileAttachment[]>([]);
  const pendingThreadImportsRef = useRef(new Map<string, number>());
  const { importContextRecords } = useComposerContextImport({
    environmentId: ref.environmentId,
    activeThread: undefined,
    activeThreadId: ref.threadId,
    composerDraftTarget: ref,
    attachmentDraftTarget: ref,
    attachmentTargetKey: composerTargetKey(ref),
    attachmentTargetKeyRef: targetKey,
    questionAttachmentTarget: null,
    pendingUserInputs: [],
    composerContextRecords: EMPTY_COMPOSER_CONTEXT_RECORDS,
    composerImages: [],
    composerFilesRef,
    pendingThreadImportsRef,
    addComposerFilesToDraft: () => [],
  });
  return (
    <button
      onClick={() => importContextRecords([terminalContextRecord(context)], ref.environmentId)}
    >
      Import saved context
    </button>
  );
}
const stashChord = () =>
  /Mac/.test(navigator.platform) ? "{Meta>}s{/Meta}" : "{Control>}s{/Control}";
it("keeps compressed image data in a stash after clearing the composer", async () => {
  usePromptStashStore.setState({ entries: [] });
  useComposerDraftStore.getState().clearComposerContent(ref);
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  canvas.getContext("2d")!.fillRect(0, 0, 2, 2);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((value) => resolve(value!), "image/png"),
  );
  const file = new File([blob], "picture.png", { type: "image/png" });
  const image: ComposerImageAttachment = {
    type: "image",
    id: "stash-image",
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: "",
    file,
  };
  useComposerDraftStore.getState().setPrompt(ref, "Keep this image");
  useComposerDraftStore.getState().addImages(ref, [image]);
  useComposerDraftStore.getState().setTerminalContexts(ref, [context]);
  await using screen = await render(<StashHarness image={image} />);
  await userEvent.keyboard(stashChord());
  await vi.waitFor(() =>
    expect(usePromptStashStore.getState().entries[0]?.pendingImageCount ?? 0).toBe(0),
  );
  const stashed = usePromptStashStore.getState().entries[0];
  expect(stashed?.prompt).toBe("Keep this image");
  expect(stashed?.attachments).toHaveLength(1);
  expect(stashed?.records).toContainEqual(terminalContextRecord(context));
  expect(useComposerDraftStore.getState().getComposerDraft(ref)?.terminalContexts ?? []).toEqual(
    [],
  );
  expect(stashed?.attachments[0]?.dataUrl).toMatch(/^data:image\//);
  expect(useComposerDraftStore.getState().getComposerDraft(ref)?.images ?? []).toEqual([]);
});
it("retains the text behind an imported legacy terminal reference", async () => {
  useComposerDraftStore.getState().clearComposerContent(ref);
  await using screen = await render(<ImportHarness />);
  await userEvent.click(page.getByRole("button", { name: "Import saved context" }));
  expect(useComposerDraftStore.getState().getComposerDraft(ref)?.terminalContexts).toEqual([
    { ...context, createdAt: expect.any(String) },
  ]);
});
