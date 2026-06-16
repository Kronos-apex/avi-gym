// avi-core.js — Lógica de negocio pura de AVI (sin DOM, sin globals de app)
// ─────────────────────────────────────────────────────────────────────
// FUENTE ÚNICA DE VERDAD para la lógica crítica testeable.
//
// Se carga en index.html como <script src="avi-core.js"></script> ANTES
// del script principal, por lo que estas funciones quedan disponibles como
// globales del navegador. También se exporta con module.exports para que
// avi.test.js pruebe ESTE archivo (no una copia).
//
// REGLA: si tocas una de estas funciones, los tests reflejan el cambio
// automáticamente. No dupliques esta lógica dentro de index.html.
// ─────────────────────────────────────────────────────────────────────
'use strict';

// ── ICC — etiqueta de riesgo por sexo ──
// Umbral masculino [0.90, 0.95], femenino [0.80, 0.85].
function getIccLabel(v, sex) {
  const lim = sex === 'M' ? [0.90, 0.95] : [0.80, 0.85];
  if (v < lim[0]) return { label: 'Distribución favorable', color: 'var(--g2)' };
  if (v < lim[1]) return { label: 'Riesgo moderado', color: 'var(--yl)' };
  return { label: 'Distribución de riesgo', color: 'var(--rd)' };
}

// ── Código de sexo normalizado ('M' / 'F') ──
function getSexCode(sex) {
  return sex === 'M' ? 'M' : 'F';
}

// ── Macros sugeridos a partir del cliente ──
function calcMacrosSugeridos(client) {
  const kg = parseFloat(client.weight) || 70;
  const actMap = { 1.2: 30, 1.375: 33, 1.55: 36, 1.725: 40, 1.9: 44 };
  const kcalPerKg = actMap[client.activityFactor] || 33;
  let kcal = Math.round(kg * kcalPerKg);
  const g = (client.goal || '').toLowerCase();
  if (g.includes('perd') || g.includes('baj') || g.includes('defin')) kcal -= 350;
  else if (g.includes('gan') || g.includes('masa') || g.includes('volum') || g.includes('musc')) kcal += 250;
  const protG = g.includes('gan') || g.includes('masa') || g.includes('musc')
    ? Math.round(kg * 2.2)
    : g.includes('perd') || g.includes('baj')
      ? Math.round(kg * 2.0)
      : Math.round(kg * 1.8);
  const fatG = Math.round(kg * 0.9);
  const carbsG = Math.max(0, Math.round((kcal - protG * 4 - fatG * 9) / 4));
  const water = Math.max(6, Math.round(kg * 0.035 / 0.25));
  return { kcal, prot: protG, carbs: carbsG, fat: fatG, water };
}

// ── Migración: asigna .id a rutinas que no lo tengan ──
// idFn: generador de ids (el navegador pasa uid(); fallback incluido para tests).
function migrateRoutineIds(clients, idFn) {
  const genId = idFn || (() => Date.now().toString(36) + Math.random().toString(36).slice(2));
  let migrated = false;
  (clients || []).forEach(c => {
    (c.routines || []).forEach(r => {
      if (!r.id) { r.id = genId(); migrated = true; }
    });
  });
  return migrated;
}

// ── Push: ¿debe enviarse el POST de suscripción? ──
// true si el endpoint guardado difiere del actual (suscripción nueva o renovada).
// Guard contra reenvíos duplicados que rompieron las notificaciones (2026-05-25).
function shouldPostPush(storedEndpoint, newEndpoint) {
  return storedEndpoint !== newEndpoint;
}

// ── delClient: guard de confirmación ──
// true solo si hay cliente Y el usuario confirma.
function delClientGuard(client, confirmFn) {
  if (!client || !confirmFn()) return false;
  return true;
}

