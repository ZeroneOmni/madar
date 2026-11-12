import { DOMParser, type Document, type Element } from "@xmldom/xmldom";

const elements = (node: Document | Element, tag: string) =>
  Array.from(node.getElementsByTagName(tag));
export function parseUserManagerMessage(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || xml.length > 2_000_000)
    throw new Error("Unsupported User Manager message");
  const document = new DOMParser({
    onError: () => {
      throw new Error("Invalid User Manager XML");
    },
  }).parseFromString(xml, "text/xml");
  if (
    document.documentElement?.tagName !== "server-message" ||
    !document.documentElement.getAttribute("trans-id")
  )
    throw new Error("Invalid User Manager message");
  return document;
}

function buttons(document: Document) {
  const markup = elements(document, "*");
  return elements(document, "message-part")
    .filter((part) => part.getAttribute("processor") === "EchoButton.MessageProcessor")
    .flatMap((part) => elements(part, "init"))
    .flatMap((init) => elements(init, "*").filter((element) => element.hasAttribute("eid")))
    .flatMap((item) => {
      const id = item.getAttribute("eid");
      const element = markup.find((element) => element.getAttribute("id") === id);
      return id && element
        ? [{ id, text: element.textContent?.replace(/\s+/g, " ").trim() ?? "" }]
        : [];
    });
}

function loginControls(document: Document) {
  const inputs = elements(document, "input");
  const password = inputs
    .find((input) => input.getAttribute("type") === "password")
    ?.getAttribute("id");
  const username = inputs
    .find((input) => input.getAttribute("type") === "text" || !input.hasAttribute("type"))
    ?.getAttribute("id");
  const login = buttons(document).find(({ text }) => /^(?:log\s*in|sign\s*in)$/i.test(text))?.id;
  if (!password || !username || !login) return undefined;
  return { username, password, login };
}

export const logoutControl = (document: Document) =>
  buttons(document).find(({ text }) => /^(?:log\s*out|sign\s*out)$/i.test(text))?.id;

export const transactionId = (document: Document) =>
  document.documentElement!.getAttribute("trans-id")!;

export const isLoginMessage = (document: Document) => loginControls(document) !== undefined;
export function isLogoutMessage(document: Document, serviceUrl: string) {
  if (isLoginMessage(document)) return true;
  const service = new URL(serviceUrl);
  return elements(document, "redirect").some((element) => {
    const uri = element.getAttribute("uri");
    if (!uri || !URL.canParse(uri, service.href)) return false;
    const target = new URL(uri, service);
    return target.origin === service.origin && /^\/userman\/?$/.test(target.pathname);
  });
}

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!,
  );

export function loginMessage(document: Document, username: string, password: string) {
  const controls = loginControls(document);
  if (!controls) throw new Error("User Manager login controls unavailable");
  return `<client-message trans-id="${escape(transactionId(document))}"><message-part processor="EchoPropertyUpdate"><property component-id="${escape(controls.username)}" name="text">${escape(username)}</property><property component-id="${escape(controls.password)}" name="text">${escape(password)}</property></message-part><message-part processor="EchoAction"><action component-id="${escape(controls.login)}" name="click"/></message-part></client-message>`;
}

export const initializeMessage =
  '<client-message type="initialize"><message-part processor="EchoClientAnalyzer"><property type="boolean" name="navigatorCookieEnabled" value="true"/><property type="text" name="navigatorAppName" value="Netscape"/><property type="text" name="navigatorUserAgent" value="Madar"/><property type="text" name="navigatorLanguage" value="en"/><property type="integer" name="screenWidth" value="1280"/><property type="integer" name="screenHeight" value="800"/><property type="integer" name="screenColorDepth" value="24"/><property type="integer" name="utcOffset" value="0"/></message-part></client-message>';

export const keepAliveMessage = (id: string) => `<client-message trans-id="${escape(id)}"/>`;
export const logoutMessage = (id: string, button: string) =>
  `<client-message trans-id="${escape(id)}"><message-part processor="EchoAction"><action component-id="${escape(button)}" name="click"/></message-part></client-message>`;

export function synchronizeUrl(html: string, entryUrl: URL) {
  const base = html.match(/EchoClientEngine\.init\(\s*['"]([^'"\r\n]+)['"]/)?.[1];
  if (!base) throw new Error("Not a User Manager customer page");
  const url = new URL(base, entryUrl);
  if (
    url.origin !== entryUrl.origin ||
    !/^\/userman(?:[;/]|$)/.test(url.pathname) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Unsupported User Manager service URL");
  url.searchParams.set("serviceId", "Echo.Synchronize");
  return url.href;
}
