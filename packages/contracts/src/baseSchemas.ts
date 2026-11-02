import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

// Preserve the original string when trimming changes nothing.
const trim = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length === value.length ? value : trimmed;
};

export const TrimmedString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transformEffect({
      decode: (value) => Effect.succeed(trim(value)),
      encode: (value) => Effect.succeed(trim(value)),
    }),
  ),
);
// `make` and encode see untrimmed values; `isNonEmpty` would accept whitespace that encodes to an invalid empty string.
const isNonBlank = Schema.makeFilter((value: string) => value.trim().length > 0, {
  expected: "a non-blank string",
  toJsonSchema: () => [{ minLength: 1 }, true],
  arbitraryConstraint: { minLength: 1 },
});
export const TrimmedNonEmptyString = TrimmedString.check(isNonBlank);

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
export const PortSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

export const DpopFailureReason = Schema.Literals([
  "time_window",
  "key_mismatch",
  "request_mismatch",
  "token_mismatch",
  "replay",
  "invalid_proof",
]);
export type DpopFailureReason = typeof DpopFailureReason.Type;

export const IsoDateTime = Schema.String;
export type IsoDateTime = typeof IsoDateTime.Type;

export const ForwardCompatibleOptional = <Value extends Schema.Top>(value: Value) => {
  const decodeValue = Schema.decodeUnknownOption(value as never);
  return Schema.optionalKey(
    Schema.Unknown.pipe(
      Schema.decodeTo(
        Schema.UndefinedOr(value),
        SchemaTransformation.transform<Value["Encoded"] | undefined, unknown>({
          decode: (raw) =>
            Option.isSome(decodeValue(raw)) ? (raw as Value["Encoded"]) : undefined,
          encode: (raw) => raw,
        }),
      ),
    ),
  );
};

export const ForwardCompatibleArray = <Element extends Schema.Top>(element: Element) =>
  Schema.Array(
    Schema.UndefinedOr(element).pipe(
      Schema.catchDecoding(() => Effect.succeedSome(undefined)),
      Schema.catchEncoding(() => Effect.succeedSome(undefined)),
    ),
  ).pipe(
    Schema.decodeTo(
      Schema.Array(
        Schema.UndefinedOr(Schema.toType(element)).pipe(
          Schema.catchEncoding(() => Effect.succeedSome(undefined)),
        ),
      ).check(
        // Schema.is/make must reject holes; abort before later array checks.
        Schema.makeFilter(
          (values) => {
            // Every index, not `every`, which skips the holes of a sparse array.
            for (let index = 0; index < values.length; index++) {
              if (values[index] === undefined) return false;
            }
            return true;
          },
          { expected: "an array without holes" },
          true,
        ),
      ),
      SchemaTransformation.transform<
        ReadonlyArray<Element["Type"]>,
        ReadonlyArray<Element["Type"] | undefined>
      >({
        decode: (values) => values.filter((value) => value !== undefined),
        encode: (values) => values.filter((value) => value !== undefined),
      }),
    ),
  ) as unknown as ForwardCompatibleArray<Element>;
export type ForwardCompatibleArray<Element extends Schema.Top> = Schema.Codec<
  ReadonlyArray<Element["Type"]>,
  ReadonlyArray<Element["Encoded"]>,
  Element["DecodingServices"],
  Element["EncodingServices"]
>;

const makeEntityId = <Brand extends string>(brand: Parameters<typeof Schema.brand<Brand>>[0]) => {
  return TrimmedNonEmptyString.pipe(Schema.brand<Brand>(brand));
};

export const EnvironmentId = makeEntityId("EnvironmentId");
export type EnvironmentId = typeof EnvironmentId.Type;
export const AuthSessionId = makeEntityId("AuthSessionId");
export type AuthSessionId = typeof AuthSessionId.Type;

export const ClientSurface = Schema.Literals(["web", "desktop", "cli"]);
export type ClientSurface = typeof ClientSurface.Type;

export const ClientWebDeployment = Schema.Literals(["server"]);
export type ClientWebDeployment = typeof ClientWebDeployment.Type;