// ── cn-today: guard de re-render (muta CUR.todayRenderedDay) ──
// true (y actualiza CUR) solo si hay cliente y cambió el día.
function cnTodayGuard(CUR, todayLabel, clientExists) {
  if (clientExists && CUR.todayRenderedDay !== todayLabel) {
    CUR.todayRenderedDay = todayLabel;
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════
// AUTO-GENERADOR DE RUTINAS (Paso 1) — ver docs/auto-generador-rutinas.md
// ─────────────────────────────────────────────────────────────────────
// Produce un BORRADOR completo de la semana a partir del perfil del cliente.
// El coach SIEMPRE revisa/aprueba (innegociable por seguridad). Función pura,
// sin DOM. Config en objetos (splits/slots/scheme/exclusiones) → fácil de tunear.
// ─────────────────────────────────────────────────────────────────────

// Normaliza texto: minúsculas + sin acentos (para matching robusto de notas/nombres).
function _norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Etiquetas de día (1..6) y nombres legibles de cada bloque.
const GEN_DAY_LABELS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Plantillas de bloque: cada slot = [muscle, type|null, n]. type null = cualquiera de ese músculo.
const GEN_DAYS = {
  FULL_BODY:      { name: 'Full Body', slots: [['piernas', 'Compuesto', 1], ['pecho', 'Compuesto', 1], ['espalda', 'Compuesto', 1], ['hombros', 'Compuesto', 1], ['core', null, 1]] },
  GP_A:           { name: 'Glúteo y Piernas A', slots: [['gluteo', 'Compuesto', 2], ['piernas', 'Compuesto', 1], ['gluteo', 'Aislamiento', 1], ['piernas', 'Aislamiento', 2], ['core', null, 1]] },
  GP_B:           { name: 'Glúteo y Piernas B', slots: [['piernas', 'Compuesto', 2], ['gluteo', 'Compuesto', 1], ['gluteo', 'Aislamiento', 2], ['piernas', 'Aislamiento', 1], ['core', null, 1]] },
  TREN_SUP:       { name: 'Tren Superior', slots: [['pecho', 'Compuesto', 1], ['espalda', 'Compuesto', 1], ['hombros', 'Compuesto', 1], ['biceps', 'Aislamiento', 1], ['triceps', 'Aislamiento', 1]] },
  EMP_BRAZOS:     { name: 'Empuje y Brazos', slots: [['pecho', 'Compuesto', 1], ['hombros', 'Compuesto', 1], ['triceps', 'Aislamiento', 2], ['biceps', 'Aislamiento', 2]] },
  CORE_CARDIO:    { name: 'Core y Cardio', slots: [['core', null, 2], ['cardio', null, 2]] },
  EMPUJE:         { name: 'Empuje', slots: [['pecho', 'Compuesto', 2], ['hombros', 'Compuesto', 1], ['pecho', 'Aislamiento', 1], ['hombros', 'Aislamiento', 1], ['triceps', 'Aislamiento', 2]] },
  TRACCION:       { name: 'Tracción', slots: [['espalda', 'Compuesto', 2], ['espalda', 'Aislamiento', 1], ['hombros', 'Aislamiento', 1], ['biceps', 'Aislamiento', 2]] },
  PIERNA:         { name: 'Pierna', slots: [['piernas', 'Compuesto', 2], ['piernas', 'Funcional', 1], ['piernas', 'Aislamiento', 2], ['gluteo', 'Aislamiento', 1], ['core', null, 1]] },
  HOMBROS_BRAZOS: { name: 'Hombros y Brazos', slots: [['hombros', 'Compuesto', 1], ['hombros', 'Aislamiento', 2], ['biceps', 'Aislamiento', 2], ['triceps', 'Aislamiento', 2]] },
  CARDIO_CORE:    { name: 'Cardio y Core', slots: [['cardio', null, 2], ['core', null, 2]] },
};

// Splits por sexo + días (regla de Andrés: mujer→glúteo/pierna primero; hombre→tren sup/fuerza).
const GEN_SPLITS = {
  F: {
    3: ['GP_A', 'TREN_SUP', 'GP_B'],
    4: ['GP_A', 'TREN_SUP', 'GP_B', 'CORE_CARDIO'],
    5: ['GP_A', 'TREN_SUP', 'GP_B', 'EMP_BRAZOS', 'CORE_CARDIO'],
    6: ['GP_A', 'TREN_SUP', 'GP_B', 'GP_A', 'TREN_SUP', 'GP_B'],
  },
  M: {
    3: ['EMPUJE', 'TRACCION', 'PIERNA'],
    4: ['EMPUJE', 'TRACCION', 'PIERNA', 'TREN_SUP'],
    5: ['EMPUJE', 'PIERNA', 'TRACCION', 'HOMBROS_BRAZOS', 'CARDIO_CORE'],
    6: ['EMPUJE', 'PIERNA', 'TRACCION', 'EMPUJE', 'PIERNA', 'TRACCION'],
  },
};

// Detección de limitaciones físicas en `notes` (lo que hace Laura, codificado).
const GEN_LIMIT_KWS = [
  { zone: 'rodilla', re: /rodilla|menisco|patela|rotula|ligamento|\blca\b|\blcl\b/ },
  { zone: 'lumbar', re: /lumbar|espalda baja|lumbalgia|hernia|ciatic|disco|escolios/ },
  { zone: 'hombro', re: /hombro|manguito|rotador|deltoid/ },
  { zone: 'generic', re: /lesion|operad|postoperat|posoperat|tendon|cirugia|protesis|fractura/ },
];
const GEN_ZONE_LABEL = { rodilla: 'rodilla', lumbar: 'zona lumbar', hombro: 'hombro', generic: 'lesión/postoperatorio' };
// Ejercicios a EXCLUIR por zona (match contra nombre normalizado). Preferimos variantes seguras
// dejando que el fallback elija otras del mismo músculo.
const GEN_ZONE_EXCL = {
  rodilla: /sentadilla|zancada|estocada|salto|pistol|bulgara/,
  lumbar: /peso muerto|remo con barra|buenos dias|hiperexten|sentadilla/,
  hombro: /tras ?nuca|trasnuca|fondos|militar con barra/,
};

// Parsea las notas del cliente → limitaciones detectadas. Exportada para tests.
function parseLimitations(notes) {
  const n = _norm(notes);
  const keys = [];
  GEN_LIMIT_KWS.forEach(k => { if (k.re.test(n)) keys.push(k.zone); });
  const uniq = [...new Set(keys)];
  const detected = uniq.length > 0;
  // Solo rodilla/lumbar/hombro tienen reglas de exclusión. Una limitación "genérica"
  // (p.ej. "operado", "cirugía" sin nombrar zona) se DETECTA pero NO excluye nada:
  // el mensaje no debe prometer una exclusión que no ocurrió (lo arregla la auditoría 2026-06-01).
  const hasExclusions = uniq.some(z => GEN_ZONE_EXCL[z]);
  return {
    detected,
    keys: uniq,
    zones: [...new Set(uniq.map(z => GEN_ZONE_LABEL[z]))],
    hasExclusions,
    advice: !detected ? ''
      : hasExclusions ? 'Se excluyeron ejercicios contraindicados y se priorizaron variantes seguras.'
      : 'Limitación sin zona específica: NO se excluyó ningún ejercicio automáticamente. Revísala y ajústala a mano antes de aprobar.',
  };
}

// Scheme de series/reps/descanso según objetivo (regla de Andrés §2.4) + nivel.
// `adaptation`: si es true (principiante en sus primeras semanas) sobrescribe el
// esquema del objetivo por una FASE DE ADAPTACIÓN ANATÓMICA — ver isInAdaptation().
function genSchemeFor(goal, level, adaptation) {
  const g = _norm(goal);
  let base;
  if (g.includes('perder') || g.includes('grasa') || g.includes('defin')) base = { reps: 14, sets: [3, 4], rest: 55, cardioClose: true };
  else if (g.includes('ganar') || g.includes('masa') || g.includes('musc') || g.includes('volum')) base = { reps: 10, sets: [3, 4], rest: 90 };
  else if (g.includes('recomp')) base = { reps: 12, sets: [3, 4], rest: 70, coreClose: true };
  else if (g.includes('fuerza')) base = { reps: 6, sets: [4, 5], rest: 120 };
  else if (g.includes('resist')) base = { reps: 18, sets: [3, 4], rest: 45, cardioClose: true };
  else base = { reps: 12, sets: [3, 3], rest: 60 }; // salud general / default
  const [lo, hi] = base.sets;
  const setsN = level === 'Principiante' ? Math.min(lo, 3) : level === 'Avanzado' ? hi : Math.min(hi, 4);
  const scheme = { setsN, repsN: base.reps, restSec: base.rest, cardioClose: !!base.cardioClose, coreClose: !!base.coreClose };
  // Fase de adaptación: reps altas (mín. 15; la nota indica 15-20) con poco o nada de
  // peso, descanso corto, técnica primero. Sobrescribe el objetivo SIN importar cuál sea
  // (primero el cuerpo aprende el patrón, luego progresamos cargas).
  if (adaptation) {
    scheme.setsN = 3;
    scheme.repsN = 15;
    scheme.restSec = 60;
    scheme.adaptation = true;
  }
  return scheme;
}

// ── Fase de adaptación: ¿el cliente está en sus primeras semanas de entreno? ──
// Solo aplica a principiantes. La ventana arranca cuando EMPIEZAN a entrenar:
// usa client.startDate si existe, si no la primera sesión registrada, si no la fecha
// de alta; sin ninguna referencia → recién empieza (en adaptación). Default 21 días.
const ADAPT_DAYS = 21;
function trainingStartTs(client, history) {
  client = client || {};
  if (client.startDate) return new Date(client.startDate).getTime();
  const sess = (history && history[client.id]) || [];
  let first = Infinity;
  sess.forEach(s => { const t = new Date(s.date).getTime(); if (t < first) first = t; });
  if (first !== Infinity) return first;
  if (client.createdAt) return new Date(client.createdAt).getTime();
  return null;
}
function isInAdaptation(client, history, now, adaptDays) {
  client = client || {};
  if ((client.level || 'Principiante') !== 'Principiante') return false;
  const start = trainingStartTs(client, history);
  if (start == null) return true; // sin historial ni fecha → semana 1
  const ref = (now ? new Date(now) : new Date()).getTime();
  return (ref - start) < (adaptDays || ADAPT_DAYS) * 86400000;
}

// ── Peso sugerido por PR (estimación de 1RM, fórmula de Epley) ──
// No se hacen tests de máximos (peligrosos para principiantes): el 1RM se ESTIMA
// desde cualquier serie registrada (kg × reps). Epley: 1RM ≈ kg·(1 + reps/30).
// Confiable hasta ~12-15 reps; fuera de ese rango devolvemos null (mejor no sugerir
// que sugerir mal). Es una guía: el coach y la sensación del asesorado mandan.
function estimate1RM(kg, reps) {
  kg = parseFloat(kg); reps = parseInt(reps);
  if (!kg || kg <= 0 || !reps || reps < 1 || reps > 15) return null;
  if (reps === 1) return kg;
  return kg * (1 + reps / 30);
}
// Inversa de Epley: peso para un objetivo de reps, con factor conservador (default
// 0.95 — es sugerencia de trabajo, no reto) y redondeo a discos reales (step 2.5kg).
function suggestLoad(e1rm, targetReps, opts) {
  opts = opts || {};
  e1rm = parseFloat(e1rm); targetReps = parseInt(targetReps);
  if (!e1rm || e1rm <= 0 || !targetReps || targetReps < 1 || targetReps > 15) return null;
  const base = targetReps === 1 ? e1rm : e1rm / (1 + targetReps / 30);
  const raw = base * (opts.factor != null ? opts.factor : 0.95);
  const step = opts.step || 2.5;
  const kg = Math.round(raw / step) * step;
  return kg > 0 ? kg : null;
}
// Desde un PR guardado ({val|kg, reps, unit:'kg'}) → kg sugeridos para targetReps.
// Solo aplica a modalidad de peso; PRs en reps/seg/min no estiman 1RM.
function suggestFromPR(pr, targetReps, opts) {
  if (!pr || (pr.unit || 'kg') !== 'kg') return null;
  const kg = pr.val != null ? pr.val : pr.kg;
  const e1 = estimate1RM(kg, pr.reps || 1);
  return e1 ? suggestLoad(e1, targetReps, opts) : null;
}

// ── Perfil de carga corporal: ¿conviene priorizar máquina/asistido y bajo impacto? ──
// Señales: IMC (peso/estatura²) y relación cintura-talla (RCT = cintura/estatura, el
// mismo indicador que ya usa la app). Devuelve 'high' cuando IMC≥30 (obesidad) o
// RCT≥0.60 (riesgo elevado); si no, 'normal'. Mover más masa hace el peso corporal y
// el impacto articular más exigentes, así que en 'high' el generador prefiere variantes
// guiadas y evita pliométricos. OJO: el IMC no distingue músculo de grasa — por eso la
// cintura, cuando existe, puede subir el perfil. Es una guía, no diagnóstico clínico.
function bmiFrom(weightKg, heightCm) {
  const w = parseFloat(weightKg), h = parseFloat(heightCm);
  if (!w || !h) return null;
  const m = h > 3 ? h / 100 : h; // tolera cm (168) o m (1.68)
  return w / (m * m);
}
function bodyLoadProfile(client, waistCm) {
  client = client || {};
  const bmi = bmiFrom(client.weight, client.height);
  const waist = parseFloat(waistCm);
  const h = parseFloat(client.height);
  const rct = (waist && h) ? waist / (h > 3 ? h : h * 100) : null; // cintura/estatura, ambos en cm
  if ((bmi != null && bmi >= 30) || (rct != null && rct >= 0.60)) return 'high';
  return 'normal';
}

// ¿El ejercicio se trackea sin peso (cardio/hiit/isométrico)? → conserva sets/reps de biblioteca.
function _genKeepNatural(ex) {
  return ex.muscle === 'cardio' || /cardio|hiit/i.test(ex.type || '') || ex.type === 'Isométrico';
}

// Copia enriquecida del ejercicio para la rutina (§2.6 CRÍTICO: id+icon+muscle+type siempre).
function _genMaterialize(ex, scheme) {
  const c = { ...ex };
  c.icon = ex.icon || '💪';
  if (_genKeepNatural(ex)) {
    c.sets = parseInt(ex.sets) || scheme.setsN; // reps natural (minutos/segundos/rondas)
  } else {
    c.sets = scheme.setsN;
    c.reps = scheme.repsN;
  }
  return c;
}

// Orden §2.5: Compuesto → Funcional → Aislamiento → Cardio/Core al final (sort estable).
function _genRank(e) {
  if (e.muscle === 'cardio' || e.muscle === 'core' || _genKeepNatural(e)) return 5;
  if (e.type === 'Compuesto') return 1;
  if (e.type === 'Funcional') return 2;
  return 3; // Aislamiento / Bodyweight
}

// Selector con rotación: avanza un cursor por (muscle|type) para que A y B no salgan idénticos.
// Cae a "solo músculo" si el slot exacto (type) está agotado o vacío (ej. Funcional escaso).
// ── NIVEL DE DIFICULTAD POR EJERCICIO (id → P/I/A) ──────────────────────
// Borrador aprobado por Camilo (2026-06-14). Gobierna el gate del generador:
// un Principiante NUNCA recibe movimientos avanzados (sentadilla a una pierna,
// dominadas, rueda abdominal, flexión pica, fondos…). Editable. Un ejercicio con
// `level` propio manda sobre este mapa; lo no listado cae a 'I' por seguridad.
const EX_LEVEL = {
  e1:'I',e2:'I',e110:'I',e3:'P',e71:'I',e84:'P',e85:'P',e86:'P',e111:'P',e112:'I',e77:'P',e78:'P',e113:'P',e83:'I',
  e4:'A',e5:'I',e6:'P',e24:'P',e25:'P',e26:'P',e27:'P',e28:'P',e34:'A',e50:'A',e51:'P',e52:'P',e104:'P',e114:'P',e116:'I',e137:'I',e82:'P',
  e7:'I',e8:'P',e21:'P',e22:'I',e23:'P',e53:'P',e54:'P',e97:'A',e98:'P',e99:'P',e100:'P',e109:'P',e115:'P',e117:'P',e118:'I',e119:'P',e138:'P',
  e9:'P',e10:'P',e29:'P',e55:'P',e56:'P',e101:'P',e102:'P',e103:'A',e120:'P',e121:'P',e139:'P',e140:'P',
  e11:'P',e12:'I',e19:'A',e30:'P',e31:'P',e57:'I',e105:'P',e122:'P',e123:'A',e79:'P',
  e13:'I',e14:'I',e15:'P',e16:'P',e33:'P',e35:'I',e36:'P',e37:'P',e39:'P',e40:'A',e41:'I',e58:'P',e59:'P',e70:'P',e80:'P',e93:'P',e95:'A',e107:'P',e108:'A',e124:'I',e125:'I',e126:'P',e127:'A',e128:'P',
  e42:'I',e43:'P',e44:'P',e45:'P',e60:'P',e46:'I',e61:'P',e73:'P',e87:'P',e88:'P',e89:'P',e90:'P',e91:'P',e92:'I',e94:'P',e96:'P',e106:'I',e129:'P',e130:'P',
  e17:'P',e18:'P',e47:'A',e48:'A',e49:'P',e62:'P',e63:'I',e72:'P',e81:'I',e131:'P',e132:'P',e133:'P',e134:'P',
  e20:'P',e64:'P',e65:'P',e66:'I',e67:'P',e74:'A',e75:'A',e76:'I',e135:'P',
  e68:'I',e69:'A',e136:'P',
};
const _LVL_RANK = { P: 0, I: 1, A: 2 };
function exLevel(ex) {
  const v = (ex && (ex.level || EX_LEVEL[ex.id])) || 'I';
  return (v === 'P' || v === 'I' || v === 'A') ? v : 'I';
}
function exLevelRank(ex) { return _LVL_RANK[exLevel(ex)]; }
// Tope de nivel + preferencia según el perfil. Principiante: P primero, I solo como
// respaldo cuando un músculo no tiene opción P, NUNCA A. Intermedio: P+I. Avanzado: todo.
function _levelGate(level) {
  if (level === 'Avanzado') return { cap: 2, preferP: false };
  if (level === 'Intermedio') return { cap: 1, preferP: false };
  return { cap: 1, preferP: true };
}

function _genPick(lib, muscle, type, st) {
  const cap = st.levelCap == null ? 2 : st.levelCap;
  const ok = e => e.muscle === muscle && !st.exclude(e)
    && exLevelRank(e) <= cap // gate por nivel: el ejercicio no puede exceder el tope del cliente
    && (!st.tier || (e.tier || 'premium') === st.tier)
    && (e.env || ['gym']).includes(st.place); // entorno: el ejercicio debe ser realizable ahí
  // Pools en orden de prioridad. Se usa el primero que tenga algo sin usar hoy:
  //  1) methodBias (ej. calistenia → peso corporal) ANTES que el tipo del slot,
  //  2) tipo exacto del slot, 3) fallback solo-músculo (cuando el tipo está agotado/vacío).
  // `extra` permite anteponer una tanda más estricta (ej. solo-Principiante) antes de la normal.
  const addTier = extra => {
    if (st.preferType) pools.push(lib.filter(e => ok(e) && e.type === st.preferType && extra(e)));
    // Perfil de carga 'high' (IMC/cintura altos): prioriza variantes guiadas/asistidas
    // (máquina, polea, prensa…) DENTRO del tipo del slot, antes de las libres.
    if (st.preferName) pools.push(lib.filter(e => ok(e) && (type ? e.type === type : true) && st.preferName.test(_norm(e.name)) && extra(e)));
    pools.push(lib.filter(e => ok(e) && (type ? e.type === type : true) && extra(e)));
    pools.push(lib.filter(e => ok(e) && extra(e)));
  };
  const pools = [];
  // Principiante: agota TODAS las opciones de nivel P antes de permitir Intermedio.
  if (st.preferP) addTier(e => exLevelRank(e) === 0);
  addTier(() => true);
  let pool = null;
  for (const p of pools) { if (p.some(e => !st.usedInDay.has(e.id))) { pool = p; break; } }
  if (!pool) {
    // Sin NINGUNA opción de este músculo en este entorno → hueco real (lo reporta al coach).
    if (st.envShortfall && !lib.some(ok)) st.envShortfall.add(muscle);
    return null;
  }
  const key = muscle + '|' + (type || '*');
  const start = st.cursors[key] != null ? st.cursors[key] : (st.seed % pool.length);
  for (let i = 0; i < pool.length; i++) {
    const cand = pool[(start + i) % pool.length];
    if (!st.usedInDay.has(cand.id)) {
      st.cursors[key] = (start + i + 1) % pool.length;
      st.usedInDay.add(cand.id);
      return cand;
    }
  }
  return null; // todo el pool ya está usado en este día
}

// Movimientos guiados/asistidos (cargan parte del peso o estabilizan) — se prefieren
// cuando el perfil de carga es alto. Patrones en minúsculas SIN tilde (van contra _norm).
const GEN_ASSISTED_RE = /maquina|polea|cable|prensa|smith|hack|peck|contractora|hammer|multipower|jaca|asistid|guiad|sentado|banda/;
// Alto impacto / pliométrico: se evita con perfil de carga alto (más masa = más estrés articular).
const GEN_HIIMPACT_RE = /salto|jump|burpee|pliometr|plyo|sprint|saltar|box jump|tijera saltada|skipping/;

// Excluder combinado: carga axial con barra para menores + contraindicaciones por zona
// + (perfil de carga alto) alto impacto/pliométrico.
function _genMakeExcluder(lim, minor, avoidHighImpact) {
  const res = [];
  if (minor) res.push(/sentadilla|peso muerto|militar con barra/); // §2.2 <16: sin carga axial con barra (incluye press de barra sobre la cabeza)
  if (avoidHighImpact) res.push(GEN_HIIMPACT_RE);
  lim.keys.forEach(z => { if (GEN_ZONE_EXCL[z]) res.push(GEN_ZONE_EXCL[z]); });
  return ex => { const n = _norm(ex.name); return res.some(re => re.test(n)); };
}

// Resuelve la lista de bloques (split). Principiante/<16/≤2 días → Full Body.
function _genResolveSplit(sexKey, days, level, minor) {
  if (minor || level === 'Principiante' || days <= 2) return Array(Math.max(1, days)).fill('FULL_BODY');
  return (GEN_SPLITS[sexKey] && GEN_SPLITS[sexKey][days]) || Array(days).fill('FULL_BODY');
}

// ── API principal: genera el borrador de rutinas de la semana ──
// client: {sex,age,level,days,goal,notes}. lib: DB.exercises. opts: {idFn,now,seed,tier}.
// Devuelve { routines:[...], needsReview:bool, limitations:{...} }.
function generarRutinas(client, lib, opts) {
  client = client || {};
  opts = opts || {};
  lib = (lib || []).filter(e => e && e.id && e.muscle);
  const idFn = opts.idFn || (() => Date.now().toString(36) + Math.random().toString(36).slice(2));
  const now = opts.now || new Date().toISOString();
  const days = Math.max(1, Math.min(6, parseInt(client.days) || 3));
  const level = client.level || 'Principiante';
  const age = parseInt(client.age) || null;
  const minor = age != null && age < 16;
  const sexKey = client.sex === 'F' ? 'F' : 'M'; // sexo desconocido → PPL neutro (M)
  const scheme = genSchemeFor(client.goal || '', level, opts.adaptation);
  const lim = parseLimitations(client.notes || '');
  const place = opts.place || client.place || 'gym'; // entorno de equipo (Fase C)
  const methodBias = opts.methodBias || null;        // del estilo/preset (calistenia/funcional/...)
  const loadProfile = opts.loadProfile === 'high' ? 'high' : 'normal'; // por IMC/cintura (ver bodyLoadProfile)
  const highLoad = loadProfile === 'high';
  const _gate = _levelGate(level); // tope/preferencia de dificultad por perfil (Principiante NUNCA recibe avanzados)
  const st = {
    cursors: {}, seed: opts.seed || 0, tier: opts.tier || null, place,
    levelCap: _gate.cap, preferP: _gate.preferP,
    preferType: methodBias === 'calistenia' ? 'Bodyweight' : methodBias === 'funcional' ? 'Funcional' : null,
    preferName: highLoad ? GEN_ASSISTED_RE : null, // perfil alto → variantes guiadas/asistidas primero
    scheme, usedInDay: new Set(), exclude: _genMakeExcluder(lim, minor, highLoad), envShortfall: new Set(),
  };

  const codes = _genResolveSplit(sexKey, days, level, minor);
  const nameCount = {};
  const routines = codes.map((code, idx) => {
    const tpl = GEN_DAYS[code] || GEN_DAYS.FULL_BODY;
    st.usedInDay = new Set();
    let exs = [];
    tpl.slots.forEach(([muscle, type, n]) => {
      for (let i = 0; i < n; i++) {
        const ex = _genPick(lib, muscle, type, st);
        if (ex) exs.push(_genMaterialize(ex, scheme));
      }
    });
    // Cierre por objetivo (§2.4): + cardio/HIIT o + core, si el día no lo trae ya.
    if (scheme.cardioClose && !exs.some(e => e.muscle === 'cardio')) {
      const f = _genPick(lib, 'cardio', null, st); if (f) exs.push(_genMaterialize(f, scheme));
    }
    if (scheme.coreClose && !exs.some(e => e.muscle === 'core')) {
      const f = _genPick(lib, 'core', null, st); if (f) exs.push(_genMaterialize(f, scheme));
    }
    exs = exs.slice().sort((a, b) => _genRank(a) - _genRank(b));

    let nm = tpl.name;
    nameCount[nm] = (nameCount[nm] || 0) + 1;
    if (nameCount[nm] > 1) nm += ' ' + nameCount[nm];
    const note = lim.detected
      ? `⚠️ REVISAR — limitación detectada (${lim.zones.join(', ')}). ${lim.advice} Ajusta antes de aprobar.`
      : scheme.adaptation
      ? '🌱 Fase de adaptación (primeras semanas): 15-20 reps con poco o nada de peso, sin llegar al fallo. La técnica primero; las cargas suben cuando el patrón esté limpio.'
      : 'Borrador generado automáticamente. Revisa y ajusta antes de asignar.';
    return {
      id: idFn(), name: nm, day: GEN_DAY_LABELS[idx] || ('Día ' + (idx + 1)), shift: null,
      note, why: client.goal || '', restSec: scheme.restSec, exercises: exs,
      createdAt: now, generated: true, reviewed: false, needsReview: lim.detected,
    };
  });
  return { routines, needsReview: lim.detected, limitations: lim, place, envGaps: [...st.envShortfall], adaptation: !!scheme.adaptation, loadProfile };
}

// ═══════════════════════════════════════════════════════════════════════
// ENTORNOS DE EQUIPO (env) — ver docs/estilos-y-entornos.md (Fase A)
// ─────────────────────────────────────────────────────────────────────
// Eje INDEPENDIENTE de `goal` y de `tier`. Responde: ¿dónde/con qué se hace?
// Heurístico por nombre+tipo: PROPONE, el coach valida (no es exacto).
// Regla de compatibilidad: lo 'corporal' sirve en todos; 'casa'/'parque' también en 'gym'.
// ─────────────────────────────────────────────────────────────────────
const ENV_ALL = ['corporal', 'casa', 'parque', 'gym'];

function inferExerciseEnv(ex) {
  ex = ex || {};
  const n = _norm(ex.name);
  const type = ex.type || '';
  const muscle = ex.muscle || '';
  // 1) Aparatos exclusivos de gym
  if (/maquina|polea|cable|prensa|smith|hack|gironda|peck|contractora|hammer|multipower|jaca/.test(n)) return ['gym'];
  // 2) Calistenia en barra/paralelas (peso corporal pero necesita estructura)
  if (/dominad|chin.?up|muscle.?up|paralel|colgad|remo invertid|australian/.test(n)) return ['parque', 'gym'];
  // 3) Barra cargada (olímpica / EZ) → gym
  if (/\bbarra\b|\bez\b|olimpic/.test(n)) return ['gym'];
  // 4) Banda elástica → casa / parque / gym
  if (/banda|elastic|\bliga\b/.test(n)) return ['casa', 'parque', 'gym'];
  // 5) Mancuerna → casa / gym
  if (/mancuern/.test(n)) return ['casa', 'gym'];
  // 6) Cardio: máquina vs corporal
  if (muscle === 'cardio') {
    if (/estatic|eliptic|ergometr|cinta|escaladora|spinning/.test(n)) return ['gym'];
    return ENV_ALL.slice(); // carrera, cuerda, burpees, saltos, mountain climbers...
  }
  // 7) Peso corporal / isométrico / funcional / patrones sin implemento → todos
  if (type === 'Bodyweight' || type === 'Isométrico' || type === 'Funcional') return ENV_ALL.slice();
  if (/peso corporal|lagartij|flexion|plancha|superman|puente|zancada|desplante|bulgar|a una pierna|unilateral|pike|burpee|step.?up|crunch|abdominal|mountain|escalador|wall sit|patada de gluteo en cuadrupedia/.test(n)) return ENV_ALL.slice();
  // 8) Por defecto, conservador: gym (el coach reabre a casa si aplica)
  return ['gym'];
}

// ═══════════════════════════════════════════════════════════════════════
// FUSIÓN DE HISTORIAL (sync) — incidente 2026-06-01
// ─────────────────────────────────────────────────────────────────────
// El historial es APPEND-ONLY: cada entreno completado se agrega. El sync
// guardaba el bloque completo (last-write-wins), así que un dispositivo con
// datos viejos podía PISAR sesiones recién registradas por otro → se perdían
// entrenos (Nataly y Andrés Martínez, 2026-06-01).
//
// mergeHistory une nube + local SIN PERDER NADA: dedupe por id de sesión
// (fallback rutina+día para sesiones viejas sin id), en conflicto conserva la
// versión de fecha más reciente (cubre la re-edición del mismo día que hace
// saveSessionToHistory), ordena nuevo→viejo y respeta el tope de 365 por
// cliente. Pura y testeable. La usa syncFromCloud en index.html.
// ─────────────────────────────────────────────────────────────────────
function _histKey(s) {
  if (s && s.id) return 'id:' + s.id;
  // Sesiones viejas sin id: misma clave que usa saveSessionToHistory (rutina + día).
  const day = s && s.date ? new Date(s.date).toDateString() : '?';
  return (s && (s.routineId || s.routineName) || '?') + '|' + day;
}

// Une dos colecciones por-cliente { clientId: [items] } SIN PERDER NADA.
// keyOf(item) = identidad para dedupe; en conflicto conserva la de fecha más reciente.
// order: 'desc' (nuevo→viejo, p.ej. historial/medidas) o 'asc' (viejo→nuevo, p.ej. chat).
// cap: máximo por cliente (conserva siempre los más nuevos). Pura y testeable.
function mergeClientArrays(local, cloud, keyOf, order, cap) {
  local = local && typeof local === 'object' ? local : {};
  cloud = cloud && typeof cloud === 'object' ? cloud : {};
  const out = {};
  const ids = new Set([...Object.keys(local), ...Object.keys(cloud)]);
  ids.forEach(cid => {
    const a = Array.isArray(local[cid]) ? local[cid] : [];
    const b = Array.isArray(cloud[cid]) ? cloud[cid] : [];
    const byKey = new Map();
    a.concat(b).forEach(it => {
      if (it == null) return;
      const k = keyOf(it);
      const prev = byKey.get(k);
      if (!prev || new Date(it.date || 0) >= new Date(prev.date || 0)) byKey.set(k, it);
    });
    let merged = [...byKey.values()];
    merged.sort((x, y) => {
      const dx = new Date(x.date || 0), dy = new Date(y.date || 0);
      return order === 'asc' ? dx - dy : dy - dx;
    });
    if (cap && merged.length > cap) merged = order === 'asc' ? merged.slice(merged.length - cap) : merged.slice(0, cap);
    out[cid] = merged;
  });
  return out;
}

// Historial: dedupe por id de sesión (fallback rutina+día), nuevo→viejo, tope 365.
function mergeHistory(local, cloud, cap) {
  return mergeClientArrays(local, cloud, _histKey, 'desc', cap || 365);
}

// Récords personales { clientId: { exKey: {val,unit,reps,kg,date,...} } }.
// Conserva el MEJOR récord: mayor valor → más reps → más reciente. Nunca pierde un PR.
function mergePRs(local, cloud) {
  local = local && typeof local === 'object' ? local : {};
  cloud = cloud && typeof cloud === 'object' ? cloud : {};
  const valOf = p => (p && p.val != null ? p.val : (p && p.kg) || 0);
  const out = {};
  const ids = new Set([...Object.keys(local), ...Object.keys(cloud)]);
  ids.forEach(cid => {
    const m = {};
    const absorb = src => {
      const o = (src && src[cid]) || {};
      Object.keys(o).forEach(k => {
        const cand = o[k], cur = m[k];
        if (!cur) { m[k] = cand; return; }
        const cv = valOf(cand), uv = valOf(cur);
        const better = cv > uv
          || (cv === uv && (cand.reps || 0) > (cur.reps || 0))
          || (cv === uv && (cand.reps || 0) === (cur.reps || 0) && new Date(cand.date || 0) > new Date(cur.date || 0));
        if (better) m[k] = cand;
      });
    };
    absorb(local); absorb(cloud);
    out[cid] = m;
  });
  return out;
}

// ══════════════════════════════════════════════════════════════════════
// AGREGADOS DE ACTIVIDAD POR FECHA (dashboard del coach)
// ──────────────────────────────────────────────────────────────────────
// Todas reciben `now` como parámetro (nunca llaman new Date() implícito sobre
// la "fecha de hoy"): así son deterministas y testeables. Operan en zona local
// del navegador. Se agruparon aquí porque la lógica de fechas es la más
// propensa a bugs sutiles (p.ej. mezclar el mismo día de la semana pasada con
// hoy) y antes vivía suelta en index.html, sin tests.
const MS_DAY = 86400000;
const _DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// Medianoche local (timestamp) del día al que pertenece `d`.
function localDayStart(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
}

// Barras de retención: cuenta sesiones por DÍA DE CALENDARIO real en los últimos
// 7 días. Devuelve 7 entradas de hace 6 días (i=0) a hoy (i=6): [{label, count}].
// CLAVE: agrupa por fecha local, NO por getDay() — si agrupara por día de la
// semana, las sesiones del mismo día de la semana pasada caerían en la columna
// de "hoy" y mostrarían entrenos fantasma (bug real, 2026-06-02).
function retentionByDay(history, now) {
  const startToday = localDayStart(now || new Date());
  const bars = Array.from({ length: 7 }, (_, i) => {
    const di = new Date(startToday - (6 - i) * MS_DAY).getDay();
    return { label: _DOW[di], count: 0 };
  });
  Object.values(history || {}).forEach(arr => {
    (arr || []).forEach(s => {
      const idx = 6 - Math.round((startToday - localDayStart(s.date)) / MS_DAY);
      if (idx >= 0 && idx <= 6) bars[idx].count++;
    });
  });
  return bars;
}

// Cuántos de `clientIds` entrenaron en los últimos 7 días (ventana móvil de 7×24h).
// Si no se pasan clientIds, usa las llaves de history.
function weeklyActiveCount(history, now, clientIds) {
  const ref = (now ? new Date(now) : new Date()).getTime() - 7 * MS_DAY;
  const ids = clientIds || Object.keys(history || {});
  return ids.filter(id =>
    ((history && history[id]) || []).some(s => new Date(s.date).getTime() >= ref)
  ).length;
}

// Clientes que entrenaron HOY (mismo día de calendario local que `now`).
// Devuelve [{client, sessions}] ordenado por la sesión más reciente (desc).
function clientsTrainedToday(clients, history, now) {
  const today = localDayStart(now || new Date());
  return (clients || [])
    .map(c => {
      const sess = ((history && history[c.id]) || []).filter(s => localDayStart(s.date) === today);
      return sess.length ? { client: c, sessions: sess } : null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.sessions[0].date) - new Date(a.sessions[0].date));
}

// Días enteros transcurridos desde la sesión MÁS RECIENTE (busca el máximo, no
// asume orden). Sin sesiones → Infinity (cuenta como "inactivo desde siempre").
function daysSinceLastSession(sessions, now) {
  const ref = (now ? new Date(now) : new Date()).getTime();
  let last = 0;
  (sessions || []).forEach(s => { const t = new Date(s.date).getTime(); if (t > last) last = t; });
  if (!last) return Infinity;
  return Math.floor((ref - last) / MS_DAY);
}

// ── Racha de entrenamiento: días de CALENDARIO consecutivos con ≥1 sesión,
// terminando HOY o AYER (no se rompe por no haber entrenado aún hoy). Si la última
// sesión fue hace 2+ días, la racha es 0. Varias sesiones el mismo día cuentan 1.
function workoutStreak(sessions, now) {
  const days = new Set();
  (sessions || []).forEach(s => { const d = new Date(s && s.date); if (!isNaN(d.getTime())) days.add(d.toDateString()); });
  if (!days.size) return 0;
  const cursor = now ? new Date(now) : new Date();
  // Si hoy aún no entrena, la racha puede seguir viva desde ayer.
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(cursor.toDateString())) { streak++; cursor.setDate(cursor.getDate() - 1); }
  return streak;
}

// ── Orden de rutinas por día de la semana (Lunes primero, Libre al final) ──
// El día se guarda como nombre en español (con o sin tilde, defensivo). Cualquier
// valor desconocido va al final. Empieza en LUNES (no domingo) porque así lo lee
// la gente; ordenar por getDay() pondría el domingo primero.
const _DAY_ORDER = {
  'Lunes': 1, 'Martes': 2, 'Miércoles': 3, 'Miercoles': 3, 'Jueves': 4,
  'Viernes': 5, 'Sábado': 6, 'Sabado': 6, 'Domingo': 7, 'Libre': 8,
};
function dayOrder(day) {
  return _DAY_ORDER[day] || 99;
}
// Devuelve un array NUEVO ordenado por día. Ordenamiento estable: ante el mismo
// día, conserva el orden original (por eso lleva el índice como desempate).
function sortRoutinesByDay(routines) {
  return (routines || [])
    .map((r, i) => [r, i])
    .sort((a, b) => (dayOrder(a[0] && a[0].day) - dayOrder(b[0] && b[0].day)) || (a[1] - b[1]))
    .map(pair => pair[0]);
}

// ── Validación de auto-registro (modo libre) — pura, testeable ──
// data: {name,email,password}. clients: DB.clients (para email único). coachEmail: el
// email del coach (no se puede registrar con él). Devuelve {ok} o {ok:false,error}.
function validateSignup(data, clients, coachEmail) {
  data = data || {};
  const name = (data.name || '').trim();
  const email = (data.email || '').trim().toLowerCase();
  const pass = data.password || '';
  if (!name) return { ok: false, error: 'Escribe tu nombre' };
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Escribe un email válido' };
  if (coachEmail && email === String(coachEmail).trim().toLowerCase()) return { ok: false, error: 'Ese email no está disponible' };
  if ((clients || []).some(c => c && c.email && c.email.toLowerCase() === email)) return { ok: false, error: 'Ya existe una cuenta con ese email. Inicia sesión.' };
  if (!pass || pass.length < 4) return { ok: false, error: 'La contraseña debe tener al menos 4 caracteres' };
  return { ok: true };
}

// ── Gate de registro por código de gimnasio ──
// El SaaS es B2B: el gym entrega un código a sus miembros para que se registren.
// Si el gym activo define GYM_CONFIG.signupCode (no vacío), el auto-registro lo exige;
// sin código configurado el gate queda ABIERTO (demo / gyms que no lo quieran).
// Comparación tolerante: ignora mayúsculas y espacios para no frustrar al usuario.
// NOTA: es un gate client-side (el código va en el JS público) → frena a randoms con el
// link, no a un atacante técnico; el candado server-side es un follow-up aparte.
function _normGymCode(s) { return String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, ''); }
function gymCodeRequired(gymConfig) {
  return !!(gymConfig && typeof gymConfig.signupCode === 'string' && gymConfig.signupCode.trim());
}
function checkGymCode(input, gymConfig) {
  if (!gymCodeRequired(gymConfig)) return { ok: true };
  if (!_normGymCode(input)) return { ok: false, error: 'Ingresa el código de tu gimnasio para continuar.' };
  if (_normGymCode(input) === _normGymCode(gymConfig.signupCode)) return { ok: true };
  return { ok: false, error: 'Código incorrecto. Pídelo en la recepción de tu gimnasio.' };
}

