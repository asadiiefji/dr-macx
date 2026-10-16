// The stamping press as data: every part with its shape and place (metres; x = right, y = up, z = toward the
// operator). Shared by the isometric drawing (PressAnatomy.jsx) and the 3D view (Press3D.jsx).
// kind: box {pos = min corner, size} | cylX / cylY {center, r, len} | line {points}.
// part = the anatomy id sensors point at (server/sensors.js); node = tonnage node number on load cells.

export const TONES = {
  frame: '#1565C0', dark: '#0D47A1', light: '#90CAF9', pale: '#E3F2FD', die: '#2E7D32', steel: '#90A4AE',
  floor: '#CFD8DC', amber: '#FFB300', black: '#263238', white: '#ECEFF1',
};

const box = (id, name, pos, size, tone, extra = {}) => ({ id, name, kind: 'box', pos, size, tone, ...extra });
const cylX = (id, name, center, r, len, tone, extra = {}) => ({ id, name, kind: 'cylX', center, r, len, tone, ...extra });
const cylY = (id, name, center, r, len, tone, extra = {}) => ({ id, name, kind: 'cylY', center, r, len, tone, ...extra });
const line = (id, name, points, tone, extra = {}) => ({ id, name, kind: 'line', points, tone, ...extra });

// Load-cell (tonnage node) numbering, seen from the operator: 1 left front, 2 right front, 3 right rear, 4 left rear.
export const NODE_PLACE = { 1: 'left front', 2: 'right front', 3: 'right rear', 4: 'left rear' };

function straightSide(nodes) {
  const cols = [
    [1, 'Left front column', -1.55, 0.35],
    [2, 'Right front column', 1.1, 0.35],
    [3, 'Right rear column', 1.1, -0.8],
    [4, 'Left rear column', -1.55, -0.8],
  ];
  return [
    box('foundation', 'Foundation pad', [-2.2, -0.12, -1.25], [4.6, 0.12, 2.5], 'floor'),
    ...[[-1.45, -0.65], [1.1, -0.65], [-1.45, 0.4], [1.1, 0.4]].map(([x, z], i) => box(`foot${i + 1}`, 'Levelling foot', [x, 0, z], [0.35, 0.12, 0.35], 'amber')),
    box('bed', 'Bed', [-1.5, 0.12, -0.85], [3.0, 0.8, 1.7], 'dark'),
    box('bolster', 'Bolster plate', [-1.2, 0.92, -0.65], [2.4, 0.18, 1.3], 'light'),
    box('lowerDie', 'Lower die', [-0.9, 1.1, -0.5], [1.8, 0.28, 1.0], 'die'),
    box('upperDie', 'Upper die', [-0.9, 1.75, -0.5], [1.8, 0.28, 1.0], 'die', { moves: true }),
    box('slide', 'Slide (ram)', [-1.05, 2.03, -0.6], [2.1, 0.55, 1.2], 'light', { moves: true }),
    box('conRod', 'Connecting rod', [-0.12, 2.58, -0.12], [0.24, 1.32, 0.24], 'steel', { moves: true }),
    ...cols.map(([n, name, x, z]) => box(`column${n}`, name, [x, 0.92, z], [0.45, 2.98, 0.45], 'frame')),
    box('gibL', 'Slide gib, left', [-1.12, 1.9, -0.6], [0.07, 1.0, 1.2], 'steel'),
    box('gibR', 'Slide gib, right', [1.05, 1.9, -0.6], [0.07, 1.0, 1.2], 'steel'),
    ...cols.slice(0, nodes === 4 ? 4 : 2).map(([n, , x, z]) => box(`loadCell${n}`, `Tonnage load cell, node ${n} (${NODE_PLACE[n]})`, [x - 0.05, 3.45, z - 0.05], [0.55, 0.3, 0.55], 'steel', { part: 'loadCell', node: n })),
    box('crown', 'Crown', [-1.65, 3.9, -0.9], [3.3, 1.0, 1.8], 'frame'),
    box('nameplate', 'Nameplate', [-0.45, 4.3, 0.9], [0.9, 0.24, 0.02], 'black'),
    cylY('counterbalanceL', 'Slide counterbalance cylinder', [-0.6, 5.2, 0.55], 0.14, 0.6, 'steel'),
    cylY('counterbalanceR', 'Slide counterbalance cylinder', [0.6, 5.2, 0.55], 0.14, 0.6, 'steel'),
    box('gearbox', 'Main gearbox', [-1.05, 4.9, -0.7], [1.0, 0.45, 0.8], 'dark', { part: 'gearbox' }),
    box('motor', 'Main drive motor', [0.55, 4.9, -0.85], [0.8, 0.55, 0.6], 'black', { part: 'motor' }),
    cylX('flywheel', 'Flywheel', [1.8, 4.5, -0.1], 0.62, 0.28, 'steel'),
    cylX('clutch', 'Clutch / brake', [2.1, 4.5, -0.1], 0.3, 0.26, 'dark'),
    line('belt', 'V-belt drive', [[1.35, 5.2, -0.55], [1.8, 5.05, -0.1], [1.8, 3.95, -0.1], [1.35, 4.9, -0.55]], 'black'),
    box('lubePump', 'Lubrication pump', [-2.0, 0.12, -0.3], [0.42, 0.5, 0.42], 'amber'),
    line('lubeLine', 'Lubrication line', [[-1.8, 0.62, -0.1], [-1.8, 0.62, 0.55], [-1.55, 1.2, 0.8], [-1.55, 3.9, 0.8]], 'amber', { part: 'lubeLine' }),
    box('lightCurtainL', 'Light curtain, left', [-1.1, 1.0, 0.82], [0.08, 1.45, 0.08], 'amber'),
    box('lightCurtainR', 'Light curtain, right', [1.02, 1.0, 0.82], [0.08, 1.45, 0.08], 'amber'),
    box('twoHand', 'Two-hand control station', [-0.55, 0.85, 1.1], [1.1, 0.16, 0.35], 'black'),
    line('pendantPost', 'Control pendant arm', [[1.95, 0, 1.15], [1.95, 1.2, 1.15]], 'steel'),
    box('controlPanel', 'Control pendant', [1.7, 1.2, 1.05], [0.5, 0.65, 0.22], 'black'),
    box('plc', 'PLC cabinet (sensors wired here)', [-2.5, 0.0, -1.0], [0.55, 1.8, 0.6], 'pale', { part: 'plc' }),
    box('ioModule', 'Network I/O module', [1.55, 2.3, -0.75], [0.12, 0.5, 0.35], 'pale', { part: 'ioModule' }),
    cylX('microphone', 'Acoustic sensor', [1.62, 1.55, 0.6], 0.07, 0.22, 'black', { part: 'microphone' }),
    box('exitChute', 'Exit chute', [1.5, 0.6, -0.35], [1.0, 0.1, 0.6], 'steel'),
    box('laserEye', 'Laser eye (part counter)', [2.42, 0.68, -0.12], [0.12, 0.2, 0.12], 'black', { part: 'laserEye' }),
    line('cameraPost', 'Camera post', [[2.3, 0.7, -0.45], [2.3, 1.6, -0.45]], 'steel'),
    box('camera', 'Vision camera', [2.15, 1.6, -0.55], [0.3, 0.2, 0.22], 'black', { part: 'camera' }),
  ];
}

