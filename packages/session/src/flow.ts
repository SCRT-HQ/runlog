import { spawn } from "node:child_process";

/** Renew an access token this close to its expiry rather than risk a 401 mid-command. */
const RENEW_MARGIN_MS = 60_000;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export interface Session {
  clientId: string;
  issuer: string;
  accessToken: string;
  refreshToken: string;
  /** When the access token stops working, ISO. */
  expiresAt: string;
}

/** What a token endpoint answers: tokens on success, an `error` code otherwise. */
interface TokenAnswer {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

/** The bits of the world the flow touches, so a test can hand in its own. */
export interface FlowDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  say: (line: string) => void;
  /** Try to open a URL in a browser; a failure is quiet, the code is on screen anyway. */
  open: (url: string) => void;
  now: () => number;
}

export const realDeps: FlowDeps = {
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  say: (line) => console.log(line),
  open: (url) => {
    try {
      const [cmd, args] =
        process.platform === "win32"
          ? ["cmd", ["/c", "start", "", url]]
          : process.platform === "darwin"
            ? ["open", [url]]
            : ["xdg-open", [url]];
      spawn(cmd, args, { detached: true, stdio: "ignore" })
        .on("error", () => {})
        .unref();
    } catch {
      /* no browser here; the link is printed */
    }
  },
  now: () => Date.now(),
};

async function postForm(
  deps: FlowDeps,
  url: string,
  form: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await deps.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
  } catch {
    throw new Error(`WorkOS did not answer as expected (${response.status})`);
  }
}

/** When a JWT says it stops working, or a fallback if it does not say. */
export function expiryOf(accessToken: string, now: number): string {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
    if (typeof payload.exp === "number") return new Date(payload.exp * 1000).toISOString();
  } catch {
    /* not a JWT we can read; assume WorkOS's shortest lifetime */
  }
  return new Date(now + 5 * 60_000).toISOString();
}

/**
 * The device flow, start to finish: ask for a code, show it, poll until the
 * person confirms it in a browser or the code dies. Returns the session.
 */
export async function deviceFlow(clientId: string, issuer: string, deps: FlowDeps = realDeps): Promise<Session> {
  const start = await postForm(deps, `${issuer}/user_management/authorize/device`, { client_id: clientId });
  const s = start.body as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
    error_description?: string;
  };
  if (start.status >= 400 || !s.device_code || !s.user_code || !s.verification_uri) {
    throw new Error(s.error_description ?? `WorkOS would not start a sign-in (${start.status})`);
  }
  deps.say("");
  deps.say(`  Open  ${s.verification_uri}`);
  deps.say(`  Code  ${s.user_code}`);
  deps.say("");
  deps.say("Waiting for you to confirm it there. Ctrl-C gives up.");
  if (s.verification_uri_complete) deps.open(s.verification_uri_complete);

  let interval = Math.max(1, s.interval ?? 5);
  const deadline = deps.now() + (s.expires_in ?? 300) * 1000;
  while (deps.now() < deadline) {
    await deps.sleep(interval * 1000);
    const poll = await postForm(deps, `${issuer}/user_management/authenticate`, {
      grant_type: DEVICE_GRANT,
      device_code: s.device_code,
      client_id: clientId,
    });
    const a = poll.body as TokenAnswer;
    if (a.access_token && a.refresh_token) {
      return {
        clientId,
        issuer,
        accessToken: a.access_token,
        refreshToken: a.refresh_token,
        expiresAt: expiryOf(a.access_token, deps.now()),
      };
    }
    switch (a.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval += 1;
        continue;
      case "access_denied":
        throw new Error("the sign-in was refused in the browser");
      case "expired_token":
        throw new Error("the code expired before it was confirmed; run `runlog login` again");
      default:
        throw new Error(a.error_description ?? a.error ?? `WorkOS answered ${poll.status}`);
    }
  }
  throw new Error("the code expired before it was confirmed; run `runlog login` again");
}

/** A new access token from the refresh token; the refresh token rotates too. */
export async function renew(session: Session, deps: FlowDeps = realDeps): Promise<Session> {
  const answer = await postForm(deps, `${session.issuer}/user_management/authenticate`, {
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    client_id: session.clientId,
  });
  const a = answer.body as TokenAnswer;
  if (!a.access_token || !a.refresh_token) {
    throw new Error("your sign-in has lapsed; run `runlog login` again");
  }
  return { ...session, accessToken: a.access_token, refreshToken: a.refresh_token, expiresAt: expiryOf(a.access_token, deps.now()) };
}

/** Renew this close to expiry rather than risk a 401 mid-press. */
export function needsRenewal(session: Session, now: number): boolean {
  return Date.parse(session.expiresAt) - now < RENEW_MARGIN_MS;
}
