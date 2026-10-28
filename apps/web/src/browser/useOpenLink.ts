import { readLocalApi } from "~/localApi";
export async function openExternalLink(
  url: string,
  ..._options: readonly unknown[]
): Promise<void> {
  const api = readLocalApi();
  if (!api) throw new Error("Link opening is unavailable.");
  await api.shell.openExternal(url);
}
