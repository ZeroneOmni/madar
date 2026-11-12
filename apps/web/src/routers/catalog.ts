import { RouterProfile } from "@madar/contracts";
import * as Schema from "effect/Schema";

const Catalog = Schema.Struct({
  routers: Schema.Array(RouterProfile),
  selected: Schema.NullOr(Schema.String),
});
export type Catalog = typeof Catalog.Type;
export const emptyCatalog: Catalog = { routers: [], selected: null };
export const CATALOG_KEY = "madar:routers";
const decode = Schema.decodeSync(Schema.fromJsonString(Catalog));
export function decodeCatalog(raw: string | null): Catalog {
  if (raw === null) return emptyCatalog;
  const catalog = decode(raw);
  if (
    new Set(catalog.routers.map(({ id }) => id)).size !== catalog.routers.length ||
    (catalog.selected !== null && !catalog.routers.some(({ id }) => id === catalog.selected))
  )
    throw new Error("Invalid router catalog");
  return catalog;
}
export function saveCatalog(storage: Pick<Storage, "setItem">, catalog: Catalog) {
  const serialized = JSON.stringify(catalog);
  decodeCatalog(serialized);
  storage.setItem(CATALOG_KEY, serialized);
}
