/* Selector v1 / v2 de la web (solo en vistas previas; ver compare/README.md).
 *
 * Lo carga index.html con <script src="/compare-switcher.<hash>.js" defer>. No tiene
 * dependencias y se pinta en un Shadow DOM propio, así que ni los estilos de la
 * app le afectan ni él afecta a la app. La ruta (HashRouter) se conserva al
 * cambiar de versión. Atajo de teclado: Alt+V.
 */
(function () {
  "use strict";
  if (window.__pasifyCompare) return;
  window.__pasifyCompare = true;

  function meta(name) {
    var m = document.querySelector('meta[name="' + name + '"]');
    return (m && m.getAttribute("content")) || "";
  }

  var current = meta("pasify-variant") === "v1" ? "v1" : "v2";
  var sha = meta("pasify-sha");
  var MINI_KEY = "pasify-compare-mini";
  var TITLE = {
    v1: "v1 · antes de los cambios del 11 de octubre" + (current === "v1" && sha ? " (" + sha + ")" : ""),
    v2: "v2 · con los cambios del 11 de octubre" + (current === "v2" && sha ? " (" + sha + ")" : ""),
  };

  function target(v) {
    return (v === "v1" ? "/v1/" : "/") + location.search + location.hash;
  }

  var CSS =
    ":host{all:initial}" +
    ".wrap{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:2147483647;" +
    "touch-action:none;user-select:none;-webkit-user-select:none;" +
    'font:600 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    "@media (max-width:820px){.wrap{bottom:calc(76px + env(safe-area-inset-bottom,0px))}}" +
    ".bar,.chip{background:rgba(18,18,18,.92);box-shadow:0 0 0 1px rgba(255,255,255,.16),0 6px 20px rgba(0,0,0,.4);" +
    "-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}" +
    ".bar{display:flex;align-items:center;gap:2px;padding:3px;border-radius:999px}" +
    ".seg{display:inline-block;min-width:40px;padding:9px 13px;border-radius:999px;color:#d0d0d0;text-align:center;" +
    "text-decoration:none;cursor:pointer}" +
    ".seg:hover{color:#fff}" +
    '.seg[aria-current="true"]{background:#fff;color:#111;cursor:default}' +
    '.seg[aria-disabled="true"]{opacity:.45;cursor:not-allowed}' +
    ".min,.chip{font:inherit;cursor:pointer}" +
    ".min{width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:#a0a0a0}" +
    ".min:hover{color:#fff}" +
    ".chip{display:none;padding:9px 13px;border:0;border-radius:999px;color:#fff}" +
    ".mini .bar{display:none}.mini .chip{display:inline-block}" +
    ".seg:focus-visible,.min:focus-visible,.chip:focus-visible{outline:2px solid #6cb6ff;outline-offset:2px}";

  var host = document.createElement("div");
  host.id = "pasify-compare";
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  root.innerHTML =
    "<style>" + CSS + "</style>" +
    '<div class="wrap">' +
    '<div class="bar" role="group" aria-label="Versión de la web">' +
    '<a class="seg" data-v="v1" href="#" draggable="false">v1</a>' +
    '<a class="seg" data-v="v2" href="#" draggable="false">v2</a>' +
    '<button class="min" type="button" aria-label="Minimizar el selector de versión" title="Minimizar">–</button>' +
    "</div>" +
    '<button class="chip" type="button" aria-label="Mostrar el selector de versión"></button>' +
    "</div>";
  document.body.appendChild(host);

  var wrap = root.querySelector(".wrap");
  var segs = root.querySelectorAll(".seg");
  var chip = root.querySelector(".chip");
  chip.textContent = current;
  chip.title = TITLE[current];

  function refresh() {
    for (var i = 0; i < segs.length; i++) {
      var v = segs[i].getAttribute("data-v");
      segs[i].setAttribute("href", target(v));
      segs[i].title = TITLE[v];
      if (v === current) segs[i].setAttribute("aria-current", "true");
    }
  }
  refresh();
  window.addEventListener("hashchange", refresh);
  window.addEventListener("popstate", refresh);

  function go(v) {
    if (v === current) return;
    var seg = root.querySelector('.seg[data-v="' + v + '"]');
    if (seg && seg.getAttribute("aria-disabled") === "true") return;
    location.assign(target(v));
  }
  for (var i = 0; i < segs.length; i++) {
    segs[i].addEventListener("click", function (e) {
      e.preventDefault();
      go(this.getAttribute("data-v"));
    });
  }

  function setMini(on) {
    wrap.classList.toggle("mini", on);
    try { sessionStorage.setItem(MINI_KEY, on ? "1" : "0"); } catch (e) { /* sin almacenamiento */ }
  }
  root.querySelector(".min").addEventListener("click", function () { setMini(true); });
  chip.addEventListener("click", function () { setMini(false); });
  try { if (sessionStorage.getItem(MINI_KEY) === "1") setMini(true); } catch (e) { /* idem */ }

  // Se puede arrastrar para que no tape lo que se está comparando; la posición
  // se recuerda mientras dure la pestaña.
  var POS_KEY = "pasify-compare-pos";
  var drag = null;
  var moved = false;
  function place(x, y) {
    var r = wrap.getBoundingClientRect();
    x = Math.max(4, Math.min(x, window.innerWidth - r.width - 4));
    y = Math.max(4, Math.min(y, window.innerHeight - r.height - 4));
    wrap.style.left = x + "px";
    wrap.style.top = y + "px";
    wrap.style.bottom = "auto";
  }
  try {
    var saved = JSON.parse(sessionStorage.getItem(POS_KEY) || "null");
    if (saved && typeof saved.x === "number" && typeof saved.y === "number") place(saved.x, saved.y);
  } catch (e) { /* idem */ }
  wrap.addEventListener("pointerdown", function (e) {
    if (e.button) return;
    var r = wrap.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY };
    moved = false;
  });
  window.addEventListener("pointermove", function (e) {
    if (!drag) return;
    if (!moved && Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 8) return;
    moved = true;
    place(e.clientX - drag.dx, e.clientY - drag.dy);
  });
  window.addEventListener("pointerup", function () {
    if (drag && moved) {
      var r = wrap.getBoundingClientRect();
      try { sessionStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: r.top })); } catch (e) { /* idem */ }
    }
    drag = null;
  });
  // El clic con el que termina un arrastre no debe cambiar de versión.
  wrap.addEventListener("click", function (e) {
    if (moved) {
      e.preventDefault();
      e.stopPropagation();
      moved = false;
    }
  }, true);

  document.addEventListener("keydown", function (e) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== "KeyV") return;
    var el = document.activeElement;
    if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
    e.preventDefault();
    go(current === "v1" ? "v2" : "v1");
  });

  // Si este despliegue no tiene v1 (no se construyó), se deja el botón apagado.
  // Un 404 de Vercel responde con index.html, así que se mira la etiqueta de la página.
  if (current === "v2" && window.fetch) {
    fetch("/v1/index.html", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error("sin v1")); })
      .then(function (t) {
        if (!/name="pasify-variant"[^>]*content="v1"/.test(t)) throw new Error("sin v1");
      })
      .catch(function () {
        var seg = root.querySelector('.seg[data-v="v1"]');
        seg.setAttribute("aria-disabled", "true");
        seg.title = "v1 no está disponible en este despliegue";
      });
  }
})();
