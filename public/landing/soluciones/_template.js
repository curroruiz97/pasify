// Page configs split into 4 batches to avoid huge run_script payloads.
window.PASIFY_T = (cfg) => `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${cfg.title} · Pasify</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<link rel="stylesheet" href="_shared.css">
</head>
<body data-current="${cfg.slug}">
<div class="grain"></div>
<div id="site-header"></div>
<main><div class="wrap">
<nav class="crumbs"><a href="../pasify.html">Inicio</a><span class="sep">/</span><a href="../pasify.html#productos">${cfg.section}</a><span class="sep">/</span><span class="here">${cfg.title}</span></nav>
<section class="page-hero"><div class="inner">
<div><span class="label"><span class="pulse"></span>${cfg.eyebrow}</span>
<h1>${cfg.h1}</h1><p class="lede">${cfg.lede}</p>
<div class="ctas"><a href="../pasify.html#contacto" class="btn btn-primary">Solicita demo <span class="arrow">→</span></a><a href="../pasify.html#productos" class="btn btn-outline">Más soluciones</a></div></div>
<div style="background:linear-gradient(160deg,#1A0F08,#3D1F12);border:1px solid rgba(232,84,42,.25);border-radius:18px;padding:32px;min-height:340px;position:relative;overflow:hidden">
<div style="position:absolute;width:200px;height:200px;background:var(--accent);filter:blur(80px);opacity:.3;top:-60px;right:-60px"></div>
<div style="position:relative;font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent)">${cfg.cardLabel}</div>
<h3 style="position:relative;font-size:28px;font-weight:600;letter-spacing:-0.02em;margin-top:14px;color:var(--ink);line-height:1.15">${cfg.cardTitle}</h3>
<p style="position:relative;font-size:15px;color:var(--ink-2);line-height:1.55;margin-top:14px;max-width:36ch">${cfg.cardCopy}</p>
<div style="position:relative;display:flex;flex-wrap:wrap;gap:10px;margin-top:24px">${cfg.cardChips.map(c=>`<span style="font-family:'Geist Mono',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:6px 12px;border-radius:999px;background:rgba(244,238,226,.06);border:1px solid var(--line-2);color:var(--ink-2)">${c}</span>`).join('')}</div>
</div></div></section>
<section style="display:grid;grid-template-columns:repeat(${cfg.stats.length},1fr);gap:24px;padding:36px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-top:48px">
${cfg.stats.map(s=>`<div><div style="font-family:'Geist Mono',monospace;font-size:32px;font-weight:600;letter-spacing:-0.03em;color:var(--ink)">${s.num}</div><div style="font-family:'Geist Mono',monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3);margin-top:4px">${s.lab}</div></div>`).join('')}
</section>
<section style="padding:96px 0">
<div style="max-width:760px;margin-bottom:64px"><div style="font-family:'Geist Mono',monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);margin-bottom:14px">Capacidades</div><h2 style="font-size:clamp(36px,4.4vw,56px);font-weight:600;letter-spacing:-0.04em;line-height:1.02;color:var(--ink)">${cfg.featureH2}</h2></div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px">
${cfg.features.map((f,i)=>`<article style="background:var(--bg-2);border:1px solid var(--line);border-radius:16px;padding:32px 28px"><div style="font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-3);margin-bottom:18px">0${i+1}</div><h3 style="font-size:21px;font-weight:600;letter-spacing:-0.02em;color:var(--ink);line-height:1.25">${f.h}</h3><p style="font-size:15px;color:var(--ink-2);line-height:1.6;margin-top:10px">${f.p}</p></article>`).join('')}
</div></section>
<section style="margin:32px 0 96px;background:linear-gradient(135deg,#1A0F08,#3D1F12);border:1px solid rgba(232,84,42,.3);border-radius:24px;padding:64px 56px;display:grid;grid-template-columns:1.4fr 1fr;gap:48px;align-items:center;position:relative;overflow:hidden">
<div style="position:absolute;width:400px;height:400px;background:var(--accent);filter:blur(120px);opacity:.25;top:-100px;right:-100px;pointer-events:none"></div>
<div style="position:relative"><div style="font-family:'Geist Mono',monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);margin-bottom:18px">Empieza hoy</div><h2 style="font-size:clamp(32px,3.6vw,48px);font-weight:600;letter-spacing:-0.04em;line-height:1.05;color:var(--ink)">${cfg.ctaH}</h2><p style="font-size:17px;color:var(--ink-2);line-height:1.55;margin-top:18px;max-width:48ch">${cfg.ctaP}</p><div style="display:flex;gap:14px;margin-top:32px;flex-wrap:wrap"><a href="../pasify.html#contacto" class="btn btn-primary">Solicita demo <span class="arrow">→</span></a><a href="../pasify.html#pricing" class="btn btn-outline">Ver pricing</a></div></div>
<div style="position:relative;display:flex;flex-direction:column;gap:14px">${cfg.ctaBullets.map(b=>`<div style="display:flex;align-items:start;gap:14px"><span style="width:26px;height:26px;border-radius:7px;background:rgba(232,84,42,.18);border:1px solid rgba(232,84,42,.3);display:grid;place-items:center;color:var(--accent);flex-shrink:0;font-family:'Geist Mono',monospace;font-size:13px">✓</span><div style="font-size:15px;color:var(--ink);line-height:1.5">${b}</div></div>`).join('')}</div>
</section>
</div></main>
<footer style="border-top:1px solid var(--line);padding:48px 0 32px;margin-top:48px"><div class="wrap" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:24px"><a href="../pasify.html" class="logo" style="font-size:22px"><span>Pas</span><span class="dot"></span><span>if</span><span class="y">y</span></a><div style="font-family:'Geist Mono',monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3)">© 2026 Pasify · El pase a tu mejor noche.</div></div></footer>
<script src="_header.js"></script>
</body></html>`;