function cFrame() {
  return [
    box('foundation', 'Foundation pad', [-1.6, -0.12, -1.25], [3.4, 0.12, 2.5], 'floor'),
    ...[[-0.95, -0.95], [0.6, -0.95], [-0.95, 0.65], [0.6, 0.65]].map(([x, z], i) => box(`foot${i + 1}`, 'Levelling foot', [x, 0, z], [0.35, 0.12, 0.35], 'amber')),
    box('frameBack', 'C-frame (back column)', [-0.9, 0.12, -0.95], [1.8, 3.5, 0.85], 'frame'),
    box('bed', 'Bed (lower jaw)', [-0.9, 0.12, -0.1], [1.8, 0.95, 1.15], 'frame'),
    box('bolster', 'Bolster plate', [-0.7, 1.07, 0.0], [1.4, 0.15, 0.95], 'light'),
    box('lowerDie', 'Lower die', [-0.55, 1.22, 0.1], [1.1, 0.24, 0.75], 'die'),
    box('upperDie', 'Upper die', [-0.55, 1.72, 0.1], [1.1, 0.24, 0.75], 'die', { moves: true }),
    box('slide', 'Slide (ram)', [-0.6, 1.96, 0.05], [1.2, 0.55, 0.85], 'light', { moves: true }),
    box('gibL', 'Slide gib, left', [-0.68, 1.9, 0.05], [0.07, 0.7, 0.85], 'steel'),
    box('gibR', 'Slide gib, right', [0.61, 1.9, 0.05], [0.07, 0.7, 0.85], 'steel'),
    box('loadCell1', 'Tonnage strain gauge, node 1 (left)', [-0.8, 1.55, -0.14], [0.32, 0.3, 0.04], 'steel', { part: 'loadCell', node: 1 }),
    box('loadCell2', 'Tonnage strain gauge, node 2 (right)', [0.48, 1.55, -0.14], [0.32, 0.3, 0.04], 'steel', { part: 'loadCell', node: 2 }),
    box('head', 'Head (upper jaw)', [-0.9, 2.51, -0.1], [1.8, 1.11, 1.0], 'frame'),
    box('nameplate', 'Nameplate', [-0.35, 2.95, 0.9], [0.7, 0.2, 0.02], 'black'),
    cylY('counterbalanceL', 'Slide counterbalance cylinder', [-0.45, 3.85, 0.5], 0.12, 0.45, 'steel'),
    cylY('counterbalanceR', 'Slide counterbalance cylinder', [0.45, 3.85, 0.5], 0.12, 0.45, 'steel'),
    box('gearbox', 'Gear housing', [-0.85, 3.62, -0.85], [0.5, 0.42, 0.55], 'dark', { part: 'gearbox' }),
    box('motor', 'Main drive motor', [-0.2, 3.62, -0.9], [0.75, 0.5, 0.55], 'black', { part: 'motor' }),
    cylX('flywheel', 'Flywheel', [1.05, 3.05, -0.5], 0.58, 0.26, 'steel'),
    cylX('clutch', 'Clutch / brake', [1.33, 3.05, -0.5], 0.28, 0.24, 'dark'),
    line('belt', 'V-belt drive', [[0.55, 3.95, -0.6], [1.05, 3.6, -0.5], [1.05, 2.5, -0.5], [0.55, 3.65, -0.6]], 'black'),
    box('lubePump', 'Lubrication pump', [-1.35, 0.12, -0.5], [0.4, 0.45, 0.4], 'amber'),
    line('lubeLine', 'Lubrication line', [[-1.15, 0.57, -0.3], [-1.15, 0.57, 0.95], [-0.9, 1.3, 0.95], [-0.9, 2.5, 0.95]], 'amber', { part: 'lubeLine' }),
    box('lightCurtainL', 'Light curtain, left', [-0.86, 1.08, 1.0], [0.07, 1.4, 0.07], 'amber'),
    box('lightCurtainR', 'Light curtain, right', [0.79, 1.08, 1.0], [0.07, 1.4, 0.07], 'amber'),
    box('twoHand', 'Two-hand control station', [-0.45, 0.85, 1.25], [0.9, 0.15, 0.3], 'black'),
    line('pendantPost', 'Control pendant arm', [[1.45, 0, 1.0], [1.45, 1.15, 1.0]], 'steel'),
    box('controlPanel', 'Control pendant', [1.2, 1.15, 0.9], [0.5, 0.6, 0.2], 'black'),
    box('plc', 'PLC cabinet (sensors wired here)', [-1.95, 0.0, -1.0], [0.5, 1.7, 0.55], 'pale', { part: 'plc' }),
    box('ioModule', 'Network I/O module', [0.9, 1.6, -0.75], [0.1, 0.45, 0.3], 'pale', { part: 'ioModule' }),
    cylX('microphone', 'Acoustic sensor', [0.95, 1.45, 0.6], 0.06, 0.2, 'black', { part: 'microphone' }),
    box('exitChute', 'Exit chute', [0.9, 0.75, -0.05], [0.9, 0.1, 0.55], 'steel'),
    box('laserEye', 'Laser eye (part counter)', [1.75, 0.83, 0.15], [0.12, 0.2, 0.12], 'black', { part: 'laserEye' }),
    line('cameraPost', 'Camera post', [[1.65, 0.85, -0.25], [1.65, 1.7, -0.25]], 'steel'),
    box('camera', 'Vision camera', [1.5, 1.7, -0.35], [0.3, 0.2, 0.22], 'black', { part: 'camera' }),
  ];
}