// ── ¿Es usuario en modo libre (gratis, sin coach)? ──
// Gating de funciones Premium. Libre = tier 'libre' (auto-registrados). Los asesorados
// creados por el coach NO tienen tier → no son libres → acceso completo. Convertir a
// Premium = ponerle tier 'premium' (el coach lo activa).
function isFreeClient(client) {
  return !!(client && client.tier === 'libre');
}

// ══════════ FASE 2 — Auth + fila por usuario (modelo user_data) ══════════
// La tabla user_data (Supabase) tiene una fila por usuario con columnas:
//   user_id, coach_id, role, profile(jsonb), routines, history, prs, bodyweight,
//   medidas, nutrition, photos, msgs, updated_at.
// En la app de hoy un "cliente" (DB.clients[i]) mezcla perfil + rutinas + id, y las
// colecciones (history/prs/…) viven globales indexadas por clientId. Estos helpers
// PUROS traducen entre el objeto cliente de la app y su fila user_data, para que la
// reescritura de la capa de datos (paso 2.2) los reuse en vez de inventar el mapeo.

// Colecciones por-usuario que en el modelo nuevo viven en SU PROPIA fila (no globales).
const USER_DATA_COLLECTIONS = ['history', 'prs', 'bodyweight', 'medidas', 'nutrition', 'photos', 'msgs'];

