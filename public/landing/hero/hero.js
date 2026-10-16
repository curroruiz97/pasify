/*
  PASIFY · Hero: vídeos dentro de las letras.

  Cada <video data-src> del bloque [data-hero-videos] solo se descarga y se
  reproduce cuando el hero está a la vista y el vídeo se muestra con el diseño
  actual (en móvil uno de los tres va oculto y no se pide). Con «reducir
  movimiento», con ahorro de datos o en 2G se quedan los pósters.
*/
(function () {
  'use strict';

  function init() {
    var root = document.querySelector('[data-hero-videos]');
    if (!root) return;
    var videos = Array.prototype.slice.call(root.querySelectorAll('video[data-src]'));
    if (!videos.length) return;

    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) return;

    var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
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

    function sync() {
      var allow = inView && !reduce.matches && !document.hidden;
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
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        sync();
      }, { threshold: 0.05 }).observe(root);
    }

    document.addEventListener('visibilitychange', sync);
    if (reduce.addEventListener) reduce.addEventListener('change', sync);
    else if (reduce.addListener) reduce.addListener(sync);

    var t;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(sync, 200);
    });

    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
