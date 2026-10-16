/* ============================================================
   PASIFY · Shared site footer
   Auto-injects the standardized footer into <div id="site-footer"></div>.
   Detects depth (root vs sub-folder) the same way as _header.js.
   ============================================================ */
(function(){
  var SUB_FOLDERS = ['soluciones','operacion','data','sectores','recursos','nosotros'];
  var path = window.location.pathname;
  var inSub = SUB_FOLDERS.some(function(f){ return path.indexOf('/'+f+'/') !== -1; })
           || (document.body && document.body.getAttribute('data-depth') === 'sub');
  var P = inSub ? '../' : '';
  function H(anchor){ return P + 'pasify.html' + (anchor ? '#' + anchor : ''); }

  var css = ''
    + '<style id="pasify-footer-css">'
    +   '.pf-footer{background:var(--bg-2);border-top:1px solid var(--line);padding:80px 0 32px;margin-top:80px;position:relative;z-index:2}'
    +   '.pf-footer .wrap{max-width:1280px;margin:0 auto;padding:0 32px}'
    +   '.pf-footer-grid{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr 1fr;gap:48px;margin-bottom:64px}'
    +   '.pf-footer .col h5{font-family:"Geist Mono",monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-3);margin-bottom:20px;font-weight:500}'
    +   '.pf-footer .col ul{list-style:none;display:flex;flex-direction:column;gap:12px;padding:0;margin:0}'
    +   '.pf-footer .col a{font-size:14px;color:var(--ink-2);transition:color .2s ease;text-decoration:none}'
    +   '.pf-footer .col a:hover{color:var(--accent)}'
    +   '.pf-footer .brand-col .logo{display:inline-block;font-size:36px;margin-bottom:18px;line-height:1}'
    +   '.pf-footer .brand-col .logo img{height:1.55em;width:auto;display:block}'
    +   '.pf-footer .brand-col p{font-size:14px;color:var(--ink-3);line-height:1.55;max-width:32ch}'
    +   '.pf-footer .brand-col .socials{display:flex;gap:8px;margin-top:20px}'
    +   '.pf-footer .brand-col .socials a{width:36px;height:36px;border:1px solid var(--line-2);border-radius:10px;display:grid;place-items:center;color:var(--ink-2);transition:all .2s ease}'
    +   '.pf-footer .brand-col .socials a:hover{border-color:var(--accent);color:var(--accent)}'
    +   '.pf-footer-bottom{padding-top:24px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;font-family:"Geist Mono",monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);flex-wrap:wrap;gap:16px}'
    +   '.pf-footer-bottom .legal{display:flex;gap:24px}'
    +   '.pf-footer-bottom .legal a{color:var(--ink-3);text-decoration:none;transition:color .2s ease}'
    +   '.pf-footer-bottom .legal a:hover{color:var(--accent)}'
    +   '@media (max-width:980px){.pf-footer-grid{grid-template-columns:1.4fr 1fr 1fr;gap:32px}}'
    +   '@media (max-width:720px){.pf-footer-grid{grid-template-columns:1fr 1fr;gap:28px}.pf-footer-bottom{flex-direction:column;align-items:flex-start}.pf-footer-bottom .legal{flex-wrap:wrap;gap:14px}}'
    +   '@media (max-width:520px){.pf-footer{padding:60px 0 24px;margin-top:48px}.pf-footer-grid{grid-template-columns:1fr;margin-bottom:40px}}'
    + '</style>';

  var html = ''
    + '<footer class="pf-footer">'
    +   '<div class="wrap">'
    +     '<div class="pf-footer-grid">'
    +       '<div class="col brand-col">'
    +         '<a href="' + H('') + '" class="logo" aria-label="Pasify">'
    +           '<img src="' + P + 'uploads/pasify-logo.png" alt="Pasify">'
    +         '</a>'
    +         '<p>Entradas y control de acceso para locales y eventos. Hecho en Valladolid.</p>'
    +       '</div>'
    +       '<div class="col">'
    +         '<h5>Soluciones</h5>'
    +         '<ul>'
    +           '<li><a href="' + P + 'soluciones/entradas.html">Venta de entradas</a></li>'
    +           '<li><a href="' + P + 'soluciones/taquilla.html">Venta en taquilla</a></li>'
    +           '<li><a href="' + P + 'soluciones/vip.html">Reservados VIP</a></li>'
    +           '<li><a href="' + P + 'soluciones/invitados.html">Listas de invitados</a></li>'
    +           '<li><a href="' + P + 'soluciones/rrpp.html">Gestión de RRPP</a></li>'
    +           '<li><a href="' + P + 'soluciones/canales.html">Canales de venta</a></li>'
    +         '</ul>'
    +       '</div>'
    +       '<div class="col">'
    +         '<h5>Sectores</h5>'
    +         '<ul>'
    +           '<li><a href="' + P + 'sectores/discotecas.html">Discotecas</a></li>'
    +           '<li><a href="' + P + 'sectores/salas.html">Salas de conciertos</a></li>'
    +           '<li><a href="' + P + 'sectores/beach-clubs.html">Beach Clubs</a></li>'
    +           '<li><a href="' + P + 'sectores/festivales.html">Festivales</a></li>'
    +           '<li><a href="' + P + 'sectores/promotoras.html">Promotoras</a></li>'
    +           '<li><a href="' + P + 'sectores/eventos-privados.html">Eventos privados</a></li>'
    +         '</ul>'
    +       '</div>'
    +       '<div class="col">'
    +         '<h5>Recursos</h5>'
    +         '<ul>'
    +           '<li><a href="' + P + 'recursos/academy.html">Pasify Academy</a></li>'
    +           '<li><a href="' + P + 'recursos/blog.html">Blogs &amp; Newsletter</a></li>'
    +           '<li><a href="' + P + 'recursos/ayuda.html">Centro de ayuda</a></li>'
    +           '<li><a href="' + P + 'recursos/api-docs.html">API e integraciones</a></li>'
    +           '<li><a href="' + P + 'recursos/pro-network.html">Partners &amp; Promotores</a></li>'
    +         '</ul>'
    +       '</div>'
    +       '<div class="col">'
    +         '<h5>Nosotros</h5>'
    +         '<ul>'
    +           '<li><a href="' + P + 'nosotros/sobre.html">Sobre nosotros</a></li>'
    +           '<li><a href="' + P + 'nosotros/seguridad.html">Seguridad y privacidad</a></li>'
    +           '<li><a href="' + P + 'nosotros/contacto.html">Solicitar demo</a></li>'
    +           '<li><a href="' + P + 'nosotros/oficinas.html">Contacto</a></li>'
    +         '</ul>'
    +       '</div>'
    +     '</div>'
    +     '<div class="pf-footer-bottom">'
    +       '<span>© 2026 AVENUE DIGITAL GROUP, S.L. · NIF B70829601 · Plaza Mayor, 23 - 1.º A, 47001 Valladolid</span>'
    +       '<div class="legal">'
    +         '<a href="/privacidad.html" target="_top">Privacidad</a>'
    +         '<a href="mailto:comunicacion@avenuemedia.io">comunicacion@avenuemedia.io</a>'
    +       '</div>'
    +     '</div>'
    +   '</div>'
    + '</footer>';

  var mount = document.getElementById('site-footer');
  if (mount) {
    mount.outerHTML = css + html;
  } else {
    // Fallback: append to body if no mount point exists
    var wrap = document.createElement('div');
    wrap.innerHTML = css + html;
    document.body.appendChild(wrap);
  }
})();
