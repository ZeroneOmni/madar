import { RouterProfile } from "@madar/contracts";
import * as Schema from "effect/Schema";

const Catalog = Schema.Struct({
  routers: Schema.Array(RouterProfile),
  selected: Schema.NullOr(Schema.String),
  autoConnect: Schema.optionalKey(Schema.Boolean),
});
export type Catalog = typeof Catalog.Type;
export const emptyCatalog: Catalog = { routers: [], selected: null, autoConnect: false };
export const CATALOG_KEY = "madar:routers";
const SavedCatalog = Schema.Struct({
  routers: Schema.Array(
    Schema.Struct({
      ...RouterProfile.fields,
      transport: Schema.Literals(["tls", "tcp", "user-manager-http", "user-manager-https"]),
    }),
  ),
  selected: Schema.NullOr(Schema.String),
  autoConnect: Schema.optionalKey(Schema.Boolean),
});
const decode = Schema.decodeSync(Schema.fromJsonString(SavedCatalog));
export function decodeCatalog(raw: string | null): Catalog {
  if (raw === null) return emptyCatalog;
  const saved = decode(raw);
  const routers = saved.routers.filter(
    (router): router is RouterProfile => router.transport === "tls" || router.transport === "tcp",
  );
  const catalog: Catalog = {
    routers,
    autoConnect: saved.autoConnect === true,
    selected:
      saved.selected !== null &&
      saved.routers.some(
        (router) => router.id === saved.selected && router.transport.startsWith("user-manager-"),
      )
        ? null
        : saved.selected,
  };
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

export function profileForSave(
  profile: RouterProfile,
  previous?: RouterProfile,
  secureProfileId?: string,
) {
  const sameHost =
    previous !== undefined && previous.host.toLowerCase() === profile.host.toLowerCase();
  const sameEndpoint =
    sameHost && previous.port === profile.port && previous.transport === profile.transport;
  if (profile.transport === "tls" && previous?.tlsCertificate && !sameEndpoint && !secureProfileId)
    return null;

  const { tlsCertificate, ...endpoint } = profile;
  const pin = secureProfileId ? tlsCertificate : sameEndpoint ? previous.tlsCertificate : undefined;
  const sameAccount = previous?.username === profile.username;
  const separate = previous && secureProfileId && (!sameEndpoint || !sameAccount);
  const nameQualifier = sameAccount ? "API-SSL" : profile.username;
  return {
    ...endpoint,
    id: separate ? secureProfileId : profile.id,
    name:
      separate && profile.name === previous.name
        ? `${profile.name} (${nameQualifier})`
        : profile.name,
    ...(profile.transport === "tls" && pin ? { tlsCertificate: pin } : {}),
  };
}
