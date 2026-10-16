/*
 * Pasify hero background: glossy liquid-glass ribbons (WebGL1, single fragment shader).
 * Usage: <div data-hero-webgl aria-hidden="true"></div> + hero-bg.css + this script (defer).
 * No dependencies. Falls back to the CSS gradient if WebGL is unavailable.
 */
(function () {
  'use strict';

  var LOOP_SECONDS = 32;          // one full motion loop
  var MAX_DPR = 1.5;
  var MAX_LONG_SIDE = 1600;       // cap for the drawing buffer
  var TAU = Math.PI * 2;

  var VERT = [
    'attribute vec2 aPos;',
    'void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var FRAG = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform vec2  uRes;',
    'uniform float uT;',      // loop phase 0..TAU
    'uniform vec2  uMouse;',  // -1..1, lerped
    'uniform float uHalf;',   // half width of the screen (screen units, height = 1)
    'uniform float uAmp;',    // amplitude of the edge undulation
    'uniform vec4  uCalm;',   // calm zone over the content: x half-width, y min, y max, strength
    'uniform float uFade;',   // height of the bottom fade (0..1 of the canvas)
    'uniform float uW;',      // visible ribbon width
    'uniform float uSeed;',
    'uniform vec2  uTilt;',
    'uniform vec2  uBulge;',
    'uniform vec2  uOff;',    // per-side inward offset of the edge
    'uniform float uScroll;', // 0..1 progress of the hero scroll-out (hero.js)

    'const vec3 BG    = vec3(0.04314, 0.03529, 0.03137);', // #0B0908
    'const vec3 DEEP  = vec3(0.16471, 0.05882, 0.02353);', // #2A0F06
    'const vec3 MID   = vec3(0.47843, 0.16471, 0.05882);', // #7A2A0F
    'const vec3 ACC   = vec3(0.90980, 0.32941, 0.16471);', // #E8542A
    'const vec3 ACC2  = vec3(1.00000, 0.47843, 0.30196);', // #FF7A4D
    'const vec3 CREAM = vec3(1.00000, 0.85098, 0.76078);', // #FFD9C2

    // rounded glass profile: 0 at the edge, rising like a quarter circle to 1 at depth w
    'float prof(float d, float w){',
    '  float q = clamp(d / w, 0.0, 1.0);',
    '  return sqrt(q * (2.0 - q));',
    '}',

    // height field of one side (heights in screen units). x grows towards the outer edge.
    // returns vec2(height, signed distance into the sheet)
    'vec2 side(vec2 p, float s, float t, float tilt, float bulge, float off){',
    '  float x = p.x; float y = p.y;',
    '  float ph = s * 1.7 + uSeed;',
    // domain warp so the edge curves organically
    '  float wy = y + 0.06*sin(x*3.1 + t + ph);',
    '  float e = uHalf - uW - off + uScroll * 0.16',
    '      + tilt * (y + 0.5)',
    '      - bulge * exp(-pow((wy - 0.08*s + 0.12*sin(t + ph)) * 2.2, 2.0))',
    '      + uAmp * (0.062*sin(wy*2.3 + t + ph)',
    '      + 0.030*sin(wy*4.1 - 2.0*t + ph*1.9)',
    '      + 0.012*sin(wy*7.3 + 3.0*t + ph*0.7));',
    '  float d = x - e;',
    '  float W = 0.42;',
    // main curled sheet: rounded cross-section, steep at the rim, broad shoulder inside
    '  float h = 0.20 * prof(d, W);',
    // a secondary fold riding on the sheet (gives the inner highlight line)
    '  float c2 = 0.13 + 0.05*sin(wy*2.6 - t + ph + 2.1);',
    '  float f2 = d - c2;',
    '  h += 0.032 * exp(-f2*f2 * 160.0);',
    // slow undulations across the body
    '  h += 0.010 * sin(d*8.0 - wy*3.0 + t + ph) * smoothstep(0.02, 0.25, d);',
    '  h += 0.006 * sin(wy*5.0 + d*3.0 - 2.0*t) * smoothstep(0.02, 0.25, d);',
    '  return vec2(h, d);',
    '}',


    // full scene height: both sides; returns vec3(height, dist left, dist right)
    'vec3 scene(vec2 p, float t){',
    '  vec2 a = side(vec2(-p.x, p.y), -1.0, t, uTilt.x, uBulge.x, uOff.x);',
    '  vec2 b = side(vec2( p.x, -p.y), 1.0, t + 1.3, uTilt.y, uBulge.y, uOff.y);',
    '  float ha = a.x * smoothstep(-0.003, 0.0, a.y);',
    '  float hb = b.x * smoothstep(-0.003, 0.0, b.y);',
    '  return vec3(max(ha, hb), a.y, b.y);',
    '}',

    'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',

    'void main(){',
    '  vec2 frag = gl_FragCoord.xy;',
    '  vec2 uv = frag / uRes;',
    '  vec2 p = (frag - 0.5*uRes) / uRes.y;',
    '  p += uMouse * vec2(-0.012, -0.008);',
    '  p.y -= uScroll * 0.42;',
    '  float t = uT;',

    '  float eps = 1.0 / uRes.y;',
    '  vec3 c0 = scene(p, t);',
    '  float hx = scene(p + vec2(eps, 0.0), t).x - c0.x;',
    '  float hy = scene(p + vec2(0.0, eps), t).x - c0.x;',
    '  float H = c0.x;',
    '  float dEdge = max(c0.y, c0.z);',  // distance inside nearest ribbon (neg = outside)
    '  vec3 N = normalize(vec3(-hx / eps, -hy / eps, 1.0));',
    '  vec3 V = vec3(0.0, 0.0, 1.0);',

    '  vec3 L = normalize(vec3(-0.30 + uMouse.x*0.20, 0.65 + uMouse.y*0.12, 0.70));',
    '  float diff = max(dot(N, L), 0.0);',
    '  float ndv = clamp(N.z, 0.0, 1.0);',
    '  float fres = pow(1.0 - ndv, 4.0);',
    '  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 140.0);',
    '  vec3 R = reflect(-V, N);',
    // fake studio environment: two soft strip lights reflected in the glass
    '  float strip  = exp(-pow((dot(R.xy, normalize(vec2(-0.55, 0.83))) - 0.38) * 3.6, 2.0));',
    '  float strip2 = exp(-pow((dot(R.xy, normalize(vec2(0.70, 0.71))) - 0.30) * 9.0, 2.0));',
    '  float under  = smoothstep(0.1, 0.7, -R.y);',  // warm bounce from below

    // body: deep translucent oxblood that only warms up where light hits it
    '  float thick = clamp(H / 0.2, 0.0, 1.0);',
    '  vec3 body = DEEP * (0.28 + 0.24*thick);',
    '  body += MID * pow(diff, 3.0) * 0.50;',
    '  body += DEEP * under * 0.6;',
    '  vec3 col = body;',
    '  col += mix(ACC, ACC2, fres) * fres * 1.6;',
    '  col += mix(MID, ACC2, 0.55) * strip * (0.25 + 0.75*fres) * 0.9;',
    '  col += mix(ACC, CREAM, 0.4) * strip2 * 0.45;',
    '  col += CREAM * spec * 0.85;',
    '  col += CREAM * pow(strip, 8.0) * 0.55;',
    // crisp rim line hugging the edge of each sheet
    '  float rimL = exp(-max(dEdge, 0.0) * uRes.y * 0.35) * smoothstep(-0.002, 0.002, dEdge);',
    '  col += mix(ACC2, CREAM, 0.45) * rimL * 0.9;',

    // coverage with a slim antialiased edge
    '  float aa = 2.0 / uRes.y;',
    '  float cov = smoothstep(0.0, aa, dEdge);',
    '  float alpha = cov * (0.80 + 0.20*thick);',
    // keep the ribbons quiet where the content sits
    '  vec2 sp = (frag - 0.5*uRes) / uRes.y;',
    '  float calm = (1.0 - smoothstep(uCalm.x * 0.82, uCalm.x, abs(sp.x)))',
    '             * smoothstep(uCalm.y - 0.12, uCalm.y, sp.y) * (1.0 - smoothstep(uCalm.z, uCalm.z + 0.12, sp.y));',
    '  alpha *= 1.0 - uCalm.w * calm;',

    // background: warm black, soft glow behind top-centre, light bleeding from ribbons
    '  vec3 bg = BG;',
    '  vec2 q = (frag - vec2(0.5*uRes.x, 0.88*uRes.y)) / uRes.y;',
    '  bg += vec3(0.10, 0.032, 0.012) * exp(-dot(q*vec2(0.9, 1.6), q*vec2(0.9, 1.6)) * 5.0) * 0.55;',
    '  float bleed = exp(min(dEdge, 0.0) * 9.0) * (1.0 - cov);',
    '  bg += ACC * 0.07 * bleed;',

    '  col = mix(bg, col, alpha);',

    // gentle vignette, then seamless fade to the page colour at the bottom 15%
    '  vec2 vq = uv - 0.5;',
    '  col = mix(col, BG, 0.25 * smoothstep(0.35, 0.75, length(vq*vec2(0.8, 1.0))));',
    '  float fade = smoothstep(0.0, uFade, uv.y);',
    '  col = mix(BG, col, fade);',
    // dither to kill banding (none where we must match the page colour exactly)
    '  col += (hash(frag + fract(t)) - 0.5) / 255.0 * fade;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function isCoarse() {
    return !!(window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches);
  }

  function HeroBG(container) {
    this.el = container;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.gl = null;
    this.prog = null;
    this.loc = {};
    this.raf = 0;
    this.visible = true;
    this.lost = false;
    this.ready = false;
    this.reduced = prefersReducedMotion();
    this.coarse = isCoarse();
    this.start = 0;
    this.elapsed = 0;
    this.last = 0;
    this.mouse = [0, 0];
    this.mouseTarget = [0, 0];
    this.w = 0;
    this.h = 0;
    this.seed = Math.random() * 6.0;
    this.resizeTimer = 0;
    this.scroll = 0;          // set by hero.js while the hero scrolls out
    this.suspended = false;   // hero fully gone: stop drawing
    this.phase = 0.9;
    this.frame = this.frame.bind(this);
  }

  HeroBG.prototype.init = function () {
    var opts = { antialias: false, alpha: false, premultipliedAlpha: false, depth: false,
      stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false };
    var gl = null;
    try {
      gl = this.canvas.getContext('webgl', opts) || this.canvas.getContext('experimental-webgl', opts);
    } catch (e) { gl = null; }
    if (!gl) return false;
    this.gl = gl;
    if (!this.setupGL()) return false;

    this.el.appendChild(this.canvas);
    this.bindEvents();
    this.resize();
    if (this.reduced) {
      this.renderAt(0.9);
    } else {
      this.loop();
    }
    return true;
  };

  HeroBG.prototype.setupGL = function () {
    var gl = this.gl;
    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.prog = prog;
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    var names = ['uRes', 'uT', 'uMouse', 'uHalf', 'uAmp', 'uCalm', 'uFade', 'uW', 'uSeed', 'uTilt', 'uBulge', 'uOff', 'uScroll'];
    for (var i = 0; i < names.length; i++) this.loc[names[i]] = gl.getUniformLocation(prog, names[i]);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    return true;
  };

  HeroBG.prototype.bindEvents = function () {
    var self = this;
    var c = this.canvas;

    c.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      self.lost = true;
      self.stop();
    }, false);
    c.addEventListener('webglcontextrestored', function () {
      self.lost = false;
      self.loc = {};
      if (!self.setupGL()) return;
      self.resize();
      if (self.reduced) self.renderAt(0.9); else self.loop();
    }, false);

    var onResize = function () {
      clearTimeout(self.resizeTimer);
      self.resizeTimer = setTimeout(function () { self.resize(); if (self.reduced) self.renderAt(0.9); }, 120);
    };
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(onResize);
      this.ro.observe(this.el);
    } else {
      window.addEventListener('resize', onResize, { passive: true });
    }

    if (typeof IntersectionObserver === 'function') {
      this.io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) self.visible = entries[i].isIntersecting;
        self.updateRunning();
      }, { threshold: 0 });
      this.io.observe(this.el);
    }

    document.addEventListener('visibilitychange', function () { self.updateRunning(); });

    if (!this.reduced && !this.coarse) {
      window.addEventListener('pointermove', function (e) {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        var vw = window.innerWidth || 1, vh = window.innerHeight || 1;
        self.mouseTarget[0] = Math.max(-1, Math.min(1, (e.clientX / vw) * 2 - 1));
        self.mouseTarget[1] = Math.max(-1, Math.min(1, 1 - (e.clientY / vh) * 2));
      }, { passive: true });
    }

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      var onMq = function () {
        self.reduced = mq.matches;
        if (self.reduced) { self.stop(); self.renderAt(0.9); } else { self.updateRunning(); }
      };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
      else if (mq.addListener) mq.addListener(onMq);
    }
  };

  HeroBG.prototype.resize = function () {
    var gl = this.gl;
    if (!gl || this.lost) return;
    var rect = this.el.getBoundingClientRect();
    var cw = Math.max(1, rect.width), ch = Math.max(1, rect.height);
    var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    var scale = (this.coarse || cw < 760) ? 0.5 : 0.66;
    var w = cw * dpr * scale, h = ch * dpr * scale;
    var longSide = Math.max(w, h);
    if (longSide > MAX_LONG_SIDE) { w *= MAX_LONG_SIDE / longSide; h *= MAX_LONG_SIDE / longSide; }
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.w = w; this.h = h;
    gl.viewport(0, 0, w, h);

    // Layout. Wide screens: two big ribbons on the left/right edges, pushed out
    // around the height of the hero headline. Narrow/portrait screens: ribbons
    // live beyond the side edges, peeking in only at the bottom-left and
    // top-right corners, and are dimmed over the content column.
    var aspect = cw / ch;
    var k = Math.max(0, Math.min(1, (1.25 - aspect) / 0.6));   // 0 = landscape, 1 = portrait
    k = k * k * (3 - 2 * k);
    var mix = function (a, b) { return a + (b - a) * k; };
    var half = aspect * 0.5;
    // the hero content is ~1120px wide: the share of the width it covers drives
    // how far out the ribbons sit and how wide the calm zone is
    var contentFrac = Math.max(0.30, Math.min(0.46, 560 / cw));
    var squeeze = Math.max(0, contentFrac - 0.39);

    gl.uniform2f(this.loc.uRes, w, h);
    gl.uniform1f(this.loc.uHalf, half);
    gl.uniform1f(this.loc.uW, mix(aspect * (0.205 - squeeze * 0.9), aspect * 0.34));
    gl.uniform1f(this.loc.uSeed, this.seed);
    gl.uniform1f(this.loc.uAmp, mix(0.8, 0.45));
    // desktop: the right ribbon is narrow at the top (behind the big word) and
    // widens towards the bottom; the left one does the mirror sweep
    gl.uniform2f(this.loc.uOff, mix(0.0, 0.0), mix(-0.24, 0.0));
    gl.uniform2f(this.loc.uTilt, mix(0.30, 0.55), mix(-0.30, 0.55));
    gl.uniform2f(this.loc.uBulge, mix(0.03, 0.0), mix(0.03, 0.0));
    // calm zone: desktop = content column (14%..86%) around the headline band,
    // portrait = the whole content column
    gl.uniform4f(this.loc.uCalm, mix(aspect * contentFrac, half * 0.84), mix(-0.12, -0.36), mix(0.34, 0.27), mix(0.6, 0.9));
    gl.uniform1f(this.loc.uFade, mix(0.15, 0.07));
  };

  HeroBG.prototype.draw = function (phase) {
    var gl = this.gl;
    if (!gl || this.lost) return;
    this.phase = phase;
    gl.uniform1f(this.loc.uT, phase);
    gl.uniform1f(this.loc.uScroll, this.scroll);
    gl.uniform2f(this.loc.uMouse, this.mouse[0], this.mouse[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!this.ready) {
      this.ready = true;
      var el = this.el;
      // wait one frame so the drawn buffer is composited before the fade starts
      requestAnimationFrame(function () { el.setAttribute('data-ready', 'true'); });
    }
  };

  HeroBG.prototype.renderAt = function (phase) {
    this.mouse[0] = 0; this.mouse[1] = 0;
    this.draw(phase);
  };

  HeroBG.prototype.shouldRun = function () {
    return !this.reduced && !this.lost && !this.suspended && this.visible && !document.hidden;
  };

  HeroBG.prototype.updateRunning = function () {
    if (this.shouldRun()) this.loop(); else this.stop();
  };

  HeroBG.prototype.loop = function () {
    if (this.raf || !this.shouldRun()) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  };

  HeroBG.prototype.stop = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  HeroBG.prototype.frame = function (now) {
    this.raf = 0;
    if (!this.shouldRun()) return;
    var dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.elapsed = (this.elapsed + dt) % LOOP_SECONDS;
    var ease = 1 - Math.exp(-dt * 2.5);
    this.mouse[0] += (this.mouseTarget[0] - this.mouse[0]) * ease;
    this.mouse[1] += (this.mouseTarget[1] - this.mouse[1]) * ease;
    this.draw((this.elapsed / LOOP_SECONDS) * TAU + 0.9);
    this.raf = requestAnimationFrame(this.frame);
  };

  // hero.js drives these while the hero scrolls out
  HeroBG.prototype.setScroll = function (v) {
    this.scroll = v;
    // the loop picks it up on its next frame; when idle (reduced motion) redraw now
    if (!this.raf && !this.suspended && this.ready) this.draw(this.phase);
  };

  HeroBG.prototype.setSuspended = function (on) {
    if (this.suspended === on) return;
    this.suspended = on;
    this.updateRunning();
  };

  var instances = [];

  function boot() {
    var nodes = document.querySelectorAll('[data-hero-webgl]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.getAttribute('data-hero-webgl-init')) continue;
      node.setAttribute('data-hero-webgl-init', '1');
      var inst = new HeroBG(node);
      var ok = false;
      try { ok = inst.init(); } catch (e) { ok = false; }
      if (ok) instances.push(inst);
      else if (inst.canvas.parentNode) inst.canvas.parentNode.removeChild(inst.canvas);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.PasifyHeroBG = { instances: instances, boot: boot };
})();
