/*
 * LeadAnchor website button (C-10). The owner pastes one line on their site:
 *
 *   <script src="https://<leadanchor address>/widget.js" data-business="<their business>" async></script>
 *
 * It adds a "Book / Chat" button that opens the business's request form; what the
 * customer sends lands on the owner's board like a missed call does. Optional:
 *   data-label="Request service"   data-color="#155e63"   data-position="left"
 *   data-action="book"   opens the online booking page instead (C-18)
 *   data-action="chat"   opens the website chat, answered by the chat assistant (C-16)
 * Plain JavaScript in its own shadow root, so the host page's styles can't break it.
 */
(function () {
  var script = document.currentScript;
  if (!script || window.__leadAnchorWidget) return;
  window.__leadAnchorWidget = true;

  var business = script.getAttribute("data-business");
  if (!business || !/^[a-z0-9-]+$/.test(business)) {
    console.warn("LeadAnchor: add data-business=\"your-business\" to the widget script tag.");
    return;
  }

  var origin = new URL(script.src).origin;
  var action = script.getAttribute("data-action");
  var booking = action === "book";
  var chat = action === "chat";
  var formUrl = origin + (booking ? "/b/" : chat ? "/c/" : "/r/") + business + "?src=website";
  var label = script.getAttribute("data-label") || (booking ? "Book online" : chat ? "Chat with us" : "Book / Chat");
  var colorAttr = script.getAttribute("data-color") || "";
  var color = /^#[0-9a-f]{3,8}$/i.test(colorAttr) ? colorAttr : "#155e63";
  var side = script.getAttribute("data-position") === "left" ? "left" : "right";

  var host = document.createElement("div");
  host.setAttribute("data-leadanchor-widget", "");
  var root = host.attachShadow({ mode: "open" });

  var style = document.createElement("style");
  style.textContent =
    ":host{all:initial}" +
    ".button{position:fixed;bottom:20px;" + side + ":20px;z-index:2147483000;display:inline-flex;align-items:center;gap:8px;" +
    "min-height:52px;padding:0 20px;border:0;border-radius:999px;background:" + color + ";color:#fff;" +
    "font:600 16px/1 system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.18);cursor:pointer}" +
    ".button:focus-visible{outline:3px solid #f5b544;outline-offset:3px}" +
    ".button svg{width:20px;height:20px}" +
    ".backdrop{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;" +
    "background:rgba(15,23,42,.45);padding:24px}" +
    ".panel{display:flex;flex-direction:column;width:min(440px,100%);height:min(780px,100%);border-radius:16px;overflow:hidden;" +
    "background:#fbfaf7;box-shadow:0 24px 64px rgba(0,0,0,.3)}" +
    ".bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 6px 6px 16px;" +
    "border-bottom:1px solid #e7e3da;color:#374151;font:600 14px/1 system-ui,-apple-system,'Segoe UI',sans-serif}" +
    ".panel iframe{flex:1;width:100%;border:0}" +
    ".close{width:40px;height:40px;border:0;border-radius:999px;background:transparent;color:#111;" +
    "font:400 24px/1 system-ui,sans-serif;cursor:pointer}" +
    ".close:hover{background:#efece4}" +
    ".close:focus-visible{outline:3px solid #f5b544}";
  root.appendChild(style);

  var button = document.createElement("button");
  button.type = "button";
  button.className = "button";
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (booking
      ? '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM16 3v4M8 3v4M4 11h16M10 16l2 2 3-3"/></svg>'
      : chat
        ? '<path d="M21 14l-3-3h-7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v10M14 15v2a1 1 0 0 1-1 1H6l-3 3V11a1 1 0 0 1 1-1h2"/></svg>'
        : '<path d="M8 9h8M8 13h6M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-5 3v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"/></svg>');
  var text = document.createElement("span");
  text.textContent = label;
  button.appendChild(text);
  root.appendChild(button);

  var backdrop = null;

  function close() {
    if (!backdrop) return;
    backdrop.remove();
    backdrop = null;
    document.removeEventListener("keydown", onKey);
    button.focus();
  }

  function onKey(event) {
    if (event.key === "Escape") close();
  }

  function open() {
    // On phones the form gets the whole screen; elsewhere it opens over the page.
    if (window.matchMedia("(max-width: 640px)").matches) {
      window.open(formUrl, "_blank", "noopener");
      return;
    }
    backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) close();
    });
    var panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", label);
    var frame = document.createElement("iframe");
    frame.src = formUrl;
    frame.title = label;
    frame.allow = "camera";
    var bar = document.createElement("div");
    bar.className = "bar";
    var title = document.createElement("span");
    title.textContent = label;
    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "close";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", close);
    bar.appendChild(title);
    bar.appendChild(closeButton);
    panel.appendChild(bar);
    panel.appendChild(frame);
    backdrop.appendChild(panel);
    root.appendChild(backdrop);
    document.addEventListener("keydown", onKey);
    closeButton.focus();
  }

  button.addEventListener("click", open);

  function mount() {
    document.body.appendChild(host);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
