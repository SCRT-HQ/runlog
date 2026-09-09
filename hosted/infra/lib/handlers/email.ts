import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

/**
 * The one email the API sends: an invitation to a session.
 *
 * Plain text and a small HTML twin, no template service, no tracking. The
 * link carries the invite token; the address it goes to was typed by a
 * player who wants this person at their table. Nothing here decides whether
 * the address has an account: the recipient signs in (or up) and the
 * token does the rest.
 *
 * The verified identity lives in a different region from the API, which
 * is why the client is given one explicitly.
 */

export interface Mailer {
  invite(to: string, text: { inviter: string; session: string; pack: string; link: string; role: string }): Promise<void>;
  /** The receipt: the file, the key, and where to open both. */
  purchase(to: string, text: { pack: string; publisher: string; link: string; key: string; ref: string }): Promise<void>;
}

export function sesMailer({ from, region }: { from: string; region: string }): Mailer {
  const ses = new SESv2Client({ region });
  return {
    purchase: (to, text) => sendPurchase(ses, from, to, text),
    async invite(to, { inviter, session, pack, link, role }) {
      const watching = role === "viewer";
      const subject = `${inviter} invited you to ${session}`;
      const plain = [
        `${inviter} has invited you to ${watching ? "watch" : "play"} ${session}, a ${pack} run in Runlog.`,
        "",
        `Open this link to join: ${link}`,
        "",
        "You will be asked to sign in, or to make an account if you have none. The link works for seven days and for one person.",
        "",
        "If you were not expecting this, ignore it; nothing happens unless you open the link.",
        "",
        "This is the only email Runlog sends to an address that has no account: nothing else will follow.",
      ].join("\n");
      const html = `<!doctype html><html><body style="font-family: Georgia, serif; line-height: 1.5; color: #1c1a17; max-width: 34rem; margin: 2rem auto; padding: 0 1rem;">
<p>${esc(inviter)} has invited you to ${watching ? "watch" : "play"} <strong>${esc(session)}</strong>, a ${esc(pack)} run in Runlog.</p>
<p><a href="${esc(link)}" style="display: inline-block; padding: 0.6rem 1rem; background: #3d7a5b; color: #fff; text-decoration: none; border-radius: 6px;">Join the run</a></p>
<p style="color: #4a453e; font-size: 0.9em;">You will be asked to sign in, or to make an account if you have none. The link works for seven days and for one person.</p>
<p style="color: #4a453e; font-size: 0.9em;">If you were not expecting this, ignore it; nothing happens unless you open the link.</p>
<p style="color: #4a453e; font-size: 0.8em;">This is the only email Runlog sends to an address that has no account: nothing else will follow.</p>
</body></html>`;
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [to] },
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: "UTF-8" },
              Body: { Text: { Data: plain, Charset: "UTF-8" }, Html: { Data: html, Charset: "UTF-8" } },
            },
          },
        }),
      );
    },
  };
}

async function sendPurchase(ses: SESv2Client, from: string, to: string, { pack, publisher, link, key, ref }: { pack: string; publisher: string; link: string; key: string; ref: string }) {
  const subject = `Your copy of ${pack}`;
  const plain = [
    `Thank you for buying ${pack} from ${publisher}.`,
    "",
    `Open it in Runlog: ${link}`,
    "",
    `Your license key: ${key}`,
    "",
    "The link fetches your sealed copy and the key opens it; sign in first and the key is kept in your account, so the same copy opens on your other devices. Keep this mail: it is your receipt, and the key is yours alone.",
    "",
    `Reference ${ref}. Questions about the pack go to ${publisher}; the sale is between you and them.`,
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family: Georgia, serif; line-height: 1.5; color: #1c1a17; max-width: 34rem; margin: 2rem auto; padding: 0 1rem;">
<p>Thank you for buying <strong>${esc(pack)}</strong> from ${esc(publisher)}.</p>
<p><a href="${esc(link)}" style="display: inline-block; padding: 0.6rem 1rem; background: #3d7a5b; color: #fff; text-decoration: none; border-radius: 6px;">Open it in Runlog</a></p>
<p>Your license key:<br /><code style="font-size: 1.1em; letter-spacing: 0.08em;">${esc(key)}</code></p>
<p style="color: #4a453e; font-size: 0.9em;">The link fetches your sealed copy and the key opens it; sign in first and the key is kept in your account, so the same copy opens on your other devices. Keep this mail: it is your receipt, and the key is yours alone.</p>
<p style="color: #4a453e; font-size: 0.8em;">Reference ${esc(ref)}. Questions about the pack go to ${esc(publisher)}; the sale is between you and them.</p>
</body></html>`;
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      Content: { Simple: { Subject: { Data: subject, Charset: "UTF-8" }, Body: { Text: { Data: plain, Charset: "UTF-8" }, Html: { Data: html, Charset: "UTF-8" } } } },
    }),
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
