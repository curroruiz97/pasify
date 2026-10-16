/*
  PASIFY · Hero

  1) Vídeos dentro de las letras. Cada <video data-src> del bloque
     [data-hero-videos] solo se descarga y se reproduce cuando el hero está a la
     vista y el vídeo se muestra. Con «reducir movimiento», con ahorro de datos
     o en 2G se quedan los pósters.

  2) Salida al hacer scroll (html.hero-fx). El hero se queda fijo
     (sticky dentro de [data-hero-track]) mientras:
       · se corta en franjas horizontales que suben con el scroll y se estrechan,
         primero las de abajo (clip-path);
       · «PASIFY» se encoge hacia la cabecera y se desenfoca;
       · el titular, la entradilla y los botones se desvanecen;
       · el fondo WebGL abre sus cintas (PasifyHeroBG.setScroll);
     y la sección siguiente sube por debajo. Sin JS, con «reducir movimiento»,
     sin `overflow: clip` o si el contenido no cabe en la pantalla, la página
     queda como siempre.
*/
(function () {
  'use strict';

  var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var coarse = window.matchMedia ? window.matchMedia('(hover: none), (pointer: coarse)') : { matches: false };
  var heroGone = false; // el hero ya no se ve (scroll): vídeos y WebGL en pausa

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* ---------------------------------------------------------------- vídeos */

  var syncVideos = function () {};

  function initVideos() {
    var root = document.querySelector('[data-hero-videos]');
    if (!root) return;
    var videos = Array.prototype.slice.call(root.querySelectorAll('video[data-src]'));
    if (!videos.length) return;

    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) return;

    var inView = true;

    // H.264 donde exista (Safari, Chrome, Edge…); si no, VP9 (Chromium libre, algunos Linux).
    var probe = document.createElement('video');
    var useWebm = !probe.canPlayType('video/mp4; codecs="avc1.640028"') &&
      !!probe.canPlayType('video/webm; codecs="vp9"');
    function sourceOf(v) {
      return (useWebm && v.getAttribute('data-src-webm')) || v.getAttribute('data-src');
    }

    videos.forEach(function (v) {
      v.muted = true;
      v.defaultMuted = true;
      v.playsInline = true;
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
    });

    function isRendered(v) {
      return v.getClientRects().length > 0;
    }

    syncVideos = function () {
      var allow = inView && !heroGone && !reduce.matches && !document.hidden;
      videos.forEach(function (v) {
        if (allow && isRendered(v)) {
          if (!v.getAttribute('src')) {
            v.preload = 'auto';
            v.src = sourceOf(v);
          }
          if (v.paused) {
            var p = v.play();
            if (p && typeof p.catch === 'function') p.catch(function () {});
          }
        } else if (!v.paused) {
          v.pause();
        }
      });
    };

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        syncVideos();
      }, { threshold: 0.05 }).observe(root);
    }

    document.addEventListener('visibilitychange', function () { syncVideos(); });
    if (reduce.addEventListener) reduce.addEventListener('change', function () { syncVideos(); });
    else if (reduce.addListener) reduce.addListener(function () { syncVideos(); });

    var t;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(function () { syncVideos(); }, 200);
    });

    syncVideos();
  }

  /* ------------------------------------------------------- salida al scroll */

  function initScrollFx() {
    var track = document.querySelector('[data-hero-track]');
    if (!track) return;
    var hero = track.querySelector('.hero');
    var stage = track.querySelector('.hero-stage');
    var mark = track.querySelector('[data-hero-mark]');
    var copy = track.querySelector('[data-hero-copy]');
    var cue = track.querySelector('[data-hero-cue]');
    var videos = Array.prototype.slice.call(track.querySelectorAll('[data-hero-videos] video'));
    var header = document.getElementById('header');
    if (!hero || !stage || !mark || !copy) return;

    var supportsClip = !!(window.CSS && CSS.supports && CSS.supports('overflow', 'clip'));
    var docEl = document.documentElement;
    var on = false;
    var raf = 0;
    var m = { dist: 1, dy: 0, scaleEnd: 0.16, strips: 10 };
    var last = -1;

    function bg() {
      var api = window.PasifyHeroBG;
      return api && api.instances ? api.instances : [];
    }

    // ¿Cabe el contenido del hero en una pantalla? (si no, sin efecto)
    function fits() {
      var head = header ? header.offsetHeight : 80;
      return stage.offsetHeight + head + 24 <= window.innerHeight;
    }

    function measure() {
      var vh = window.innerHeight;
      m.dist = Math.max(1, track.offsetHeight - vh);
      m.strips = window.innerWidth < 720 ? 14 : 10;

      // medidas de «PASIFY» sin transformar, respecto al hero (que va fijo arriba)
      var prev = mark.style.transform;
      mark.style.transform = 'none';
      var r = mark.firstElementChild ? mark.firstElementChild.getBoundingClientRect() : mark.getBoundingClientRect();
      var h = hero.getBoundingClientRect();
      mark.style.transform = prev;

      var head = header ? header.getBoundingClientRect().bottom : 72;
      var goalW = window.innerWidth < 720 ? 132 : 176;           // ancho final, como un logotipo
      m.scaleEnd = clamp(goalW / Math.max(1, r.width), 0.1, 0.6);
      var cy = r.top - h.top + r.height / 2;
      var goalCy = head + 18 + (r.height * m.scaleEnd) / 2;       // justo bajo la cabecera
      m.dy = goalCy - cy;
    }

    function stripsPath(p) {
      var n = m.strips;
      var P = 100 / n;
      var shift = p * 100;                     // suben con el scroll, como si se fueran
      var pts = [];
      for (var k = 0; k < n; k++) {
        var delay = 0.35 * (1 - k / (n - 1));  // las de abajo antes
        var thin = smooth(clamp((p - delay) / 0.45, 0, 1));
        var top = k * P - shift;
        var bot = top + P * (1 - thin);
        if (bot - top < 0.01) continue;
        pts.push('0 ' + top.toFixed(3) + '%', '100% ' + top.toFixed(3) + '%',
          '100% ' + bot.toFixed(3) + '%', '0 ' + bot.toFixed(3) + '%');
      }
      return pts.length ? 'polygon(' + pts.join(',') + ')' : 'polygon(0 0,0 0,0 0)';
    }

    function render() {
      raf = 0;
      if (!on) return;
      var p = clamp((window.pageYOffset || docEl.scrollTop) / m.dist, 0, 1);
      if (p === last) return;
      last = p;
      var blurOk = !coarse.matches;

      // franjas
      hero.style.clipPath = p <= 0 ? '' : stripsPath(p);
      hero.style.webkitClipPath = hero.style.clipPath;

      // «PASIFY»: se encoge hacia la cabecera
      var t = easeInOut(clamp(p / 0.55, 0, 1));
      var s = 1 + (m.scaleEnd - 1) * t;
      var blur = blurOk ? 6 * clamp((p - 0.3) / 0.3, 0, 1) : 0;
      mark.style.transform = 'translate3d(0,' + (m.dy * t).toFixed(2) + 'px,0) scale(' + s.toFixed(4) + ')';
      mark.style.filter = blur > 0.05 ? 'blur(' + blur.toFixed(2) + 'px)' : '';
      mark.style.opacity = (1 - clamp((p - 0.55) / 0.18, 0, 1)).toFixed(3);

      // vídeos: algo de paralaje dentro de las letras. `translate`/`scale` sueltos
      // porque `transform` lo lleva la animación de entrada (y la animación manda).
      var vy = (p * 7).toFixed(2) + '%';
      for (var i = 0; i < videos.length; i++) {
        videos[i].style.translate = '0 ' + vy;
        videos[i].style.scale = '1.16';
      }

      // texto y botones
      var c = smooth(clamp(p / 0.26, 0, 1));
      copy.style.opacity = (1 - c).toFixed(3);
      copy.style.transform = 'translate3d(0,' + (-48 * c).toFixed(2) + 'px,0)';
      copy.style.filter = blurOk && c > 0.01 ? 'blur(' + (5 * c).toFixed(2) + 'px)' : '';
      copy.style.visibility = c >= 1 ? 'hidden' : '';
      if (cue) cue.style.opacity = (1 - clamp(p / 0.08, 0, 1)).toFixed(3);

      // fondo y pausa cuando ya no se ve nada
      var gone = p >= 0.8;
      hero.style.visibility = gone ? 'hidden' : '';
      var list = bg();
      for (var j = 0; j < list.length; j++) {
        if (list[j].setScroll) list[j].setScroll(p);
        if (list[j].setSuspended) list[j].setSuspended(gone);
      }
      if (gone !== heroGone) {
        heroGone = gone;
        syncVideos();
      }
    }

    function schedule() {
      if (!raf) raf = requestAnimationFrame(render);
    }

    function reset() {
      ['clipPath', 'webkitClipPath', 'visibility'].forEach(function (k) { hero.style[k] = ''; });
      [mark, copy, cue].forEach(function (el) {
        if (!el) return;
        el.style.transform = el.style.filter = el.style.opacity = el.style.visibility = '';
      });
      videos.forEach(function (v) { v.style.translate = v.style.scale = ''; });
      bg().forEach(function (b) {
        if (b.setScroll) b.setScroll(0);
        if (b.setSuspended) b.setSuspended(false);
      });
      if (heroGone) { heroGone = false; syncVideos(); }
    }

    function update() {
      var want = !reduce.matches && supportsClip;
      if (want) {
        docEl.classList.add('hero-fx');
        if (!fits()) want = false;
      }
      if (!want) {
        if (on || docEl.classList.contains('hero-fx')) {
          docEl.classList.remove('hero-fx');
          on = false;
          reset();
        }
        return;
      }
      on = true;
      measure();
      last = -1;
      schedule();
    }

    window.addEventListener('scroll', schedule, { passive: true });
    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(update, 150);
    });
    if (reduce.addEventListener) reduce.addEventListener('change', update);
    else if (reduce.addListener) reduce.addListener(update);
    // las fuentes cambian la altura del texto: volver a medir cuando lleguen
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(update);

    update();
  }

  function init() {
    initVideos();
    initScrollFx();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
