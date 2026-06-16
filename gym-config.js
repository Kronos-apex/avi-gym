/* ═══════════════════════════════════════════════════════════════
   gym-config.js — AVI GYM · capa de marca por gimnasio (kernel F1)

   Cada gimnasio es UNA entrada en GYMS: nombre, lema y paleta.
   La app entera lee estos tokens — cero código por gym.

   Selección de gym activo (en orden de prioridad):
     1. URL:           ?gym=forza
     2. localStorage:  avigym_brand (persiste la elección anterior)
     3. default:       'avi'

   Para la demo de ventas: abrir la app con ?gym=forza y mostrar
   "misma app, tu marca". Volver con ?gym=avi.
   ═══════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  const GYMS = {

    /* ── AVI (default) — la marca madre ── */
    avi: {
      id: 'avi',
      name: 'AVI',
      sub: 'Training',                       // palabra bajo el wordmark en el login
      fullName: 'AVI — Entrenamiento Personal',
      tagline: 'Entrenamiento con nombre propio',
      taglineHtml: 'Entrenamiento con <b>nombre propio.</b>',
      // Código que el gym entrega a sus miembros para auto-registrarse (B2B gate).
      // Cámbialo por el que quieras darle a tu gimnasio. Vacío/ausente = registro abierto.
      // El usuario lo escribe ignorando mayúsculas/espacios. (Gate client-side: frena
      // a randoms con el link, no es un candado criptográfico — ver checkGymCode.)
      signupCode: 'AVIGYM-2026',
      colors: null,                          // null = usar los tokens default del CSS (esmeralda AVI)
      dark: null,                            // null = superficies dark default (verde profundo)
      hdrGrad: null                          // null = --emerald-hdr default
    },

    /* ── FORZA (demo ficticio) — para mostrar el cambio de marca en vivo ── */
    forza: {
      id: 'forza',
      name: 'FORZA',
      sub: 'Gym',
      fullName: 'FORZA Gym — Tu entrenamiento',
      tagline: 'La fuerza se entrena',
      taglineHtml: 'La fuerza <b>se entrena.</b>',
      colors: {
        brand:       '#FF5436',  brandRgb: '255,84,54',
        brandStrong: '#FF7A52',  brandSoft: '#FFA38C',
        brandMid:    '#E03A20',  brandGreen: '#C22E16',
        brandDeep:   '#9E2310',  brandDark: '#54100A',
        brandLight:  '#FF8A5B',  brandTint: '#FFE4DC',
        onBrand:     '#2B0A04',
        ink1: '#1F0E0A',  ink2: '#140805',
        hdr1: '#1A0B07',  hdr2: '#3C140C',  hdr3: '#5C1F10',
        gold: '#F2C94C',  gold2: '#E8C547',  gold3: '#E9C46A'
      },
      dark: {
        bg: '#1C100C',  w: '#2A1712',  br: '#3D211A',  br2: '#4F2E25',
        t1: '#F4EBE8',  t2: '#B59A92',  t3: '#7A5950',  gl: '#33150E'
      }
    }
  };

  /* ── selección del gym activo ── */
  const LS_KEY = 'avigym_brand';
  let pick = null;
  try {
    const qs = new URLSearchParams(location.search).get('gym');
    if (qs && GYMS[qs]) { pick = qs; localStorage.setItem(LS_KEY, qs); }
    if (!pick) { const saved = localStorage.getItem(LS_KEY); if (saved && GYMS[saved]) pick = saved; }
  } catch(e) { /* storage bloqueado: cae al default sin romper el boot */ }

  const CFG = GYMS[pick || 'avi'];
  window.GYM_CONFIG = CFG;
  window.GYM_LIST = Object.keys(GYMS);

  /* exponer la marca del gym activo al Service Worker: el push handler corre
     sin acceso a este script (app cerrada), así que cacheamos el nombre para
     usarlo como título de respaldo white-label en vez de un valor quemado. */
  try {
    if (typeof caches !== 'undefined') {
      caches.open('avigym-brand').then(c =>
        c.put('brand', new Response(JSON.stringify({ name: CFG.name }),
          { headers: { 'Content-Type': 'application/json' } }))
      ).catch(() => {});
    }
  } catch (e) { /* http inseguro / storage bloqueado: el SW cae a fallback neutro */ }

  /* ── media por gym ──────────────────────────────────────────────
     Set NEUTRO compartido (sin texto/logo quemado): el color de cada
     gym lo tiñe por encima vía los gradientes de marca del CSS.
     Cada gym puede sobrescribir cualquier clave con `media:{…}`.
     heroVideo:'' = solo póster (el montaje AVI tenía marca quemada).
     TODO: cuando exista media/base/* (set neutro), apuntar aquí.        */
  const MEDIA_DEFAULTS = {
    loading:   'media/base/loading.jpg',
    hero:      'media/base/hero.jpg',
    heroVideo: '',                          // sin video: el montaje AVI tenía marca quemada; queda el póster neutro
    ob1:       'media/base/ob-1.jpg',
    ob2:       'media/base/ob-2.jpg',
    ob3:       'media/base/ob-3.jpg',
    reveal:    'media/base/reveal.jpg',
    icon192:   'icons/icon-192.png',
    icon512:   'icons/icon-512.png'
  };
  const M = Object.assign({}, MEDIA_DEFAULTS, CFG.media || {});
  window.GYM_MEDIA = M;

  /* ── 1. colores: inmediato (antes del primer paint, evita flash esmeralda) ── */
  const R = document.documentElement.style;
  const C = CFG.colors;
  if (C) {
    const map = {
      '--brand': C.brand, '--brand-rgb': C.brandRgb, '--brand-strong': C.brandStrong,
      '--brand-soft': C.brandSoft, '--brand-mid': C.brandMid, '--brand-green': C.brandGreen,
      '--brand-deep': C.brandDeep, '--brand-dark': C.brandDark, '--brand-light': C.brandLight,
      '--brand-tint': C.brandTint, '--on-brand': C.onBrand,
      '--ink-1': C.ink1, '--ink-2': C.ink2,
      '--hdr-1': C.hdr1, '--hdr-2': C.hdr2, '--hdr-3': C.hdr3,
      '--gold': C.gold, '--gold-2': C.gold2, '--gold-3': C.gold3
    };
    for (const k in map) if (map[k]) R.setProperty(k, map[k]);
  }
  if (CFG.dark) {
    const D = CFG.dark;
    const dmap = { '--d-bg': D.bg, '--d-w': D.w, '--d-br': D.br, '--d-br2': D.br2,
                   '--d-t1': D.t1, '--d-t2': D.t2, '--d-t3': D.t3, '--d-gl': D.gl };
    for (const k in dmap) if (dmap[k]) R.setProperty(k, dmap[k]);
  }
  if (CFG.hdrGrad) R.setProperty('--emerald-hdr', CFG.hdrGrad);

  /* media → CSS vars (las usa el loading screen, .wohero y el onboarding) */
  R.setProperty('--media-loading', "url('" + M.loading + "')");
  R.setProperty('--media-ob1', "url('" + M.ob1 + "')");
  R.setProperty('--media-ob2', "url('" + M.ob2 + "')");
  R.setProperty('--media-ob3', "url('" + M.ob3 + "')");

  /* ── 2. textos: al tener DOM (title, metas, wordmarks, lemas) ── */
  function applyText(){
    try {
      document.title = CFG.fullName;
      const metas = {
        'meta[name="application-name"]': CFG.name,
        'meta[name="apple-mobile-web-app-title"]': CFG.name,
        'meta[property="og:title"]': CFG.fullName,
        'meta[name="twitter:title"]': CFG.fullName
      };
      for (const sel in metas) { const m = document.querySelector(sel); if (m) m.setAttribute('content', metas[sel]); }
      document.querySelectorAll('[data-gym-name]').forEach(el => { el.textContent = CFG.name; });
      document.querySelectorAll('[data-gym-sub]').forEach(el => { el.textContent = CFG.sub || ''; });
      document.querySelectorAll('[data-gym-tagline]').forEach(el => { el.textContent = CFG.tagline; });
      document.querySelectorAll('[data-gym-tagline-html]').forEach(el => { el.innerHTML = CFG.taglineHtml || CFG.tagline; });
      document.querySelectorAll('[data-gym-lema]').forEach(el => { el.textContent = '«' + CFG.tagline + '»'; });
      // video cinematográfico del login: póster + fuente por gym (sin video => solo póster)
      const v = document.querySelector('#s-login video.cin-vid');
      if (v) {
        if (M.hero) v.setAttribute('poster', M.hero);
        if (M.heroVideo) { if (v.getAttribute('src') !== M.heroVideo) { v.setAttribute('src', M.heroVideo); v.load && v.load(); } }
        else { v.removeAttribute('src'); v.load && v.load(); }   // solo póster
      }
    } catch(e) { console.warn('GYM_CONFIG textos:', e && e.message); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyText);
  else applyText();
})();
