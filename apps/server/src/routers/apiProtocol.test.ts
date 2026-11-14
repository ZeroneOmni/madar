import { expect, it } from "vite-plus/test";
import { ApiDecoder, apiAttributes, encodeApiSentence } from "./apiProtocol.ts";

it("decodes fragmented UTF-8 words, embedded zero bytes, equals signs and long fields", () => {
  const words = ["!re", "=comment=أهلا=hello\0world", `=long=${"a".repeat(20000)}`];
  const bytes = encodeApiSentence(words);
  const decoder = new ApiDecoder();
  const result: readonly string[][] = [];
  for (let offset = 0; offset < bytes.length; offset += 127)
    decoder.push(bytes.subarray(offset, offset + 127), (sentence) =>
      (result as string[][]).push([...sentence]),
    );
  expect(result).toEqual([words]);
  expect(apiAttributes(words).comment).toBe("أهلا=hello\0world");
});
it("rejects reserved control bytes and oversized declared words before allocation", () => {
  expect(() => new ApiDecoder().push(Buffer.from([0xf8]), () => {})).toThrow();
  expect(() => new ApiDecoder().push(Buffer.from([0xf0, 255, 255, 255, 255]), () => {})).toThrow();
});
