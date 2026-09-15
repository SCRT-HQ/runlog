/**
 * The account block every inspector carries: the address, sign in, sign out,
 * reconnect, and the device flow's code while one is running.
 *
 * A script rather than an HTML fragment because a property inspector page is
 * loaded straight from disk with no build step and no include - so the block
 * has one home here and each page is one line.
 *
 * Drop `<div id="runlog-account"></div>` on the page, then load this after
 * sdpi-components.js.
 *
 * That script sits beside this one - sdpi-components v4.0.1, downloaded
 * from https://sdpi-components.dev/releases/v4/sdpi-components.js and
 * shipped in the plugin, because an inspector that fetches its own
 * components off the internet has no sign-in button when the internet is
 * not there. Replace it by downloading the next release over it.
 */
(() => {
  const mount = document.getElementById("runlog-account");
  if (!mount) return;
  const { streamDeckClient } = SDPIComponents;

  mount.innerHTML = `
    <sdpi-item label="Runlog address">
      <sdpi-textfield setting="apiBase" global placeholder="https://runlog.scrthq.com"></sdpi-textfield>
    </sdpi-item>
    <sdpi-item label="Account">
      <sdpi-button id="runlog-signin">Sign in</sdpi-button>
      <sdpi-button id="runlog-signout">Sign out</sdpi-button>
      <sdpi-button id="runlog-reconnect">Reconnect</sdpi-button>
    </sdpi-item>
    <sdpi-item label="Status"><span id="runlog-who">Loading…</span></sdpi-item>
    <div id="runlog-code-row" style="display: none">
      <sdpi-item label="Your code">
        <strong id="runlog-code"></strong>
        <a id="runlog-link" target="_blank" rel="noreferrer">Open the sign-in page</a>
      </sdpi-item>
    </div>`;

  const el = (id) => document.getElementById(id);
  const send = (payload) => streamDeckClient.send("sendToPlugin", payload);

  el("runlog-signin").addEventListener("click", () => {
    el("runlog-who").textContent = "Signing in…";
    send({ t: "signin" });
  });
  el("runlog-signout").addEventListener("click", () => send({ t: "signout" }));
  el("runlog-reconnect").addEventListener("click", () => send({ t: "reconnect" }));

  streamDeckClient.sendToPropertyInspector.subscribe(({ payload }) => {
    if (!payload) return;
    if (payload.t === "code") {
      el("runlog-code-row").style.display = "";
      el("runlog-code").textContent = payload.code;
      // The link comes off a socket; only an http(s) one is worth opening.
      el("runlog-link").href = /^https?:\/\//.test(payload.url ?? "") ? payload.url : "";
    }
    if (payload.t === "who") {
      el("runlog-code-row").style.display = "none";
      const signedIn = payload.signedIn ? "Signed in" : "Not signed in";
      // A sign-in that failed says why, and keeps saying it until the next
      // time the plugin reports who is signed in.
      el("runlog-who").textContent = payload.error ? `${signedIn}: ${payload.error}` : signedIn;
    }
  });
})();
