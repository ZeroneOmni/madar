import * as Schema from "effect/Schema";
import {
  VoucherCatalog,
  VoucherPage,
  VoucherDetails,
  VoucherOperation,
  type RouterProfile,
  type VoucherQuery,
  type VoucherScope,
  type VoucherTarget,
  type VoucherMutation,
} from "@madar/contracts";
import { routerRequest } from "../routers/access";

const messages: Record<string, string> = {
  disconnected: "Connect to the router to continue.",
  authentication: "The router rejected the login. Reconnect in Connections.",
  tls: "The API-SSL certificate could not be verified. Check the hostname and certificate.",
  network: "The router connection was interrupted. Cached vouchers are still available.",
  timeout: "The router did not respond in time. Cached vouchers are still available.",
  permission: "The router account does not have permission for this operation.",
  unsupported: "This User Manager operation is unavailable on this RouterOS installation.",
  protocol: "The router returned an unexpected response. Refresh before continuing.",
  rejected: "The router rejected the operation. Check the voucher fields and profile.",
  storage: "Madar could not update its local database. Check available disk space.",
  "not-found": "The customer, profile or voucher was not found. Refresh and try again.",
  conflict:
    "A voucher with this username already exists, or the operation identifier is already in use.",
  busy: "Another operation is in progress. Try again when it finishes.",
};
async function call<A>(
  name: string,
  payload: unknown,
  schema: Schema.Codec<A, unknown>,
  signal?: AbortSignal,
): Promise<A> {
  const response = await routerRequest(`/api/vouchers/${name}`, payload, signal);
  const body: unknown = await response.json();
  if (!response.ok) {
    const reason =
      typeof body === "object" &&
      body !== null &&
      "reason" in body &&
      typeof body.reason === "string"
        ? body.reason
        : "";
    throw new Error(
      messages[reason] ?? "Madar could not complete the request. Check the app connection.",
    );
  }
  return Schema.decodeUnknownSync(schema)(body);
}
export const voucherClient = {
  catalog: (router: RouterProfile, refresh: boolean, signal?: AbortSignal) =>
    call("catalog", { router, refresh }, VoucherCatalog, signal),
  list: (query: VoucherQuery, signal?: AbortSignal) => call("list", query, VoucherPage, signal),
  sync: (scope: VoucherScope, signal?: AbortSignal) => call("sync", scope, VoucherCatalog, signal),
  details: (target: VoucherTarget) => call("details", target, VoucherDetails),
  mutate: (input: VoucherMutation) => call("mutate", input, VoucherOperation),
  history: (scope: VoucherScope) => call("history", scope, Schema.Array(VoucherOperation)),
};
export function voucherError(error: unknown) {
  return error instanceof Error && Object.values(messages).includes(error.message)
    ? error.message
    : "Madar could not complete the request. Check the app connection.";
}

export function downloadCsv(name: string, rows: readonly (readonly string[])[]) {
  const text = rows
    .map((row) =>
      row
        .map((cell) => `"${(/^[=+@\-\t\r]/.test(cell) ? "'" : "") + cell.replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function randomCode(length = 10) {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return [...values].map((value) => alphabet[value % alphabet.length]).join("");
}