// Cliente → fila user_data. Separa el perfil (escalares) de las rutinas y el id.
// La contraseña NO viaja: Supabase Auth la maneja → se omite del perfil.
// opts: {coachId, role, userId}. coach_id = opts.coachId (null = libre/sin coach).
function clientToRow(client, opts) {
  client = client || {};
  opts = opts || {};
  const profile = {};
  Object.keys(client).forEach(k => {
    if (k === 'id' || k === 'routines' || k === 'password') return;
    profile[k] = client[k];
  });
  const coachId = (opts.coachId !== undefined ? opts.coachId : client.coach_id);
  return {
    user_id: client.id || opts.userId || null,
    coach_id: coachId || null,
    role: opts.role || 'client',
    profile,
    routines: Array.isArray(client.routines) ? client.routines : [],
  };
}

// Fila user_data → cliente de la app. Reconstruye el objeto que esperan los renders:
// {id, ...perfil, routines}. (Las colecciones se cargan aparte a DB.history[id], etc.)
function rowToClient(row) {
  row = row || {};
  const profile = row.profile || {};
  return Object.assign({}, profile, {
    id: row.user_id || profile.id || null,
    routines: Array.isArray(row.routines) ? row.routines : [],
  });
}

// ══ §9 STAFF — multi-entrenador por gimnasio (AVI GYM kernel F2) ══
// El equipo (DB.staff) es una lista de perfiles bajo la cuenta del gym:
// {id, name, role:'owner'|'trainer'}. Cada cliente puede tener trainerId.
// Sin equipo configurado la app se comporta exactamente como antes (un coach).

