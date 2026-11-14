// @effect-diagnostics nodeBuiltinImport:off -- The audit reads source text without importing application modules.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { arabic } from "./messages";

const sources = Object.fromEntries(
  NodeFS.readdirSync(import.meta.dirname, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".d.ts"))
    .map(
      (file) =>
        [file, NodeFS.readFileSync(NodePath.join(import.meta.dirname, file), "utf8")] as const,
    ),
);

it("provides Arabic for every literal interface translation key", () => {
  const missing: string[] = [];
  for (const [file, source] of Object.entries(sources)) {
    if (file.includes(".test.") || file.endsWith("/messages.ts")) continue;
    for (const match of source.matchAll(/\bt\(\s*("(?:[^"\\]|\\.)*")/g)) {
      const key = JSON.parse(match[1]!) as string;
      if (!Object.hasOwn(arabic, key)) missing.push(`${file}: ${key}`);
    }
  }
  expect(missing).toEqual([]);
});

it("preserves interpolation fields in Arabic messages", () => {
  const placeholders = (text: string) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [key, value] of Object.entries(arabic)) {
    expect(placeholders(value), key).toEqual(placeholders(key));
  }
});