// Parts for one press; Premium-only sensor parts are dropped on Essential presses.
const PREMIUM_PARTS = new Set(['camera', 'cameraPost', 'microphone', 'ioModule']);
export function pressParts(m) {
  const parts = m.frameType === 'straight-side' ? straightSide(Number(m.nodes) || 4) : cFrame();
  return m.setup === 'premium' ? parts : parts.filter((p) => !PREMIUM_PARTS.has(p.id) && p.part !== 'loadCell');
}

// The part to light up: the given one, else the worst sensor (alarm before warning).
export function worstPart(m, catalogSensors) {
  const ranked = (catalogSensors ?? []).map((s) => ({ s, st: m.sensorStatus?.[s.id] })).filter((x) => x.st === 'alarm' || x.st === 'warn');
  ranked.sort((a, b) => (a.st === 'alarm' ? 0 : 1) - (b.st === 'alarm' ? 0 : 1));
  const s = ranked[0]?.s;
  return s ? { part: s.part, node: s.node ?? null, sensorId: s.id, state: m.sensorStatus[s.id] } : null;
}

// The drawn part for a {part, node} pointer (load cells by node).
export const findPart = (parts, lit) =>
  lit && parts.find((p) => (lit.node ? p.part === 'loadCell' && p.node === lit.node : p.id === lit.part || p.part === lit.part));
