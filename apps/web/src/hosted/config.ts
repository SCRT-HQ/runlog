/**
 * What the address this copy is served from says about itself.
 *
 * The app is generic: the same build runs from disk, from GitHub Pages, and
 * from anyone's bucket, and none of those has terms, a privacy policy or an
 * operator. A copy someone runs as a service lays a `hosted.json` beside
 * the shell at publish time (see `hosted/pages/`), and the app
 * reads it: a footer, a terms gate for people signed in, links from the
 * guide's plan badges. Where there is no such file there is nothing to
 * show, and the app is the plain app.
 *
 * Nothing here is trusted for anything but words and links. The file is
 * served from the app's own origin, so it is as trustworthy as the app.
 */

export interface Hosted {
  /** Who runs this copy, in the short form a footer uses. */
  operator: string;
  /** The full legal name, for the one place the app asks someone to agree to something. */
  legalName?: string;
  /** The support address. */
  support: string;
  /** The terms' version; a signed-in person who accepted another is asked again. */
  termsVersion: string;
  /** What was published: the app's version and the commit, for a footer and a bug report. */
  version?: string;
  sha?: string;
  links: {
    terms: string;
    privacy: string;
    pricing?: string;
    publishers?: string;
    about?: string;
    licenses?: string;
    source?: string;
    /** Where people who play talk to each other; the operator's to name. */
    reddit?: string;
    discord?: string;
    /** The operator's own site, for the name in the footer. */
    operator?: string;
    /** The release this build is, and the commit it was made from. */
    release?: string;
    commit?: string;
  };
  features: {
    /** Whether plans, checkout and the billing portal are on. */
    billing: boolean;
    /** Whether the bundled catalog includes the engine-testing pack. */
    testing: boolean;
  };
}

/** Where the file would be: beside the shell, and only over http(s). Nothing on disk. */
function hostedUrl(): string | undefined {
  if (typeof location === "undefined" || !location.protocol.startsWith("http")) return undefined;
  return new URL("./hosted.json", location.href).href;
}

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const link = (v: unknown): v is string => str(v) && /^https?:\/\//.test(v);

/** The file, checked. Anything malformed is treated as no file at all. */
export function parseHosted(raw: unknown): Hosted | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const links = r["links"];
  const features = r["features"];
  if (!str(r["operator"]) || !str(r["support"]) || !str(r["termsVersion"])) return null;
  if (!links || typeof links !== "object") return null;
  const l = links as Record<string, unknown>;
  if (!link(l["terms"]) || !link(l["privacy"])) return null;
  const optional = (name: string) => (link(l[name]) ? { [name]: l[name] as string } : {});
  const f = features && typeof features === "object" ? (features as Record<string, unknown>) : {};
  return {
    operator: r["operator"],
    support: r["support"],
    termsVersion: r["termsVersion"],
    ...(str(r["legalName"]) ? { legalName: r["legalName"] } : {}),
    ...(str(r["version"]) ? { version: r["version"] } : {}),
    ...(str(r["sha"]) ? { sha: r["sha"] } : {}),
    links: {
      terms: l["terms"],
      privacy: l["privacy"],
      ...optional("pricing"),
      ...optional("publishers"),
      ...optional("about"),
      ...optional("licenses"),
      ...optional("source"),
      ...optional("reddit"),
      ...optional("discord"),
      ...optional("operator"),
      ...optional("release"),
      ...optional("commit"),
    },
    features: { billing: f["billing"] === true, testing: f["testing"] === true },
  };
}

/**
 * Fetch the file from beside the shell.
 *
 * Two things make this more careful than a plain fetch. The edge answers a
 * missing file with the app's shell and a 200, so the content type is
 * checked before the body is believed. And the service worker and the
 * browser would both happily keep an old copy, so the request bypasses
 * every cache: the terms version has to be the one just published.
 */
export async function loadHosted(fetchImpl: typeof fetch = fetch, at: string | undefined = hostedUrl()): Promise<Hosted | null> {
  if (!at) return null;
  try {
    const response = await fetchImpl(at, { cache: "no-store" });
    if (!response.ok) return null;
    if (!(response.headers.get("content-type") ?? "").includes("json")) return null;
    return parseHosted(await response.json());
  } catch {
    return null;
  }
}
