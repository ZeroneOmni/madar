import type { AssetResource, OrchestrationV2TurnItem } from "@t3tools/contracts";
import { toolOutputImageBlocks, toolOutputImages } from "@t3tools/shared/toolOutput";

const MAX_TEXT_BLOCK_DEPTH = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromBlocks(
  value: unknown,
  depth: number,
  imageBlocks: ReadonlyArray<unknown>,
): string | null {
  if (depth > MAX_TEXT_BLOCK_DEPTH) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map((block) => textFromBlocks(block, depth + 1, imageBlocks));
    return parts.every((part) => part !== null)
      ? parts.filter((part) => part !== "").join("\n")
      : null;
  }
  if (!isRecord(value)) return null;
  if (value.type === "text" && typeof value.text === "string") return value.text;
  if (value.type === "image") return imageBlocks.includes(value) ? "" : "[image]";
  if (value.type === "resource_link" && typeof value.uri === "string") return value.uri;
  if (value.type === "resource" && isRecord(value.resource)) {
    const resource = value.resource;
    if (typeof resource.text === "string") return resource.text;
    if (typeof resource.uri === "string") return resource.uri;
  }
  const keys = Object.keys(value).filter((key) => key !== "isError" && key !== "is_error");
  if (keys.length === 1 && keys[0] === "content")
    return textFromBlocks(value.content, depth + 1, imageBlocks);
  if (keys.length === 2 && keys.includes("content") && keys.includes("structuredContent")) {
    const text = textFromBlocks(value.content, depth + 1, imageBlocks);
    return text?.trim() ? text : null;
  }
  return null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function prettyJsonText(text: string): string {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return text;
  const whole = parseJson(trimmed);
  if (whole !== undefined) return JSON.stringify(whole, null, 2);
  const lines = trimmed.split("\n").filter((line) => line.trim());
  const documents = lines.map((line) => parseJson(line.trim()));
  if (documents.some((document) => document === undefined)) return text;
  return documents.map((document) => JSON.stringify(document, null, 2)).join("\n\n");
}

function formatToolValue(value: unknown, hasImagePreview = false): string | null {
  if (value === undefined || value === null) return null;
  if (hasImagePreview && isRecord(value) && value.type === "image") return null;
  const text = textFromBlocks(value, 0, toolOutputImageBlocks(value));
  if (text !== null) return text.trim() ? prettyJsonText(text) : null;
  let json: string | undefined;
  try {
    json = JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
  if (json === undefined || json === "{}" || json === "[]") return null;
  return json;
}

function commandOutputText(output: string): string {
  if (!output.trimStart().startsWith('{"stdout"')) return output;
  const parsed = parseJson(output.trim());
  if (
    !isRecord(parsed) ||
    typeof parsed.stdout !== "string" ||
    typeof parsed.stderr !== "string" ||
    typeof parsed.interrupted !== "boolean"
  ) {
    return output;
  }
  return [parsed.stdout, parsed.stderr]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n");
}

export function turnItemOutputText(item: OrchestrationV2TurnItem): string | null {
  switch (item.type) {
    case "command_execution":
      return item.output?.trim() ? commandOutputText(item.output) || null : null;
    case "dynamic_tool":
      return item.outputOmitted === true
        ? null
        : formatToolValue(item.output, item.viewedImagePath !== undefined);
    case "file_search":
      return item.results?.length
        ? item.results
            .map((result) =>
              [
                `${result.fileName}${result.line === undefined ? "" : `:${result.line}`}`,
                result.preview?.trim(),
              ]
                .filter(Boolean)
                .join("\n"),
            )
            .join("\n")
        : null;
    case "web_search":
      return item.results?.length
        ? item.results
            .map((result) =>
              [
                result.title?.trim() || result.url,
                result.title ? result.url : undefined,
                result.snippet?.trim(),
              ]
                .filter(Boolean)
                .join("\n"),
            )
            .join("\n\n")
        : null;
    default:
      return null;
  }
}

export function turnItemOutputImages(
  item: OrchestrationV2TurnItem,
): ReadonlyArray<Extract<AssetResource, { readonly _tag: "tool-output-image" }>> {
  if (item.type !== "dynamic_tool" || item.outputOmitted === true) return [];
  return toolOutputImages(item.output).map((_, index) => ({
    _tag: "tool-output-image",
    threadId: item.threadId,
    itemId: item.id,
    index,
  }));
}
