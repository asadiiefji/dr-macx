// Stamping-press sensor catalog from the server (GET /api/sensors) and the per-press list.
import { useGet } from './api.js';

export const useSensorCatalog = () => useGet('/sensors').data;

// The sensors one press has: its setup's list, with one tonnage channel per node (mirrors server/sensors.js).
export function sensorsFor(m, catalog) {
  if (!catalog) return [];
  return catalog.sensors
    .filter((s) => s.setup === 'essential' || m.setup === 'premium')
    .flatMap((s) =>
      s.perNode
        ? Array.from({ length: Number(m.nodes) || 2 }, (_, i) => ({ ...s, id: `tonnage${i + 1}`, node: i + 1, label: `${s.label}, node ${i + 1}`, short: `Node ${i + 1}`, tag: `${s.tag}${i + 1}` }))
        : [s],
    );
}

export const valueOf = (r, s) => (r ? (s.node ? r.tonnage?.[s.node - 1] : r[s.id]) : null);

export const SETUP_TEXT = {
  essential: { label: 'Essential', text: 'Low-cost OEE kit: laser eye counts parts at the exit chute, a clip-on current sensor tells running / idle / off. NC pieces are entered by the operator.' },
  premium: { label: 'Premium', text: 'Everything in Essential plus tonnage load cells per node, vibration and thermal sensors, a vision camera (NC), an acoustic sticking detector and a network I/O module for remote diagnosis.' },
};

export const MOTOR = { running: 'Running', idle: 'Idle (motor on, not stroking)', off: 'Off', break: 'Planned break' };
