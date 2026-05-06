/* ============================================================
   PASIFY · Shared site header + megamenu
   Auto-injects identical header into <div id="site-header"></div>.
   - Detects depth (root vs sub-folder) via document.body[data-depth]
     or pathname containing one of: soluciones/ operacion/ data/
     sectores/ recursos/ nosotros/.
   - All hrefs are root-relative-via-prefix:
       P  = '' on root page,           '../' on any sub-folder.
   - Highlight active item via <body data-current="<slug>">.
   ============================================================ */
(function(){
  var SUB_FOLDERS = ['soluciones','operacion','data','sectores','recursos','nosotros'];
  var path = window.location.pathname;
  var inSub = SUB_FOLDERS.some(function(f){ return path.indexOf('/'+f+'/') !== -1; })
           || document.body.getAttribute('data-depth') === 'sub';
  var P = inSub ? '../' : '';

  // Helper to build a URL prefix to a known folder.
  function L(folder, file){ return P + folder + '/' + file; }
  // Home anchor link
  function H(anchor){ return P + 'pasify.html' + (anchor ? '#' + anchor : ''); }

  var html = ''
    + '<header class="header" id="header">'
    +   '<div class="header-inner">'
    +     '<a href="' + H('') + '" class="logo" aria-label="Pasify">'
    +       '<span>Pas</span><span class="dot" aria-hidden="true"></span><span>if</span><span class="y">y</span>'
    +     '</a>'
    +     '<nav class="nav" id="nav">'
    +       '<div class="nav-item" data-menu="soluciones">'
    +         '<button class="nav-trigger" type="button" data-key="soluciones">Soluciones <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
    +       '</div>'
    +       '<div class="nav-item" data-menu="sectores">'
    +         '<button class="nav-trigger" type="button" data-key="sectores">Sectores <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
    +       '</div>'
    +       '<div class="nav-item" data-menu="recursos">'
    +         '<button class="nav-trigger" type="button" data-key="recursos">Recursos <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
    +       '</div>'
    +       '<div class="nav-item" data-menu="nosotros">'
    +         '<button class="nav-trigger" type="button" data-key="nosotros">Nosotros <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
    +       '</div>'
    +       '<a href="' + H('precios') + '" class="nav-trigger" style="text-decoration:none">Pricing</a>'
    +     '</nav>'
    +     '<span class="spacer"></span>'
    +     '<a href="' + H('contacto') + '" class="login">Entrar</a>'
    +     '<a href="' + H('contacto') + '" class="cta">Solicita demo →</a>'
    +     '<button class="burger" id="burger" aria-label="Menú"><span></span></button>'
    +   '</div>'

    +   '<div class="mega-wrap" id="mega-wrap">'

    // ============== SOLUCIONES PANEL ==============
    +     '<div class="mega" data-panel="soluciones" hidden>'
    +       '<div class="mega-grid">'
    +         '<div class="mega-col">'
    +           '<h6>Gestión de venta</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" data-slug="entradas" href="' + L('soluciones','entradas.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 9a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z"/><path d="M2 12h20"/></svg></span>Venta de entradas</a></li>'
    +             '<li><a class="mega-link" data-slug="taquilla" href="' + L('soluciones','taquilla.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 13h6"/></svg></span>Venta en taquilla</a></li>'
    +             '<li><a class="mega-link" data-slug="vip" href="' + L('soluciones','vip.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.5 5 5.5.8-4 3.9.9 5.5L12 14.6 7.1 17.2 8 11.7 4 7.8l5.5-.8z"/></svg></span>Reservados VIP</a></li>'
    +             '<li><a class="mega-link" data-slug="invitados" href="' + L('soluciones','invitados.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h4v16h-4M4 4h4v16H4M8 12h8"/></svg></span>Listas de invitados</a></li>'
    +             '<li><a class="mega-link" data-slug="rrpp" href="' + L('soluciones','rrpp.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 11l2 2 4-4"/></svg></span>Gestión de RRPP</a></li>'
    +             '<li><a class="mega-link" data-slug="canales" href="' + L('soluciones','canales.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg></span>Canales de venta</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-col">'
    +           '<h6>Operación</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" data-slug="control-acceso" href="' + L('operacion','control-acceso.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M21 21v-7M17 17h4"/></svg></span>Control de acceso QR <span class="pill">Hot</span></a></li>'
    +             '<li><a class="mega-link" data-slug="tpv" href="' + L('operacion','tpv.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/></svg></span>Software TPV</a></li>'
    +             '<li><a class="mega-link" data-slug="recepcion" href="' + L('operacion','recepcion.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>Recepción de eventos</a></li>'
    +             '<li><a class="mega-link" data-slug="soporte" href="' + L('operacion','soporte.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg></span>Soporte personalizado</a></li>'
    +             '<li><a class="mega-link" data-slug="pases-temporada" href="' + L('operacion','pases-temporada.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg></span>Pases de temporada</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-col">'
    +           '<h6>Data &amp; Marketing</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" data-slug="crm" href="' + L('data','crm.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12a9 9 0 0 0 9 9V12z" fill="currentColor"/></svg></span>CRM &amp; Real time data</a></li>'
    +             '<li><a class="mega-link" data-slug="marketing" href="' + L('data','marketing.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18M7 14l4-4 4 4 5-6"/></svg></span>Marketing digital</a></li>'
    +             '<li><a class="mega-link" data-slug="informes" href="' + L('data','informes.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 14h6M9 18h4"/></svg></span>Informes de eventos</a></li>'
    +             '<li><a class="mega-link" data-slug="api" href="' + L('data','api.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2M9 12l2 2 4-4"/></svg></span>API &amp; Integraciones</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-feature">'
    +           '<span class="lab">Novedad 2026</span>'
    +           '<h5>Pasify Live: aforo en tiempo real</h5>'
    +           '<p>Mide entradas, salidas y consumo medio por zona desde una sola pantalla. Decide subidas de precio sin parar la fiesta.</p>'
    +           '<a href="' + H('producto') + '">Descubrir →</a>'
    +         '</div>'
    +       '</div>'
    +     '</div>'

    // ============== SECTORES PANEL ==============
    +     '<div class="mega" data-panel="sectores" hidden>'
    +       '<div class="mega-grid">'
    +         '<div class="mega-col">'
    +           '<h6>Por tipo de negocio</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" data-slug="sec-discotecas" href="' + L('sectores','discotecas.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg></span>Discotecas</a></li>'
    +             '<li><a class="mega-link" data-slug="sec-salas" href="' + L('sectores','salas.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6"/></svg></span>Salas de conciertos</a></li>'
    +             '<li><a class="mega-link" data-slug="sec-beach" href="' + L('sectores','beach-clubs.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4M2 18h20M8 14V6a4 4 0 0 1 8 0v8"/></svg></span>Beach Clubs</a></li>'
    +             '<li><a class="mega-link" data-slug="sec-festivales" href="' + L('sectores','festivales.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21l9-18 9 18M3 21h18M9 14h6"/></svg></span>Festivales</a></li>'
    +             '<li><a class="mega-link" data-slug="sec-promotoras" href="' + L('sectores','promotoras.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></span>Promotoras</a></li>'
    +             '<li><a class="mega-link" data-slug="sec-privados" href="' + L('sectores','eventos-privados.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-6 9 6v12H3z"/><path d="M9 21v-7h6v7"/></svg></span>Eventos privados</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-col">'
    +           '<h6>Casos de uso</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" href="' + H('casos') + '">Apertura de temporada</a></li>'
    +             '<li><a class="mega-link" href="' + H('casos') + '">Festival multi-escenario</a></li>'
    +             '<li><a class="mega-link" href="' + H('casos') + '">Reapertura post-reforma</a></li>'
    +             '<li><a class="mega-link" href="' + H('casos') + '">Tour internacional</a></li>'
    +             '<li><a class="mega-link" href="' + H('casos') + '">White label para promotor</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-col">'
    +           '<h6>Tamaño</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" href="' + H('precios') + '">Sala &lt; 500 personas</a></li>'
    +             '<li><a class="mega-link" href="' + H('precios') + '">Sala 500–2.000</a></li>'
    +             '<li><a class="mega-link" href="' + H('precios') + '">Festival &gt; 5.000</a></li>'
    +             '<li><a class="mega-link" href="' + H('precios') + '">Cadena multi-local</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-feature">'
    +           '<span class="lab">Caso destacado</span>'
    +           '<h5>Sonora Festival → +34% ventas online</h5>'
    +           '<p>Cómo un festival de 18.000 asistentes pasó de 3 plataformas a Pasify y redujo el check-in 70%.</p>'
    +           '<a href="' + H('casos') + '">Leer caso →</a>'
    +         '</div>'
    +       '</div>'
    +     '</div>'

    // ============== RECURSOS PANEL ==============
    +     '<div class="mega" data-panel="recursos" hidden>'
    +       '<div class="mega-grid">'
    +         '<div class="mega-col">'
    +           '<h6>Aprende</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" data-slug="academy" href="' + L('recursos','academy.html') + '">Pasify Academy</a></li>'
    +             '<li><a class="mega-link" data-slug="blog" href="' + L('recursos','blog.html') + '">Blog &amp; tendencias</a></li>'
    +             '<li><a class="mega-link" data-slug="guias" href="' + L('recursos','guias.html') + '">Guías para promotores</a></li>'
    +             '<li><a class="mega-link" data-slug="webinars" href="' + L('recursos','webinars.html') + '">Webinars &amp; eventos</a></li>'
    +             '<li><a class="mega-link" data-slug="newsletter" href="' + L('recursos','newsletter.html') + '">Newsletter mensual</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-col">'
    +           '<h6>Producto</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" data-slug="changelog" href="' + L('recursos','changelog.html') + '">Changelog <span class="pill">v4.2</span></a></li>'
    +             '<li><a class="mega-link" data-slug="ayuda" href="' + L('recursos','ayuda.html') + '">Centro de ayuda</a></li>'
    +             '<li><a class="mega-link" data-slug="api-docs" href="' + L('recursos','api-docs.html') + '">Documentación API</a></li>'
    +             '<li><a class="mega-link" data-slug="status" href="' + L('recursos','status.html') + '">Estado del sistema</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-col">'
    +           '<h6>Comunidad</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" data-slug="pro-network" href="' + L('recursos','pro-network.html') + '">Pasify Pro Network</a></li>'
    +             '<li><a class="mega-link" data-slug="partners" href="' + L('recursos','partners.html') + '">Programa de partners</a></li>'
    +             '<li><a class="mega-link" data-slug="fbd" href="' + L('recursos','fbd.html') + '">Fun Business Days</a></li>'
    +             '<li><a class="mega-link" data-slug="embajadores" href="' + L('recursos','embajadores.html') + '">Embajadores RRPP</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-feature">'
    +           '<span class="lab">Recurso gratuito</span>'
    +           '<h5>El estado del nightlife 2026</h5>'
    +           '<p>Informe con datos de +12.000 eventos: ticket medio, hora pico, géneros que crecen y por qué.</p>'
    +           '<a href="' + L('recursos','blog.html') + '">Descargar PDF →</a>'
    +         '</div>'
    +       '</div>'
    +     '</div>'

    // ============== NOSOTROS PANEL ==============
    +     '<div class="mega" data-panel="nosotros" hidden>'
    +       '<div class="mega-grid">'
    +         '<div class="mega-col">'
    +           '<h6>Pasify</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" data-slug="sobre" href="' + L('nosotros','sobre.html') + '">Sobre nosotros</a></li>'
    +             '<li><a class="mega-link" data-slug="manifesto" href="' + L('nosotros','manifesto.html') + '">Manifesto</a></li>'
    +             '<li><a class="mega-link" data-slug="equipo" href="' + L('nosotros','equipo.html') + '">Equipo</a></li>'
    +             '<li><a class="mega-link" data-slug="cultura" href="' + L('nosotros','cultura.html') + '">Cultura &amp; carrera</a></li>'
    +             '<li><a class="mega-link" data-slug="prensa" href="' + L('nosotros','prensa.html') + '">Prensa &amp; medios</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-col">'
    +           '<h6>Compromiso</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" data-slug="privacidad" href="' + L('nosotros','privacidad.html') + '">Privacidad de datos</a></li>'
    +             '<li><a class="mega-link" data-slug="seguridad" href="' + L('nosotros','seguridad.html') + '">Seguridad</a></li>'
    +             '<li><a class="mega-link" data-slug="sostenibilidad" href="' + L('nosotros','sostenibilidad.html') + '">Sostenibilidad</a></li>'
    +             '<li><a class="mega-link" data-slug="diversidad" href="' + L('nosotros','diversidad.html') + '">Diversidad</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-col">'
    +           '<h6>Contacto</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" data-slug="contacto-page" href="' + L('nosotros','contacto.html') + '">Solicitar demo</a></li>'
    +             '<li><a class="mega-link" data-slug="ventas" href="' + L('nosotros','ventas.html') + '">Hablar con ventas</a></li>'
    +             '<li><a class="mega-link" data-slug="soporte-page" href="' + L('nosotros','soporte.html') + '">Soporte 24/7</a></li>'
    +             '<li><a class="mega-link" data-slug="oficinas" href="' + L('nosotros','oficinas.html') + '">Oficinas</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-feature">'
    +           '<span class="lab">Estamos contratando</span>'
    +           '<h5>+12 posiciones abiertas</h5>'
    +           '<p>Diseño, ingeniería, ventas y soporte. Construye el sistema operativo del nightlife con nosotros.</p>'
    +           '<a href="' + L('nosotros','cultura.html') + '">Ver vacantes →</a>'
    +         '</div>'
    +       '</div>'
    +     '</div>'
    +   '</div>'
    + '</header>'

    // ============== MOBILE DRAWER ==============
    + '<aside class="mobile-drawer" id="mobile-drawer" aria-hidden="true">'
    +   '<details>'
    +     '<summary>Soluciones</summary>'
    +     '<div class="sub">'
    +       '<a href="' + L('soluciones','entradas.html') + '">Venta de entradas</a>'
    +       '<a href="' + L('soluciones','taquilla.html') + '">Venta en taquilla</a>'
    +       '<a href="' + L('soluciones','vip.html') + '">Reservados VIP</a>'
    +       '<a href="' + L('soluciones','invitados.html') + '">Listas de invitados</a>'
    +       '<a href="' + L('soluciones','rrpp.html') + '">Gestión de RRPP</a>'
    +       '<a href="' + L('soluciones','canales.html') + '">Canales de venta</a>'
    +       '<a href="' + L('operacion','control-acceso.html') + '">Control de acceso QR</a>'
    +       '<a href="' + L('operacion','tpv.html') + '">Software TPV</a>'
    +       '<a href="' + L('data','crm.html') + '">CRM &amp; Real time data</a>'
    +       '<a href="' + L('data','api.html') + '">API &amp; Integraciones</a>'
    +     '</div>'
    +   '</details>'
    +   '<details>'
    +     '<summary>Sectores</summary>'
    +     '<div class="sub">'
    +       '<a href="' + L('sectores','discotecas.html') + '">Discotecas</a>'
    +       '<a href="' + L('sectores','salas.html') + '">Salas de conciertos</a>'
    +       '<a href="' + L('sectores','beach-clubs.html') + '">Beach Clubs</a>'
    +       '<a href="' + L('sectores','festivales.html') + '">Festivales</a>'
    +       '<a href="' + L('sectores','promotoras.html') + '">Promotoras</a>'
    +       '<a href="' + L('sectores','eventos-privados.html') + '">Eventos privados</a>'
    +     '</div>'
    +   '</details>'
    +   '<details>'
    +     '<summary>Recursos</summary>'
    +     '<div class="sub">'
    +       '<a href="' + L('recursos','academy.html') + '">Pasify Academy</a>'
    +       '<a href="' + L('recursos','blog.html') + '">Blog</a>'
    +       '<a href="' + L('recursos','ayuda.html') + '">Centro de ayuda</a>'
    +       '<a href="' + L('recursos','api-docs.html') + '">API Docs</a>'
    +       '<a href="' + L('recursos','changelog.html') + '">Changelog</a>'
    +       '<a href="' + L('recursos','partners.html') + '">Partners</a>'
    +     '</div>'
    +   '</details>'
    +   '<details>'
    +     '<summary>Nosotros</summary>'
    +     '<div class="sub">'
    +       '<a href="' + L('nosotros','sobre.html') + '">Sobre Pasify</a>'
    +       '<a href="' + L('nosotros','equipo.html') + '">Equipo</a>'
    +       '<a href="' + L('nosotros','cultura.html') + '">Cultura &amp; carrera</a>'
    +       '<a href="' + L('nosotros','prensa.html') + '">Prensa</a>'
    +       '<a href="' + L('nosotros','contacto.html') + '">Contacto</a>'
    +     '</div>'
    +   '</details>'
    +   '<a href="' + H('precios') + '" style="padding:18px 4px;font-size:18px;font-weight:500;border-bottom:1px solid var(--line);color:var(--ink)">Pricing</a>'
    +   '<div class="ctas">'
    +     '<a href="' + H('contacto') + '" class="btn btn-ghost" style="justify-content:center">Entrar</a>'
    +     '<a href="' + H('contacto') + '" class="btn btn-primary" style="justify-content:center">Solicita demo →</a>'
    +   '</div>'
    + '</aside>';

  // Map sub-page slug → which top-level menu trigger should be highlighted
  var SLUG_TO_MENU = {
    entradas:'soluciones', taquilla:'soluciones', vip:'soluciones',
    invitados:'soluciones', rrpp:'soluciones', canales:'soluciones',
    'control-acceso':'soluciones', tpv:'soluciones', recepcion:'soluciones',
    soporte:'soluciones', 'pases-temporada':'soluciones',
    crm:'soluciones', marketing:'soluciones', informes:'soluciones', api:'soluciones',
    'sec-discotecas':'sectores','sec-salas':'sectores','sec-beach':'sectores',
    'sec-festivales':'sectores','sec-promotoras':'sectores','sec-privados':'sectores',
    academy:'recursos', blog:'recursos', guias:'recursos', webinars:'recursos',
    newsletter:'recursos', changelog:'recursos', ayuda:'recursos',
    'api-docs':'recursos', status:'recursos', 'pro-network':'recursos',
    partners:'recursos', fbd:'recursos', embajadores:'recursos',
    sobre:'nosotros', manifesto:'nosotros', equipo:'nosotros', cultura:'nosotros',
    prensa:'nosotros', privacidad:'nosotros', seguridad:'nosotros',
    sostenibilidad:'nosotros', diversidad:'nosotros',
    'contacto-page':'nosotros', ventas:'nosotros',
    'soporte-page':'nosotros', oficinas:'nosotros',
  };

  function init(){
    var mount = document.getElementById('site-header');
    if (mount) {
      mount.outerHTML = html;
    } else {
      var wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      while (wrapper.firstChild) document.body.insertBefore(wrapper.firstChild, document.body.firstChild);
    }

    // Active link highlighting
    var current = document.body.getAttribute('data-current') || '';
    if (current) {
      var menuKey = SLUG_TO_MENU[current];
      if (menuKey) {
        var trig = document.querySelector('.nav-trigger[data-key="'+menuKey+'"]');
        if (trig) trig.classList.add('active');
      }
      var link = document.querySelector('.mega-link[data-slug="'+current+'"]');
      if (link) link.classList.add('current');
    }

    // ===== HEADER SCROLL =====
    var header = document.getElementById('header');
    var onScroll = function(){ if (header) header.classList.toggle('scrolled', window.scrollY > 20); };
    window.addEventListener('scroll', onScroll);
    onScroll();

    // ===== MEGAMENU =====
    var navItems = document.querySelectorAll('.nav-item');
    var panels   = document.querySelectorAll('.mega');
    var megaWrap = document.getElementById('mega-wrap');
    var openMenu = null;
    var closeTimer = null;

    function showPanel(name){
      clearTimeout(closeTimer);
      panels.forEach(function(p){ p.hidden = p.dataset.panel !== name; });
      navItems.forEach(function(it){ it.classList.toggle('open', it.dataset.menu === name); });
      megaWrap.classList.add('open');
      header.classList.add('menu-open');
      openMenu = name;
    }
    function hidePanel(){
      megaWrap.classList.remove('open');
      header.classList.remove('menu-open');
      navItems.forEach(function(it){ it.classList.remove('open'); });
      openMenu = null;
    }
    function scheduleHide(){
      clearTimeout(closeTimer);
      closeTimer = setTimeout(hidePanel, 180);
    }
    navItems.forEach(function(item){
      var name = item.dataset.menu;
      item.addEventListener('mouseenter', function(){ showPanel(name); });
      item.addEventListener('mouseleave', scheduleHide);
      var trigger = item.querySelector('.nav-trigger');
      if (trigger) {
        trigger.addEventListener('click', function(e){
          e.preventDefault();
          if (openMenu === name) hidePanel(); else showPanel(name);
        });
      }
    });
    if (megaWrap) {
      megaWrap.addEventListener('mouseenter', function(){ clearTimeout(closeTimer); });
      megaWrap.addEventListener('mouseleave', scheduleHide);
    }
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') hidePanel(); });

    // ===== MOBILE DRAWER =====
    var burger = document.getElementById('burger');
    var drawer = document.getElementById('mobile-drawer');
    if (burger && drawer) {
      burger.addEventListener('click', function(){
        var isOpen = drawer.classList.toggle('open');
        burger.classList.toggle('open', isOpen);
        document.body.style.overflow = isOpen ? 'hidden' : '';
      });
      drawer.querySelectorAll('a').forEach(function(a){
        a.addEventListener('click', function(){
          drawer.classList.remove('open');
          burger.classList.remove('open');
          document.body.style.overflow = '';
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