// Clientes visibles según el perfil activo. Dueña/admin (owner), perfil
// inexistente o equipo vacío → todos. Entrenador → solo los suyos.
function staffScope(clients, staff, activeStaffId) {
  clients = clients || [];
  if (!Array.isArray(staff) || !staff.length || !activeStaffId) return clients;
  const me = staff.find(s => s && s.id === activeStaffId);
  if (!me || me.role === 'owner') return clients;
  return clients.filter(c => c && c.trainerId === activeStaffId);
}

// Conteo de asesorados por entrenador. Devuelve {<staffId>: n, _unassigned: n}.
// Un trainerId huérfano (entrenador borrado) cuenta como sin asignar.
function staffCounts(clients, staff) {
  const out = { _unassigned: 0 };
  (staff || []).forEach(s => { if (s && s.id) out[s.id] = 0; });
  (clients || []).forEach(c => {
    if (c && c.trainerId && out[c.trainerId] !== undefined) out[c.trainerId]++;
    else out._unassigned++;
  });
  return out;
}

// Al eliminar un entrenador sus asesorados quedan sin asignar (no se borran).
// Muta los clientes y devuelve cuántos se desasignaron.
function unassignTrainer(clients, staffId) {
  let n = 0;
  (clients || []).forEach(c => {
    if (c && c.trainerId === staffId) { delete c.trainerId; n++; }
  });
  return n;
}

