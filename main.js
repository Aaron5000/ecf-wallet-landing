/* Keep install links aligned with the visitor's browser. No analytics or network calls. */
(() => {
  "use strict";

  if (!/\bFirefox\//.test(navigator.userAgent)) return;

  const firefoxAddon = "https://addons.mozilla.org/en-US/firefox/addon/metaecf/";
  document.querySelectorAll("a.store").forEach((link) => {
    link.href = firefoxAddon;
    link.setAttribute("aria-label", "Add to Firefox");

    const label = link.querySelector(".store-label");
    if (label) label.textContent = "Add to Firefox";

    const icon = link.querySelector(".chrome");
    if (icon) icon.classList.replace("chrome", "firefox");
  });
})();
