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
    +         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg>'
    +       '</button>'
    +       '<form class="search-form" id="search-form" role="search" autocomplete="off">'
    +         '<span class="search-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg></span>'
    +         '<input type="search" id="search-input" placeholder="Busca soluciones, sectores, recursos…" />'
    +         '<button type="button" class="search-close" id="search-close" aria-label="Cerrar búsqueda">'
    +           '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>'
    +         '</button>'
    +       '</form>'
    +       '<div class="search-results" id="search-results" role="listbox"></div>'
    +     '</div>'
    +     '<a href="' + H('contacto') + '" class="login">Entrar</a>'
    +     '<a href="' + H('contacto') + '" class="cta">Solicita demo <svg class="arr-ico" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.125em"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></a>'
    +     '<button class="burger" id="burger" aria-label="Menú"><span></span></button>'
    +   '</div>'

    +   '<div class="mega-wrap" id="mega-wrap">'

    // ============== SOLUCIONES PANEL ==============
    +     '<div class="mega" data-panel="soluciones" hidden>'
    +       '<div class="mega-grid">'
    +         '<div class="mega-col">'
    +           '<h6>Gestión de venta</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" data-slug="entradas" href="' + L('soluciones','entradas.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="M13 5v2" /><path d="M13 17v2" /><path d="M13 11v2" /></svg></span>Venta de entradas</a></li>'
    +             '<li><a class="mega-link" data-slug="taquilla" href="' + L('soluciones','taquilla.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5" /><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244" /><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05" /></svg></span>Venta en taquilla</a></li>'
    +             '<li><a class="mega-link" data-slug="vip" href="' + L('soluciones','vip.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" /></svg></span>Reservados VIP</a></li>'
    +             '<li><a class="mega-link" data-slug="invitados" href="' + L('soluciones','invitados.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" /></svg></span>Listas de invitados</a></li>'
    +             '<li><a class="mega-link" data-slug="rrpp" href="' + L('soluciones','rrpp.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" /><path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14" /><path d="M8 6v8" /></svg></span>Gestión de RRPP</a></li>'
    +             '<li><a class="mega-link" data-slug="canales" href="' + L('soluciones','canales.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" x2="15.42" y1="13.51" y2="17.49" /><line x1="15.41" x2="8.59" y1="6.51" y2="10.49" /></svg></span>Canales de venta</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-col">'
    +           '<h6>Operación</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" data-slug="control-acceso" href="' + L('operacion','control-acceso.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 12v4a1 1 0 0 1-1 1h-4" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M17 8V7" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M7 17h.01" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><rect x="7" y="7" width="5" height="5" rx="1" /></svg></span>Control de acceso QR <span class="pill">Hot</span></a></li>'
    +             '<li><a class="mega-link" data-slug="tpv" href="' + L('operacion','tpv.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="5" rx="2" /><line x1="2" x2="22" y1="10" y2="10" /><path d="M6 14h2" /></svg></span>Software TPV</a></li>'
    +             '<li><a class="mega-link" data-slug="recepcion" href="' + L('operacion','recepcion.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 20a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1Z" /><path d="M20 16a8 8 0 1 0-16 0" /><path d="M12 4v4" /><path d="M10 4h4" /></svg></span>Recepción de eventos</a></li>'
    +             '<li><a class="mega-link" data-slug="soporte" href="' + L('operacion','soporte.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z" /><path d="M21 16v2a4 4 0 0 1-4 4h-5" /></svg></span>Soporte personalizado</a></li>'
    +             '<li><a class="mega-link" data-slug="pases-temporada" href="' + L('operacion','pases-temporada.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v3" /><path d="M16 2v3" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="m9 15 2 2 4-4" /></svg></span>Pases de temporada</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-col">'
    +           '<h6>Data &amp; Marketing</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" data-slug="crm" href="' + L('data','crm.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 2v2" /><path d="M17.915 21a6 6 0 10-12 0" /><path d="M8 2v2" /><circle cx="12" cy="11" r="4" /><rect x="3" y="3" width="18" height="18" rx="2" /></svg></span>CRM &amp; Real time data</a></li>'
    +             '<li><a class="mega-link" data-slug="marketing" href="' + L('data','marketing.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 7h6v6" /><path d="m22 7-8.5 8.5-5-5L2 17" /></svg></span>Marketing digital</a></li>'
    +             '<li><a class="mega-link" data-slug="informes" href="' + L('data','informes.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M8 18v-1" /><path d="M12 18v-6" /><path d="M16 18v-3" /></svg></span>Informes de eventos</a></li>'
    +             '<li><a class="mega-link" data-slug="api" href="' + L('data','api.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2" /><rect x="14" y="2" width="8" height="8" rx="1" /></svg></span>API &amp; Integraciones</a></li>'
    +           '</ul>'
    +         '</div>'
    +         '<div class="mega-feature">'
    +           '<span class="lab">Novedad 2026</span>'
    +           '<h5>Pasify Live: aforo en tiempo real</h5>'
    +           '<p>Mide entradas, salidas y consumo medio por zona desde una sola pantalla. Decide subidas de precio sin parar la fiesta.</p>'
    +           '<a href="' + H('producto') + '">Descubrir <svg class="arr-ico" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.125em"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></a>'
    +         '</div>'
    +       '</div>'
    +     '</div>'

    // ============== SECTORES PANEL ==============
    +     '<div class="mega" data-panel="sectores" hidden>'
    +       '<div class="mega-grid">'
    +         '<div class="mega-col">'
    +           '<h6>Por tipo de negocio</h6>'
    +           '<ul>'
    +             '<li><a class="mega-link" data-slug="sec-discotecas" href="' + L('sectores','discotecas.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M6 12c0-1.7.7-3.2 1.8-4.2" /><circle cx="12" cy="12" r="2" /><path d="M18 12c0 1.7-.7 3.2-1.8 4.2" /></svg></span>Discotecas</a></li>'
    +             '<li><a class="mega-link" data-slug="sec-salas" href="' + L('sectores','salas.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12" /><path d="M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5" /><circle cx="16" cy="7" r="5" /></svg></span>Salas de conciertos</a></li>'
    +             '<li><a class="mega-link" data-slug="sec-beach" href="' + L('sectores','beach-clubs.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l1-1 1 1h4" /><path d="M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-3l-1-1-1 1h-3" /><path d="M5.89 9.71c-2.15 2.15-2.3 5.47-.35 7.43l4.24-4.25.7-.7.71-.71 2.12-2.12c-1.95-1.96-5.27-1.8-7.42.35" /><path d="M11 15.5c.5 2.5-.17 4.5-1 6.5h4c2-5.5-.5-12-1-14" /></svg></span>Beach Clubs</a></li>'
    +             '<li><a class="mega-link" data-slug="sec-festivales" href="' + L('sectores','festivales.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 21 14 3" /><path d="M20.5 21 10 3" /><path d="M15.5 21 12 15l-3.5 6" /><path d="M2 21h20" /></svg></span>Festivales</a></li>'
    +             '<li><a class="mega-link" data-slug="sec-promotoras" href="' + L('sectores','promotoras.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 12h.01" /><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><path d="M22 13a18.15 18.15 0 0 1-20 0" /><rect width="20" height="14" x="2" y="6" rx="2" /></svg></span>Promotoras</a></li>'
    +             '<li><a class="mega-link" data-slug="sec-privados" href="' + L('sectores','eventos-privados.html') + '"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.8 11.3 2 22l10.7-3.79" /><path d="M4 3h.01" /><path d="M22 8h.01" /><path d="M15 2h.01" /><path d="M22 20h.01" /><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10" /><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17" /><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7" /><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z" /></svg></span>Eventos privados</a></li>'
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
    +           '<a href="' + L('recursos','blog.html') + '">Leer caso <svg class="arr-ico" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.125em"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></a>'
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
    +           '<a href="' + L('recursos','blog.html') + '">Descargar PDF <svg class="arr-ico" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.125em"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></a>'
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
    +           '<a href="' + L('nosotros','cultura.html') + '">Ver vacantes <svg class="arr-ico" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.125em"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></a>'
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
    +     '<a href="' + H('contacto') + '" class="btn btn-primary" style="justify-content:center">Solicita demo <svg class="arr-ico" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.125em"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></a>'
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
