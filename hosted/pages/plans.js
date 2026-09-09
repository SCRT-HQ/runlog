// The pricing page asks the API which tiers are on sale today, since a
// tier can be held back by a flag rather than by a deploy, and the words
// on this page are written at publish time. Nothing here is needed for
// the page to read: without an answer, the static words stand.
(function () {
  var servers = document.getElementById("plan-servers-note");
  var publisher = document.getElementById("plan-publisher-note");
  if (!servers && !publisher) return;
  fetch("/api/plans", { cache: "no-store" })
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (plans) {
      if (!plans) return;
      if (servers && plans.serversOpen === true) servers.textContent = "On sale. Claim a server from your profile, under Servers, and subscribe there.";
      if (publisher && plans.publishersOpen === false) publisher.textContent = "Coming soon. Becoming a publisher, and hosted licensing, open with the catalog's next step.";
    })
    .catch(function () {
      /* the static words stand */
    });
})();
