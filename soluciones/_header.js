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

/* ============================================================
   SEARCH INDEX · global window.PasifySearch
   Used by the header search dock. Sorted by section.
   ============================================================ */
(function(global){
  if (global.PasifySearch) return;
  var SUB_FOLDERS_S = ['/soluciones/','/operacion/','/data/','/sectores/','/recursos/','/nosotros/'];
  var INDEX = [
    // Soluciones
    { title:'Venta de entradas',     section:'Soluciones', url:'soluciones/entradas.html',          keywords:['entradas','venta','tickets','ticket','vender entradas','online','aforo'] },
    { title:'Venta en taquilla',     section:'Soluciones', url:'soluciones/taquilla.html',          keywords:['taquilla','taquillero','cobro en puerta','presencial','box office'] },
    { title:'Reservados VIP',        section:'Soluciones', url:'soluciones/vip.html',               keywords:['vip','reservados','reservas de mesa','mesas','reserva','botella','minimo'] },
    { title:'Listas de invitados',   section:'Soluciones', url:'soluciones/invitados.html',         keywords:['invitados','lista','listas','guest list','invitacion','cortesia'] },
    { title:'Gestión de RRPP',       section:'Soluciones', url:'soluciones/rrpp.html',              keywords:['rrpp','relaciones publicas','rrpp top','comisiones rrpp','embajadores'] },
    { title:'Canales de venta',      section:'Soluciones', url:'soluciones/canales.html',           keywords:['canales','canales de venta','distribucion','multicanal','revendedores'] },
    // Operación
    { title:'Control de acceso QR',  section:'Operación',  url:'operacion/control-acceso.html',     keywords:['control de acceso','acceso','qr','scanner','aforo','validacion','puerta','multipuerta'] },
    { title:'Software TPV',          section:'Operación',  url:'operacion/tpv.html',                keywords:['tpv','caja','pos','cierre z','barra','cobro','propinas'] },
    { title:'Recepción de eventos',  section:'Operación',  url:'operacion/recepcion.html',          keywords:['recepcion','check in','check-in','puerta','identificacion','acreditacion','pulsera'] },
    { title:'Soporte personalizado', section:'Operación',  url:'operacion/soporte.html',            keywords:['soporte','soporte 24/7','whatsapp','account manager','onboarding','ayuda en evento'] },
    { title:'Pases de temporada',    section:'Operación',  url:'operacion/pases-temporada.html',    keywords:['pases','abonos','temporada','suscripcion','renovacion','socios','fidelizacion'] },
    // Data
    { title:'CRM y datos en tiempo real', section:'Data',  url:'data/crm.html',                     keywords:['crm','datos','real time','segmentos','perfil 360','rgpd','base de datos'] },
    { title:'Marketing digital',     section:'Data',       url:'data/marketing.html',               keywords:['marketing','marketing digital','campanas','meta','google','tiktok','atribucion','roi','capi'] },
    { title:'Informes de eventos',   section:'Data',       url:'data/informes.html',                keywords:['informes','informe','reporte','reportes','kpi','cierre evento','heatmap','mapa de calor'] },
    { title:'API e integraciones',   section:'Data',       url:'data/api.html',                     keywords:['api','integraciones','webhooks','rest','graphql','sdk','sandbox','conectores'] },
    // Sectores
    { title:'Discotecas',            section:'Sectores',   url:'sectores/discotecas.html',          keywords:['discoteca','discotecas','club','clubs','nightclub','sala'] },
    { title:'Salas de conciertos',   section:'Sectores',   url:'sectores/salas.html',               keywords:['salas','salas de conciertos','conciertos','salas en vivo','venue','live','concierto'] },
    { title:'Beach Clubs',           section:'Sectores',   url:'sectores/beach-clubs.html',         keywords:['beach','beach clubs','beach club','playa','chiringuito','verano'] },
    { title:'Festivales',            section:'Sectores',   url:'sectores/festivales.html',          keywords:['festival','festivales','macroevento','open air'] },
    { title:'Promotoras',            section:'Sectores',   url:'sectores/promotoras.html',          keywords:['promotora','promotoras','promotor','productora'] },
    { title:'Eventos privados',      section:'Sectores',   url:'sectores/eventos-privados.html',    keywords:['eventos privados','privados','boda','bodas','corporativo','aniversario','cumpleanos'] },
    // Recursos
    { title:'Pasify Academy',        section:'Recursos',   url:'recursos/academy.html',             keywords:['academy','cursos','formacion','aprender','pasify pro','certificacion','diploma'] },
    { title:'Blogs y Newsletter',    section:'Recursos',   url:'recursos/blog.html',                keywords:['blog','blogs','newsletter','casos de exito','webinars','noticias','articulos'] },
    { title:'Centro de ayuda',       section:'Recursos',   url:'recursos/ayuda.html',               keywords:['ayuda','centro de ayuda','soporte','changelog','estado del sistema','faq'] },
    { title:'Documentación API',     section:'Recursos',   url:'recursos/api-docs.html',            keywords:['documentacion','docs','sdk','rest','graphql','webhooks','api docs','postman','insomnia'] },
    { title:'Partners y Promotores', section:'Recursos',   url:'recursos/pro-network.html',         keywords:['partners','promotores','comunidad','embajadores','comisiones','red','slack'] },
    // Nosotros
    { title:'Sobre nosotros',        section:'Nosotros',   url:'nosotros/sobre.html',               keywords:['sobre','sobre nosotros','equipo','manifiesto','historia','mision','quienes somos'] },
    { title:'Seguridad y privacidad',section:'Nosotros',   url:'nosotros/seguridad.html',           keywords:['seguridad','privacidad','rgpd','iso','soc','compliance','dpa','pci'] },
    { title:'Solicitar demo',        section:'Nosotros',   url:'nosotros/contacto.html',            keywords:['demo','solicitar demo','agendar','reunion','enterprise','llamada','videollamada'] },
    { title:'Contacto y oficinas',   section:'Nosotros',   url:'nosotros/oficinas.html',            keywords:['oficinas','direccion','contacto','sedes','telefono','email','formulario'] },
    // Pricing (anchor on home)
    { title:'Pricing',               section:'Precios',    url:'pasify.html#precios',               keywords:['precio','precios','pricing','planes','tarifa','coste','cuanto cuesta'] }
  ];
  function normalize(s){
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function score(entry, q){
    var titleN = normalize(entry.title);
    var s = 0;
    if (titleN === q) s = 200;
    else if (titleN.indexOf(q) === 0) s = 130;
    else if (titleN.indexOf(' ' + q) !== -1) s = 100;
    else if (titleN.indexOf(q) !== -1) s = 80;
    for (var i = 0; i < entry.keywords.length; i++) {
      var k = normalize(entry.keywords[i]);
      var ks = 0;
      if (k === q) ks = 110;
      else if (k.indexOf(q) === 0) ks = 70;
      else if (k.indexOf(q) !== -1) ks = 50;
      else if (q.length >= 4 && k.length >= 4 && q.indexOf(k) !== -1) ks = 30;
      if (ks > s) s = ks;
    }
    return s;
  }
  function findMany(query, max){
    var q = normalize((query || '').trim());
    if (!q) return [];
    var out = [];
    for (var i = 0; i < INDEX.length; i++) {
      var sc = score(INDEX[i], q);
      if (sc > 0) out.push({ entry: INDEX[i], score: sc });
    }
    out.sort(function(a, b){ return b.score - a.score; });
    return out.slice(0, max || 6).map(function(r){ return r.entry; });
  }
  function find(query){
    var matches = findMany(query, 1);
    return matches.length ? matches[0] : null;
  }
  function resolveUrl(url){
    if (!url) return '#';
    if (url.indexOf('http') === 0 || url.indexOf('//') === 0) return url;
    var inSub = SUB_FOLDERS_S.some(function(f){ return location.pathname.indexOf(f) !== -1; });
    var pre = inSub ? '../' : '';
    return pre + url;
  }
  global.PasifySearch = { INDEX: INDEX, find: find, findMany: findMany, resolveUrl: resolveUrl };
})(window);

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
    + '<style id="pasify-mega-extra">'
    +   '.mega-link.has-sub{flex-direction:column;align-items:flex-start;gap:6px;line-height:1.2}'
    +   '.mega-link.has-sub .ttl{font-size:14px;font-weight:500;letter-spacing:-0.005em}'
    +   '.mega-link.has-sub .sublabel{font-family:\'Geist Mono\',monospace;font-size:10px;letter-spacing:.06em;color:var(--ink-3);line-height:1.45;font-weight:400}'
    +   '.mega-link.has-sub:hover .sublabel,.mega-link.has-sub.current .sublabel{color:var(--ink-2)}'
    +   '.search-dock{position:relative;width:40px;height:40px;flex-shrink:0;margin-right:6px}'
    +   '.search-trigger{position:absolute;inset:0;width:40px;height:40px;border-radius:999px;border:1px solid var(--line-2);background:rgba(244,238,226,.04);display:grid;place-items:center;color:var(--ink-2);cursor:pointer;transition:opacity .2s ease,transform .2s ease,color .2s ease,border-color .2s ease,background .2s ease;padding:0}'
    +   '.search-trigger:hover{color:var(--ink);border-color:rgba(232,84,42,.4);background:rgba(232,84,42,.06)}'
    +   '.search-trigger svg{width:16px;height:16px}'
    +   '.search-form{position:absolute;top:0;right:0;height:40px;width:320px;border-radius:999px;background:rgba(20,17,14,0.92);border:1px solid var(--line-2);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;align-items:center;opacity:0;pointer-events:none;transform:scaleX(.125);transform-origin:right center;transition:transform .35s cubic-bezier(0.16,1,0.3,1),opacity .25s ease;overflow:hidden;z-index:5}'
    +   '.search-form .search-ico{padding:0 6px 0 16px;display:flex;align-items:center;color:var(--ink-3)}'
    +   '.search-form .search-ico svg{width:14px;height:14px}'
    +   '.search-form input{flex:1;min-width:0;height:100%;background:transparent;border:0;outline:0;color:var(--ink);font-family:inherit;font-size:13px;padding:0 6px}'
    +   '.search-form input::placeholder{color:var(--ink-3)}'
    +   '.search-form .search-close{flex-shrink:0;margin-right:4px;width:28px;height:28px;border:0;background:transparent;border-radius:999px;display:grid;place-items:center;color:var(--ink-2);cursor:pointer;transition:background .15s ease,color .15s ease,transform .15s ease;padding:0}'
    +   '.search-form .search-close:hover{background:rgba(244,238,226,.08);color:var(--accent);transform:scale(1.08)}'
    +   '.search-form .search-close svg{width:14px;height:14px}'
    +   '.search-dock.open .search-trigger{opacity:0;transform:scale(.6);pointer-events:none}'
    +   '.search-dock.open .search-form{transform:scaleX(1);opacity:1;pointer-events:auto}'
    +   '.search-results{position:absolute;top:48px;right:0;width:320px;background:rgba(20,17,14,0.96);border:1px solid var(--line-2);border-radius:14px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);padding:6px;max-height:360px;overflow-y:auto;opacity:0;pointer-events:none;transform:translateY(-4px);transition:opacity .2s ease,transform .2s ease;z-index:6;box-shadow:0 12px 40px -12px rgba(0,0,0,.6)}'
    +   '.search-dock.has-results .search-results{opacity:1;pointer-events:auto;transform:translateY(0)}'
    +   '.search-result{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;cursor:pointer;transition:background .15s ease;text-decoration:none;color:var(--ink)}'
    +   '.search-result:hover,.search-result.active{background:rgba(232,84,42,.10)}'
    +   '.search-result .lab{font-family:\'Geist Mono\',monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3);flex-shrink:0;min-width:78px}'
    +   '.search-result .ttl{font-size:13px;color:var(--ink);flex:1;line-height:1.25}'
    +   '.search-result.active .lab,.search-result:hover .lab{color:var(--accent)}'
    +   '.search-empty{padding:18px 14px;font-size:12px;color:var(--ink-3);text-align:center;line-height:1.5}'
    +   '@media (max-width:880px){.search-form,.search-results{width:min(280px,calc(100vw - 120px))}}'
    +   '@media (max-width:520px){.search-dock{display:none}}'
    + '</style>'
    + '<header class="header" id="header">'
    +   '<div class="header-inner">'
    +     '<a href="' + H('') + '" class="logo" aria-label="Pasify">'
    +       '<img src="' + P + 'uploads/pasify-logo.png" alt="Pasify">'
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
    +     '<div class="search-dock" id="search-dock">'
    +       '<button type="button" class="search-trigger" id="search-trigger" aria-label="Abrir búsqueda">'
    +         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>'
    +       '</button>'
    +       '<form class="search-form" id="search-form" role="search" autocomplete="off">'
    +         '<span class="search-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></span>'
    +         '<input type="search" id="search-input" placeholder="Busca soluciones, sectores, recursos…" />'
    +         '<button type="button" class="search-close" id="search-close" aria-label="Cerrar búsqueda">'
    +           '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
    +         '</button>'
    +       '</form>'
    +       '<div class="search-results" id="search-results" role="listbox"></div>'
    +     '</div>'
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
    +             '<li><a class="mega-link" href="' + L('recursos','blog.html') + '">Apertura de temporada</a></li>'
    +             '<li><a class="mega-link" href="' + L('recursos','blog.html') + '">Festival multi-escenario</a></li>'
    +             '<li><a class="mega-link" href="' + L('recursos','blog.html') + '">Reapertura post-reforma</a></li>'
    +             '<li><a class="mega-link" href="' + L('recursos','blog.html') + '">Tour internacional</a></li>'
    +             '<li><a class="mega-link" href="' + L('recursos','blog.html') + '">White label para promotor</a></li>'
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
    +           '<a href="' + L('recursos','blog.html') + '">Leer caso →</a>'
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
    +             '<li><a class="mega-link has-sub" data-slug="blog-newsletter" href="' + L('recursos','blog.html') + '">'
    +               '<span class="ttl">Blogs &amp; Newsletter</span>'
    +               '<span class="sublabel">Blog · Newsletter · Webinars &amp; eventos</span>'
    +             '</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-col">'
    +           '<h6>Ayuda</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link has-sub" data-slug="ayuda" href="' + L('recursos','ayuda.html') + '">'
    +               '<span class="ttl">Centro de ayuda</span>'
    +               '<span class="sublabel">Changelog · Estado del sistema · Soporte 24/7</span>'
    +             '</a></li>'
    +             '<li><a class="mega-link" data-slug="api-docs" href="' + L('recursos','api-docs.html') + '">API e integraciones</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-col">'
    +           '<h6>Comunidad</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link has-sub" data-slug="partners-promotores" href="' + L('recursos','pro-network.html') + '">'
    +               '<span class="ttl">Partners &amp; Promotores</span>'
    +               '<span class="sublabel">Programa de partners · Programa de embajadores RRPP</span>'
    +             '</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-feature">'
    +           '<span class="lab">Recurso gratuito</span>'
    +           '<h5>El estado de los eventos 2026</h5>'
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
    +             '<li><a class="mega-link has-sub" data-slug="sobre" href="' + L('nosotros','sobre.html') + '">'
    +               '<span class="ttl">Sobre nosotros</span>'
    +               '<span class="sublabel">Manifiesto · Equipo · Sostenibilidad</span>'
    +             '</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-col">'
    +           '<h6>Confianza</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link has-sub" data-slug="seguridad-privacidad" href="' + L('nosotros','seguridad.html') + '">'
    +               '<span class="ttl">Seguridad y privacidad</span>'
    +               '<span class="sublabel">Privacidad de datos · Seguridad</span>'
    +             '</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-col">'
    +           '<h6>Contacto</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link has-sub" data-slug="contacto-page" href="' + L('nosotros','contacto.html') + '">'
    +               '<span class="ttl">Solicitar demo</span>'
    +               '<span class="sublabel">Hablar con ventas</span>'
    +             '</a></li>'
    +             '<li><a class="mega-link has-sub" data-slug="contacto-form" href="' + L('nosotros','oficinas.html') + '">'
    +               '<span class="ttl">Contacto</span>'
    +               '<span class="sublabel">Formulario · Oficinas</span>'
    +             '</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-feature">'
    +           '<span class="lab">Estamos contratando</span>'
    +           '<h5>+12 posiciones abiertas</h5>'
    +           '<p>Diseño, ingeniería, ventas y soporte. Construye el sistema operativo de los eventos con nosotros.</p>'
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
    +       '<a href="' + L('recursos','blog.html') + '">Blogs &amp; Newsletter</a>'
    +       '<a href="' + L('recursos','ayuda.html') + '">Centro de ayuda</a>'
    +       '<a href="' + L('recursos','api-docs.html') + '">API e integraciones</a>'
    +       '<a href="' + L('recursos','pro-network.html') + '">Partners &amp; Promotores</a>'
    +     '</div>'
    +   '</details>'
    +   '<details>'
    +     '<summary>Nosotros</summary>'
    +     '<div class="sub">'
    +       '<a href="' + L('nosotros','sobre.html') + '">Sobre nosotros</a>'
    +       '<a href="' + L('nosotros','seguridad.html') + '">Seguridad y privacidad</a>'
    +       '<a href="' + L('nosotros','contacto.html') + '">Solicitar demo</a>'
    +       '<a href="' + L('nosotros','oficinas.html') + '">Contacto</a>'
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
    academy:'recursos', 'blog-newsletter':'recursos',
    blog:'recursos', newsletter:'recursos', webinars:'recursos',
    ayuda:'recursos', changelog:'recursos', status:'recursos',
    'api-docs':'recursos',
    'partners-promotores':'recursos', 'pro-network':'recursos',
    partners:'recursos', embajadores:'recursos',
    sobre:'nosotros', manifesto:'nosotros', equipo:'nosotros', sostenibilidad:'nosotros',
    'seguridad-privacidad':'nosotros', seguridad:'nosotros', privacidad:'nosotros',
    'contacto-page':'nosotros', ventas:'nosotros',
    'contacto-form':'nosotros', oficinas:'nosotros',
    cultura:'nosotros', prensa:'nosotros', diversidad:'nosotros',
    'soporte-page':'recursos',
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

    // ===== SEARCH DOCK =====
    var dock = document.getElementById('search-dock');
    if (dock && dock.dataset.bound !== '1' && window.PasifySearch) {
      var sTrigger = dock.querySelector('#search-trigger');
      var sForm    = dock.querySelector('#search-form');
      var sInput   = dock.querySelector('#search-input');
      var sClose   = dock.querySelector('#search-close');
      var sResults = dock.querySelector('#search-results');
      if (sTrigger && sForm && sInput && sClose && sResults) {
        dock.dataset.bound = '1';

        function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

        function renderResults(query){
          var matches = window.PasifySearch.findMany(query, 6);
          if (!matches.length) {
            dock.classList.add('has-results');
            sResults.innerHTML = '<div class="search-empty">Sin resultados para «' + escapeHtml(query) + '».<br/>Pulsa Enter para buscar en el centro de ayuda.</div>';
            return;
          }
          dock.classList.add('has-results');
          sResults.innerHTML = matches.map(function(m, i){
            return '<a class="search-result' + (i===0?' active':'') + '" href="' + window.PasifySearch.resolveUrl(m.url) + '" role="option">' +
                   '<span class="lab">' + escapeHtml(m.section) + '</span>' +
                   '<span class="ttl">' + escapeHtml(m.title) + '</span>' +
                   '</a>';
          }).join('');
        }

        function clearResults(){ dock.classList.remove('has-results'); sResults.innerHTML = ''; }

        function openSearch(){ dock.classList.add('open'); setTimeout(function(){ sInput.focus(); }, 200); }
        function closeSearch(){ dock.classList.remove('open'); sInput.value = ''; clearResults(); }

        sTrigger.addEventListener('click', openSearch);
        sClose.addEventListener('click', closeSearch);

        sInput.addEventListener('input', function(){
          var q = sInput.value.trim();
          if (!q) { clearResults(); return; }
          renderResults(q);
        });

        sInput.addEventListener('keydown', function(e){
          if (!dock.classList.contains('has-results')) return;
          var items = sResults.querySelectorAll('.search-result');
          if (!items.length) return;
          var activeIdx = -1;
          for (var i = 0; i < items.length; i++) { if (items[i].classList.contains('active')) { activeIdx = i; break; } }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (activeIdx >= 0) items[activeIdx].classList.remove('active');
            var next = (activeIdx + 1) % items.length;
            items[next].classList.add('active');
            items[next].scrollIntoView({ block: 'nearest' });
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (activeIdx >= 0) items[activeIdx].classList.remove('active');
            var prev = (activeIdx - 1 + items.length) % items.length;
            items[prev].classList.add('active');
            items[prev].scrollIntoView({ block: 'nearest' });
          }
        });

        document.addEventListener('keydown', function(e){
          if (e.key === 'Escape' && dock.classList.contains('open')) closeSearch();
        });

        document.addEventListener('click', function(e){
          if (dock.classList.contains('open') && !dock.contains(e.target)) closeSearch();
        });

        sForm.addEventListener('submit', function(e){
          e.preventDefault();
          var active = sResults.querySelector('.search-result.active');
          if (active) { location.href = active.getAttribute('href'); return; }
          var q = sInput.value.trim();
          if (!q) return;
          var match = window.PasifySearch.find(q);
          if (match) location.href = window.PasifySearch.resolveUrl(match.url);
          else location.href = window.PasifySearch.resolveUrl('recursos/ayuda.html') + '?q=' + encodeURIComponent(q);
        });
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