function staffById(staff, id) {
  return (staff || []).find(s => s && s.id === id) || null;
}

// Estado de membresía de un socio (espejo PURO de MS.getStatus, para testear).
// 'inactive' suspendido · 'pending' sin pagos · 'overdue' venció · 'expiring' <=7d · 'active'.
function memberStatus(c, now) {
  now = now || Date.now();
  if (!c || c.suspended) return 'inactive';
  const pays = c.payments || [];
  if (!pays.length) return 'pending';
  const last = pays.reduce((a, b) => new Date(a.dueDate) > new Date(b.dueDate) ? a : b);
  const daysLeft = Math.ceil((new Date(last.dueDate) - now) / 86400000);
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= 7) return 'expiring';
  return 'active';
}

// Roll-up por entrenador para la pantalla del dueño: socios, ingresos DEL MES y
// estado (al día / vencidos). Puro y testeable. opts={year,month,now} (default = hoy).
// Devuelve {<staffId>:{members,revenue,alDia,vencidos}, _unassigned:{...}, _total:{...}}.
// Los socios con trainerId huérfano o sin asignar caen en _unassigned.
function staffRevenue(clients, staff, opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const ref = new Date(now);
  const year = opts.year != null ? opts.year : ref.getFullYear();
  const month = opts.month != null ? opts.month : ref.getMonth();
  const blank = () => ({ members: 0, revenue: 0, alDia: 0, vencidos: 0 });
  const out = { _unassigned: blank(), _total: blank() };
  (staff || []).forEach(s => { if (s && s.id) out[s.id] = blank(); });
  (clients || []).forEach(c => {
    if (!c) return;
    const key = (c.trainerId && out[c.trainerId]) ? c.trainerId : '_unassigned';
    const b = out[key];
    b.members++; out._total.members++;
    let rev = 0;
    (c.payments || []).forEach(p => {
      const pd = new Date(p && p.date);
      if (pd.getFullYear() === year && pd.getMonth() === month) rev += (parseFloat(p && p.amount) || 0);
    });
    b.revenue += rev; out._total.revenue += rev;
    const st = memberStatus(c, now);
    if (st === 'active' || st === 'expiring') { b.alDia++; out._total.alDia++; }
    else if (st === 'overdue') { b.vencidos++; out._total.vencidos++; }
  });
  return out;
}

