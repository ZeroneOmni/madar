import { expect, it } from "vite-plus/test";
import indexHtml from "../index.html?raw";

const script = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error("Missing appearance boot script");

it.each([
  ["ar", ["en-US"], "ar", "rtl"],
  ["en", ["ar-KW"], "en", "ltr"],
  [null, ["ar-KW"], "ar", "rtl"],
  ["invalid", ["fr", "en-GB"], "en", "ltr"],
] as const)("sets language %s before rendering", (saved, languages, lang, dir) => {
  const documentElement = { lang: "", dir: "", classList: { toggle: () => {} }, style: {} };
  new Function("window", "document", script)(
    {
      localStorage: { getItem: (key: string) => (key === "madar:language" ? saved : null) },
      navigator: { languages },
      matchMedia: () => ({ matches: false }),
    },
    { documentElement, querySelector: () => ({ setAttribute: () => {} }) },
  );
  expect(documentElement.lang).toBe(lang);
  expect(documentElement.dir).toBe(dir);
});

it.each([
  ["light", true, false],
  ["dark", false, true],
  ["system", true, true],
  [null, false, false],
  ["unknown", true, true],
] as const)("boots %s with system dark %s", (stored, prefersDark, expectedDark) => {
  let dark = false;
  let metaColor = "";
  const documentElement = {
    classList: {
      toggle: (_name: string, value: boolean) => {
        dark = value;
      },
    },
    style: { colorScheme: "" },
  };
  new Function("window", "document", script)(
    { localStorage: { getItem: () => stored }, matchMedia: () => ({ matches: prefersDark }) },
    {
      documentElement,
      querySelector: () => ({
        setAttribute: (_name: string, value: string) => {
          metaColor = value;
        },
      }),
    },
  );
  expect(dark).toBe(expectedDark);
  expect(documentElement.style.colorScheme).toBe(expectedDark ? "dark" : "light");
  expect(metaColor).toBe(expectedDark ? "#0a0a0a" : "#ffffff");
});

it("uses system appearance when storage is blocked", () => {
  let dark = false;
  new Function("window", "document", script)(
    {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      matchMedia: () => ({ matches: true }),
    },
    {
      documentElement: {
        classList: {
          toggle: (_name: string, value: boolean) => {
            dark = value;
          },
        },
        style: {},
      },
      querySelector: () => ({ setAttribute: () => {} }),
    },
  );
  expect(dark).toBe(true);
});
