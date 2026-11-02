import { ClientSurface, ClientWebDeployment } from "./baseSchemas.ts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { ForwardCompatibleArray, TrimmedNonEmptyString } from "./baseSchemas.ts";

const at = "2026-10-05T00:00:00.000Z";
const Shape = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("circle"), radius: Schema.Number, at: Schema.DateTimeUtc }),
  Schema.Struct({ kind: Schema.Literal("square"), side: Schema.Number }),
]);
const fromWire = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(Schema.toCodecJson(schema) as never) as (value: unknown) => S["Type"];

describe("ForwardCompatibleArray", () => {
  it("decodes elements through their own codec and drops ones it cannot read", () => {
    const decoded = fromWire(ForwardCompatibleArray(Shape))([
      { kind: "circle", radius: 1, at },
      { kind: "triangle" },
      { kind: "square", side: "wide" },
    ]);
    expect(decoded).toHaveLength(1);
    expect(DateTime.isDateTime((decoded[0] as { at: unknown }).at)).toBe(true);
  });

  const Named = ForwardCompatibleArray(Schema.Struct({ name: TrimmedNonEmptyString }));

  it("drops an element it cannot encode instead of failing the array", () => {
    const wire = JSON.parse(
      JSON.stringify(
        Schema.encodeUnknownSync(Schema.toCodecJson(Named))([
          { name: "a" },
          { name: " " },
          { name: "b" },
        ]),
      ),
    );
    expect(wire).toEqual([{ name: "a" }, { name: "b" }]);
    expect(fromWire(Named)(wire)).toEqual([{ name: "a" }, { name: "b" }]);
  });

  it("still drops the null holes a server on an earlier build sends", () => {
    expect(fromWire(Named)([{ name: "a" }, null, { name: "b" }])).toEqual([
      { name: "a" },
      { name: "b" },
    ]);
  });
});

it("rejects retired native-mobile and hosted product surfaces", () => {
  expect(() => Schema.decodeUnknownSync(ClientSurface)("mobile")).toThrow();
  expect(() => Schema.decodeUnknownSync(ClientWebDeployment)("hosted")).toThrow();
});