// Valida un perfil de equipo antes de guardar. Devuelve null si está bien
// o el mensaje de error. El nombre no puede repetirse (ignorando may/min).
function validateStaff(staff, name, role, editId) {
  const nm = (name || '').trim();
  if (nm.length < 2) return 'Escribe el nombre del entrenador';
  if (role !== 'owner' && role !== 'trainer') return 'Rol inválido';
  const dup = (staff || []).find(s => s && s.id !== editId && (s.name || '').trim().toLowerCase() === nm.toLowerCase());
  if (dup) return 'Ya hay alguien del equipo con ese nombre';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// CHECK-IN DIARIO "¿CÓMO TE SIENTES HOY?" — adaptación por estado de ánimo
// ─────────────────────────────────────────────────────────────────────
// Filosofía (regla de la dueña del gym): el entrenamiento se adapta a la
// persona, no al revés. NO mantenemos una rutina por estado por asesorado
// (300 socios × 6 estados = 1.800 rutinas, inviable). En su lugar cada estado
// es una REGLA UNIVERSAL que TRANSFORMA la rutina que el asesorado YA tiene
// hoy — el mismo patrón que la fase de adaptación (ver genSchemeFor). Tocas
// UNA regla y cambia para los 300. Función pura y testeable: no toca DOM ni
// localStorage; siempre devuelve una COPIA (no muta la rutina original).
// ─────────────────────────────────────────────────────────────────────

// Estados disponibles. `femaleOnly` se filtra en la UI según client.sex.
const MOOD_STATES = [
  { id: 'bien',    emoji: '😊',   label: 'Bien' },
  { id: 'energia', emoji: '🔥',   label: 'Con toda la energía' },
  { id: 'cansado', emoji: '😮‍💨', label: 'Cansado' },
  { id: 'estres',  emoji: '😤',   label: 'Estresado / enojado' },
  { id: 'periodo', emoji: '🩸',   label: 'En mi periodo', femaleOnly: true },
  { id: 'dolor',   emoji: '🤕',   label: 'Con dolor o molestia' },
];

// ¿El ejercicio es de carga (fuerza con peso externo)? Peso corporal,
// isométrico, funcional, cardio y core NO cuentan como carga.
function _isLoadedEx(ex) {
  const type = ((ex && ex.type) || '').toLowerCase();
  const muscle = (ex && ex.muscle) || '';
  if (muscle === 'cardio' || muscle === 'core') return false;
  if (/bodyweight|isom|funcional|cardio|hiit/.test(type)) return false;
  return true;
}

// Bloque de cardio "de relleno" autocontenido (no depende de la biblioteca).
function _cardioBlock(name, mins) {
  return { id: '_mood_cardio', name: name, muscle: 'cardio', type: 'Cardio', sets: 1, reps: mins + ' min', icon: '🏃', _added: true };
}

// Convierte un ejercicio de carga a peso corporal (sin peso, reps altas,
// menos series). Muta la copia recibida. Usado por 'periodo' y 'dolor'.
function _demoteToBodyweight(e) {
  e.bodyweightMode = true;
  e.loadHint = 'Sin peso — solo tu cuerpo';
  e.reps = Math.max(parseInt(e.reps) || 12, 15);
  e.sets = Math.min(parseInt(e.sets) || 3, 3);
}

// Aplica el modificador de ánimo a una rutina. opts: { sex }.
// Devuelve una copia nueva con `adapt` (meta para la UI) y `moodAdjusted`.
function applyMood(routine, mood, opts) {
  opts = opts || {};
  const base = routine || {};
  const exs = (base.exercises || []).map(e => Object.assign({}, e));
  const out = Object.assign({}, base, { exercises: exs });
  const rest = parseInt(base.restSec) || 60;
  const adapt = { mood: mood || 'bien', title: '', why: '', tone: 'g', changes: [], flagCoach: false };

  switch (mood) {
    case 'energia':
      adapt.title = '¡A por todo hoy! 🔥';
      adapt.why = 'Te sientes con energía: rutina completa. Si hay un día para buscar un récord, es hoy.';
      break;

    case 'cansado': {
      exs.forEach(e => { e.sets = Math.max(2, (parseInt(e.sets) || 3) - 1); });
      out.restSec = rest + 15;
      let dropped = null;
      if (exs.length > 4) dropped = exs.pop(); // quita el último accesorio en sesiones largas
      adapt.title = 'Hoy entrenamos suave 😮‍💨';
      adapt.why = 'Bajamos una serie por ejercicio y subimos el descanso. Mejor entrenar liviano que no entrenar — mañana vuelves con todo.';
      adapt.tone = 'b';
      adapt.changes.push('−1 serie por ejercicio', '+15s de descanso');
      if (dropped) adapt.changes.push('Quitamos: ' + (dropped.name || 'último accesorio'));
      break;
    }

    case 'estres': {
      if (!exs.some(e => e.muscle === 'cardio')) exs.push(_cardioBlock('Cardio de descarga', 10));
      adapt.title = 'Descarga la tensión 😤';
      adapt.why = 'Sumamos un bloque de cardio al final para soltar el estrés. Hoy el gimnasio es tu terapia.';
      adapt.tone = 'b';
      adapt.changes.push('+ Cardio de descarga (10 min)');
      break;
    }

    case 'periodo': {
      // Evidencia 2023-2025: la fase del ciclo NO afecta la fuerza ni la
      // hipertrofia. "Nada de fuerza en el periodo" es un MITO. En vez de
      // despojar la carga, EMPODERAMOS + autorregulación: si hay síntomas
      // (cólicos/fatiga) ella marca 'Cansada'/'Con dolor' y esos estados
      // ajustan. Ver docs/entrenamiento-femenino.md.
      adapt.title = 'Entrena con confianza 🩸';
      adapt.why = 'Estar en tu periodo no te frena: puedes entrenar fuerza con normalidad y además te hace bien (huesos, energía, ánimo). Escucha tu cuerpo — si hoy tienes cólicos o te sientes cansada, marca "Cansada" o "Con dolor" y ajustamos la sesión por ti.';
      adapt.tone = 'g';
      break;
    }

    case 'dolor': {
      // Seguridad primero: trabajo suave (sin carga) + avisar al coach.
      let n = 0;
      exs.forEach(e => { if (_isLoadedEx(e)) { _demoteToBodyweight(e); e.sets = 2; n++; } });
      out.restSec = rest + 20;
      adapt.title = 'Escucha a tu cuerpo 🤕';
      adapt.why = 'Con dolor lo mejor es no forzar. Hoy trabajamos suave, sin carga, y le avisamos a tu coach para que te acompañe.';
      adapt.tone = 'r';
      adapt.flagCoach = true;
      if (n) adapt.changes.push(n + ' ejercicios sin carga');
      adapt.changes.push('Tu coach fue notificado');
      break;
    }

    case 'bien':
    default:
      adapt.title = 'A entrenar 💪';
      adapt.why = 'Te sientes bien: rutina completa, tal como tu coach la preparó para ti.';
      break;
  }

  out.adapt = adapt;
  out.moodAdjusted = !!mood && mood !== 'bien';
  return out;
}

// ── Exportación dual: navegador (global) + Node (module.exports) ──
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MOOD_STATES,
    applyMood,
    staffScope,
    staffCounts,
    unassignTrainer,
    staffById,
    memberStatus,
    staffRevenue,
    validateStaff,
    getIccLabel,
    getSexCode,
    calcMacrosSugeridos,
    migrateRoutineIds,
    shouldPostPush,
    delClientGuard,
    cnTodayGuard,
    generarRutinas,
    parseLimitations,
    genSchemeFor,
    EX_LEVEL,
    exLevel,
    exLevelRank,
    inferExerciseEnv,
    ENV_ALL,
    mergeHistory,
    mergeClientArrays,
    mergePRs,
    localDayStart,
    retentionByDay,
    weeklyActiveCount,
    clientsTrainedToday,
    daysSinceLastSession,
    workoutStreak,
    dayOrder,
    sortRoutinesByDay,
    isInAdaptation,
    estimate1RM,
    suggestLoad,
    suggestFromPR,
    trainingStartTs,
    bmiFrom,
    bodyLoadProfile,
    validateSignup,
    gymCodeRequired,
    checkGymCode,
    isFreeClient,
    USER_DATA_COLLECTIONS,
    clientToRow,
    rowToClient,
  };
}
