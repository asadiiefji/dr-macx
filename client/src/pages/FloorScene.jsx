// The 3D production floor: one low-poly press per machine, one character per assigned operator.
// Everything here comes from master data and the live snapshot passed in by Floor.jsx.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { Vector3 } from 'three';
import { Box, Button, Card, CardContent, Stack, ThemeProvider, Typography } from '@mui/material';
import ThumbUpIcon from '@mui/icons-material/ThumbUpAltOutlined';
import { theme, C, LEVELS, level } from '../theme.js';
import { FactorBar, LevelChip, duration, num, pct } from '../ui.jsx';

export const ROW_GAP = 9; // between lines (z)
export const MACHINE_GAP = 7; // between machines in a line (x)

const RING = { good: LEVELS.good.bar, near: LEVELS.near.bar, below: LEVELS.below.bar, none: '#94A3B8' };
const ICON = { good: '✓', near: '▲', below: '!' };
const GREY = '#CFD8DC';

// drei Html renders in its own React root: give it the MUI theme, and keep it under MUI dialogs (z-index 1300).
// anchor: 'center' (default), 'bottom' = the label sits fully above its point, 'left' = it starts right of its point.
const ANCHOR = { center: undefined, bottom: 'translate(-50%, -100%)', left: 'translate(14px, -50%)', right: 'translate(calc(-100% - 14px), -50%)' };
function Label({ children, anchor = 'center', zIndexRange = [100, 0], ...props }) {
  // drei sets a label's z-index only once the camera moves; set it at mount so a hover card is on top straight away.
  const lift = (node) => node?.parentElement && (node.parentElement.style.zIndex = String(zIndexRange[0]));
  return (
    <Html ref={lift} center={anchor === 'center'} zIndexRange={zIndexRange} {...props}>
      <ThemeProvider theme={theme}>
        <Box sx={{ transform: ANCHOR[anchor] }}>{children}</Box>
      </ThemeProvider>
    </Html>
  );
}

// Schedule vs actual: pieces due by now at the ideal cycle time (shift time minus breaks) vs good pieces made.
// The bar fills with good / plan and is coloured by the OEE judgement; the OEE number sits on the bar.
function PlanBar({ m }) {
  const good = m.total - m.ng;
  const plan = m.plan?.toNow ?? 0;
  const k = level(m.oee, m.targets?.oee);
  return (
    <Box mt={0.75} textAlign="left">
      <Stack direction="row" justifyContent="space-between" gap={1}>
        <Typography sx={{ fontSize: 10.5, whiteSpace: 'nowrap' }} color="text.secondary">Good <b>{num(good)}</b>/<b>{num(plan)}</b> plan</Typography>
        <Typography sx={{ fontSize: 10.5, whiteSpace: 'nowrap' }} color="text.secondary">Shift {num(m.plan?.shift)}</Typography>
      </Stack>
      <Box
        role="img"
        aria-label={`Good ${good} of ${plan} planned by now, OEE ${pct(m.oee)}`}
        sx={{ position: 'relative', height: 16, mt: 0.25, borderRadius: 1, bgcolor: '#E2E8F0', overflow: 'hidden' }}
      >
        <Box sx={{ height: '100%', width: `${plan ? Math.min(100, (good / plan) * 100) : 0}%`, bgcolor: k ? LEVELS[k].bar : C.blue }} />
        <Typography sx={{ position: 'absolute', inset: 0, textAlign: 'center', fontSize: 11, lineHeight: '16px', fontWeight: 800, color: C.ink, textShadow: '0 0 3px #fff, 0 0 3px #fff' }}>
          OEE {pct(m.oee)}
        </Typography>
      </Box>
    </Box>
  );
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// Rows by line; machines spaced evenly along each row, the whole floor centred on x = 0.
export function layout(machines) {
  const lines = [...new Set(machines.map((m) => m.line || 'No line'))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return lines.map((name, i) => {
    const row = machines.filter((m) => (m.line || 'No line') === name).sort((a, b) => a.code.localeCompare(b.code));
    return { name, z: i * ROW_GAP, machines: row.map((m, j) => ({ m, x: (j - (row.length - 1) / 2) * MACHINE_GAP })) };
  });
}

// A floating "+1" / "NC" / "+10 pts"; removed after its CSS animation.
function Popups({ items, reduced }) {
  return items.map((p) => (
    <Label key={p.id} position={[p.dx ?? 0, 4.4, 0]}>
      <Typography
        sx={{
          fontWeight: 800,
          fontSize: p.big ? 20 : 15,
          color: p.color,
          textShadow: '0 1px 0 #fff, 0 0 6px #fff',
          pointerEvents: 'none',
          '@keyframes floatUp': { from: { transform: 'translateY(0)', opacity: 1 }, to: { transform: 'translateY(-36px)', opacity: 0 } },
          animation: reduced ? 'none' : 'floatUp 1.4s ease-out forwards',
        }}
      >
        {p.text}
      </Typography>
    </Label>
  ));
}

function usePopups() {
  const [items, setItems] = useState([]);
  const push = (p) => {
    const id = Math.random();
    setItems((xs) => [...xs, { ...p, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 1500);
  };
  return [items, push];
}

function DowntimeCard({ m, alarmText, onSelect }) {
  const now = useNow();
  return (
    <Card sx={{ minWidth: 190, borderTop: `4px solid ${LEVELS.below.bar}` }}>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="overline" component="div" lineHeight={1.4}>STOPPED · ALARM {m.openStop.alarmCode || 'none'}</Typography>
        <Typography variant="body2" fontWeight={700}>{alarmText || 'No alarm text'}</Typography>
        <Typography sx={{ fontSize: 22, fontWeight: 800 }} aria-label="Stopped for">{duration(now - m.openStop.start)}</Typography>
        <Button fullWidth size="small" variant="contained" color="error" onClick={() => onSelect(m)} sx={{ mt: 1, minHeight: 40 }}>Submit reason</Button>
      </CardContent>
    </Card>
  );
}

function MachineLabel({ m, alarmText, onSelect }) {
  const k = level(m.oee, m.targets?.oee);
  const off = m.status === 'disconnected';
  return (
    <Box sx={{ textAlign: 'center', width: 176, pb: 1 }}>
      <Card sx={{ px: 1.25, py: 0.75, borderRadius: 2.5, borderTop: `3px solid ${off || !m.active ? '#94A3B8' : k ? LEVELS[k].bar : C.blue}` }}>
        <Stack direction="row" alignItems="center" justifyContent="center" gap={1}>
          {k && m.active && !off && (
            <Box
              aria-label={LEVELS[k].label}
              sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: LEVELS[k].bar, color: '#fff', fontWeight: 800, fontSize: 11, display: 'grid', placeItems: 'center' }}
            >
              {ICON[k]}
            </Box>
          )}
          <Typography fontWeight={800} fontSize={13}>{m.code}</Typography>
        </Stack>
        <Typography sx={{ fontSize: 11.5 }} noWrap>{m.name}</Typography>
        {!m.active ? (
          <Typography sx={{ fontSize: 11 }} color="text.secondary">Inactive</Typography>
        ) : off ? (
          <Typography sx={{ fontSize: 11 }} color="text.secondary" fontWeight={700}>Not connected</Typography>
        ) : (
          <>
            <Typography sx={{ fontSize: 11 }} color="text.secondary">
              Total <b>{num(m.total)}</b> · Good <b>{num(m.total - m.ng)}/{num(m.total)}</b>
            </Typography>
            <PlanBar m={m} />
          </>
        )}
      </Card>
    </Box>
  );
}

function HoverCard({ m }) {
  return (
    <Card sx={{ width: 250, boxShadow: '0 8px 24px rgba(15,23,42,0.18)' }}>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="overline" component="div" lineHeight={1.4}>{m.code} · THIS SHIFT</Typography>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography fontWeight={800}>OEE {pct(m.oee)}</Typography>
          <LevelChip value={m.oee} target={m.targets?.oee} />
        </Stack>
        <Typography variant="body2" color="text.secondary" mb={1}>
          Target {m.targets?.oee?.target}% · Good {num(m.total - m.ng)} / plan {num(m.plan?.toNow)} · NC {num(m.ng)}
        </Typography>
        <Stack spacing={1}>
          {['availability', 'performance', 'quality'].map((key) => (
            <FactorBar key={key} label={key[0].toUpperCase() + key.slice(1)} value={m[key]} target={m.targets?.[key]} />
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

function Machine({ m, x, z, alarmText, reduced, onSelect, celebrate }) {
  const ram = useRef();
  const light = useRef();
  const [hover, setHover] = useState(false);
  const [popups, pushPopup] = usePopups();
  const prev = useRef(m);

  // "+1" when the counter rises, red "NC" (non-conformance) when a reject is counted.
  useEffect(() => {
    const p = prev.current;
    if (m.tags && p.tags) {
      const made = m.tags.totalCount - p.tags.totalCount;
      if (made > 0) pushPopup({ text: `+${made}`, color: C.blueDark, dx: -0.6 });
      if (m.tags.rejectCount > p.tags.rejectCount) pushPopup({ text: 'NC', color: LEVELS.below.color, dx: 0.6 });
    }
    prev.current = m;
  }, [m]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (celebrate) pushPopup({ text: `+${celebrate.points} pts`, color: LEVELS.good.color, big: true });
  }, [celebrate?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = m.status === 'running';
  const stopped = m.status === 'stopped';
  const period = Math.min(10, Math.max(0.6, m.idealCycleTime || 2)); // one press stroke per ideal cycle
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ram.current && running && !reduced) ram.current.position.y = 1.75 - 0.45 * (0.5 + 0.5 * Math.cos((2 * Math.PI * t) / period));
    if (light.current) light.current.visible = !stopped || reduced || Math.floor(t * 2) % 2 === 0; // blinks while stopped
  });

  const k = m.active && m.status !== 'disconnected' ? level(m.oee, m.targets?.oee) ?? 'none' : 'none';
  const body = m.active ? C.blue : GREY;
  const pale = m.active ? C.light : '#ECEFF1';
  const dark = m.active ? C.blueDark : '#B0BEC5';
  const select = (e) => (e.stopPropagation(), onSelect(m));

  return (
    <group position={[x, 0, z]}>
      <group
        onClick={select}
        onPointerOver={(e) => (e.stopPropagation(), setHover(true), (document.body.style.cursor = 'pointer'))}
        onPointerOut={() => (setHover(false), (document.body.style.cursor = ''))}
      >
        <mesh position={[0, 0.15, 0]}><boxGeometry args={[2.6, 0.3, 2]} /><meshStandardMaterial color={dark} /></mesh>
        {[[-1.1, -0.8], [1.1, -0.8], [-1.1, 0.8], [1.1, 0.8]].map(([cx, cz]) => (
          <mesh key={`${cx}${cz}`} position={[cx, 1.45, cz]}><boxGeometry args={[0.22, 2.3, 0.22]} /><meshStandardMaterial color={body} /></mesh>
        ))}
        <mesh position={[0, 2.8, 0]}><boxGeometry args={[2.6, 0.5, 2]} /><meshStandardMaterial color={body} /></mesh>
        <mesh position={[0, 0.6, 0]}><boxGeometry args={[1.8, 0.6, 1.4]} /><meshStandardMaterial color={pale} /></mesh>
        <mesh ref={ram} position={[0, 1.75, 0]}><boxGeometry args={[1.6, 0.5, 1.2]} /><meshStandardMaterial color={dark} /></mesh>
        {/* front control panel the operator checks during a stop */}
        <mesh position={[1.6, 1.1, 0.9]}><boxGeometry args={[0.5, 0.9, 0.3]} /><meshStandardMaterial color={pale} /></mesh>
        <mesh position={[1.6, 1.25, 1.06]}><boxGeometry args={[0.36, 0.3, 0.02]} /><meshStandardMaterial color={stopped ? '#B23C00' : '#0F172A'} /></mesh>
        <mesh ref={light} position={[0, 3.25, 0]}>
          <cylinderGeometry args={[0.16, 0.16, 0.35, 16]} />
          <meshStandardMaterial color={stopped ? '#475569' : '#E2E8F0'} emissive={stopped ? '#64748B' : '#000000'} emissiveIntensity={stopped ? 1.2 : 0} />
        </mesh>
      </group>
      {/* OEE ring on the floor: colour by judgement; the label above carries the icon too */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[1.9, 2.2, 48]} />
        <meshBasicMaterial color={RING[k]} />
      </mesh>
      {/* label sits above the stop light, so the press itself stays visible */}
      <Label position={[0, 3.9, 0]} anchor="bottom">
        <MachineLabel m={m} alarmText={alarmText} onSelect={onSelect} />
      </Label>
      {/* the stop card sits left of the machine so it never hides the press or its label */}
      {m.status === 'stopped' && m.openStop && (
        <Label position={[-1.9, 2, 0]} anchor="right" zIndexRange={[200, 101]}>
          <DowntimeCard m={m} alarmText={alarmText} onSelect={onSelect} />
        </Label>
      )}
      {/* hover details: beside the machine and stacked above every label */}
      {hover && m.active && (
        <Label position={[1.5, 2.2, 0]} anchor="left" zIndexRange={[400, 300]}>
          <HoverCard m={m} />
        </Label>
      )}
      <Popups items={popups} reduced={reduced} />
      {m.crew.map((o, i) => (
        <Character
          key={o.id}
          name={o.name}
          home={i % 2 ? [1.9, 0, -0.7 - Math.floor(i / 2) * 0.9] : [-1.9, 0, 0.9 - Math.floor(i / 2) * 0.9]}
          panel={[1.6, 0, 1.7]}
          status={m.active ? m.status : 'inactive'}
          lead={i === 0}
          celebrate={i === 0 ? celebrate?.key : undefined}
          reduced={reduced}
          onClick={select}
        />
      ))}
    </group>
  );
}

const SKIN = '#F1C9A5';
const SHIRT = '#0288D1';
const PANTS = '#263238';
const HAT = '#FFB300';

// Operator: works at home, is surprised by a stop, walks to the panel to check it, walks back when it runs.
function Character({ name, home, panel, status, lead, celebrate, reduced, onClick }) {
  const root = useRef();
  const torso = useRef();
  const armL = useRef();
  const armR = useRef();
  const legL = useRef();
  const legR = useRef();
  const homeV = useMemo(() => new Vector3(...home), [home[0], home[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  const panelV = useMemo(() => new Vector3(...panel), [panel[0], panel[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useRef({ mode: 'idle', t: 0, target: null, then: 'idle' });
  const statusRef = useRef(status);
  const [bubble, setBubble] = useState(null); // '!' | 'thumb' | null

  const go = (mode, extra = {}) => Object.assign(st.current, { mode, t: 0, ...extra });
  const walkTo = (target, then) => (reduced ? (root.current.position.copy(target), go(then)) : go('walk', { target, then }));
  // Where to be for the current machine state.
  const settle = () => {
    const s = statusRef.current;
    const atPanel = root.current.position.distanceTo(panelV) < 0.3;
    if (s === 'stopped' && lead) return atPanel ? go('check') : walkTo(panelV, 'check');
    if (root.current.position.distanceTo(homeV) > 0.3) return walkTo(homeV, s === 'running' ? 'work' : 'idle');
    go(s === 'running' ? 'work' : 'idle');
  };

  useEffect(() => {
    const prev = statusRef.current;
    statusRef.current = status;
    if (!root.current) return;
    if (prev === 'running' && status === 'stopped') {
      go('surprised');
      setBubble('!');
      const t = setTimeout(() => (setBubble(null), settle()), 1200);
      return () => clearTimeout(t);
    }
    settle();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!celebrate || !root.current) return;
    go('thumbs');
    setBubble('thumb');
    const t = setTimeout(() => (setBubble(null), settle()), 2000);
    return () => clearTimeout(t);
  }, [celebrate]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => {
    const s = st.current;
    const r = root.current;
    if (!r) return;
    s.t += dt;
    const swing = reduced ? 0 : Math.sin(s.t * 7);
    let arm = [0, 0];
    let leg = 0;
    let lift = 0;
    let lean = 0;
    if (s.mode === 'work') {
      arm = [-0.9 + swing * 0.5, -0.9 - swing * 0.5];
      r.rotation.y = homeV.x > 0 ? -Math.PI / 2 : Math.PI / 2; // facing the machine from either side
    } else if (s.mode === 'surprised') {
      arm = [-2.6, -2.6];
      lift = reduced ? 0 : Math.max(0, Math.sin(Math.min(s.t, 0.45) * (Math.PI / 0.45))) * 0.35;
    } else if (s.mode === 'walk') {
      const d = s.target.clone().sub(r.position);
      d.y = 0;
      const dist = d.length();
      if (dist < 0.05) go(s.then);
      else {
        r.position.addScaledVector(d.normalize(), Math.min(dist, dt * 2));
        r.rotation.y = Math.atan2(d.x, d.z);
      }
      arm = [swing * 0.6, -swing * 0.6];
      leg = swing * 0.6;
    } else if (s.mode === 'check') {
      r.rotation.y = Math.PI; // facing the panel
      arm = [0, -1.3 + (reduced ? 0 : Math.sin(s.t * 3) * 0.15)];
      lean = 0.2;
    } else if (s.mode === 'thumbs') {
      arm = [0, -2.9];
      r.rotation.y = 0; // facing the viewer
    }
    armL.current.rotation.x = arm[0];
    armR.current.rotation.x = arm[1];
    legL.current.rotation.x = leg;
    legR.current.rotation.x = -leg;
    torso.current.rotation.x = lean;
    r.position.y = lift;
  });

  return (
    <group ref={root} position={home} onClick={onClick}>
      <mesh ref={legL} position={[-0.11, 0.62, 0]}><boxGeometry args={[0.16, 0.62, 0.18]} /><meshStandardMaterial color={PANTS} /></mesh>
      <mesh ref={legR} position={[0.11, 0.62, 0]}><boxGeometry args={[0.16, 0.62, 0.18]} /><meshStandardMaterial color={PANTS} /></mesh>
      <group ref={torso} position={[0, 0.95, 0]}>
        <mesh position={[0, 0.3, 0]}><capsuleGeometry args={[0.2, 0.35, 4, 10]} /><meshStandardMaterial color={SHIRT} /></mesh>
        <group ref={armL} position={[-0.3, 0.52, 0]}>
          <mesh position={[0, -0.25, 0]}><boxGeometry args={[0.11, 0.5, 0.12]} /><meshStandardMaterial color={SHIRT} /></mesh>
        </group>
        <group ref={armR} position={[0.3, 0.52, 0]}>
          <mesh position={[0, -0.25, 0]}><boxGeometry args={[0.11, 0.5, 0.12]} /><meshStandardMaterial color={SHIRT} /></mesh>
        </group>
        <mesh position={[0, 0.78, 0]}><sphereGeometry args={[0.18, 14, 12]} /><meshStandardMaterial color={SKIN} /></mesh>
        <mesh position={[0, 0.9, 0]}><sphereGeometry args={[0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={HAT} /></mesh>
      </group>
      <Label position={[0, 2.25, 0]}>
        <Stack alignItems="center" gap={0.5} sx={{ pointerEvents: 'none' }}>
          {bubble === '!' && <Box sx={{ px: 1, borderRadius: 2, bgcolor: '#fff', border: `2px solid ${LEVELS.below.bar}`, color: LEVELS.below.color, fontWeight: 900 }}>!</Box>}
          {bubble === 'thumb' && <Box sx={{ p: 0.5, borderRadius: 2, bgcolor: '#fff', border: `2px solid ${LEVELS.good.bar}`, color: LEVELS.good.color, display: 'flex' }}><ThumbUpIcon fontSize="small" /></Box>}
          <Box sx={{ px: 0.75, borderRadius: 1, bgcolor: 'rgba(15,23,42,0.75)', color: '#fff', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{name}</Box>
        </Stack>
      </Label>
    </group>
  );
}

// drei <Html> attaches to the canvas's event target, which only exists once the canvas is connected. Html mounted
// before that is re-attached and, with React 19, left empty; so mount labelled content after the connection.
function WhenConnected({ children }) {
  const connected = useThree((s) => s.events.connected);
  return connected ? children : null;
}

// Moves the camera to a goal (line or reset view); any user drag cancels the flight.
function CameraRig({ goal, reduced }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  useEffect(() => {
    if (!controls) return;
    const cancel = () => (goal.current = null);
    controls.addEventListener('start', cancel);
    return () => controls.removeEventListener('start', cancel);
  }, [controls, goal]);
  useFrame((_, dt) => {
    const g = goal.current;
    if (!g || !controls) return;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 3);
    camera.position.lerp(g.pos, k);
    controls.target.lerp(g.target, k);
    controls.update();
    if (camera.position.distanceTo(g.pos) < 0.05) goal.current = null;
  });
  return null;
}

export const viewOfLine = (row) => ({ target: new Vector3(0, 1, row.z), pos: new Vector3(0, 8 + row.machines.length * 1.5, row.z + 10 + row.machines.length * 2) });
export function overview(rows) {
  const width = Math.max(1, ...rows.map((r) => r.machines.length)) * MACHINE_GAP;
  const depth = rows.length * ROW_GAP;
  const extent = Math.max(width, depth);
  const cz = ((rows.length - 1) * ROW_GAP) / 2;
  return { target: new Vector3(0, 2, cz), pos: new Vector3(0, extent * 0.75 + 8, cz + extent * 0.9 + 11) };
}

export default function FloorScene({ rows, alarmText, reduced, onSelect, celebrate, goal }) {
  const start = useMemo(() => overview(rows), [rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const width = Math.max(1, ...rows.map((r) => r.machines.length)) * MACHINE_GAP + 10;
  const depth = rows.length * ROW_GAP + 6;
  return (
    <Canvas camera={{ position: start.pos.toArray(), fov: 45 }} dpr={[1, 1.75]} onPointerMissed={() => (document.body.style.cursor = '')}>
      <color attach="background" args={['#F3F7FC']} />
      <hemisphereLight args={['#ffffff', '#CFD8DC', 1.1]} />
      <directionalLight position={[8, 14, 10]} intensity={1.4} />
      <OrbitControls makeDefault target={start.target.toArray()} maxPolarAngle={Math.PI / 2.15} minDistance={5} maxDistance={120} enableDamping={!reduced} />
      <CameraRig goal={goal} reduced={reduced} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, ((rows.length - 1) * ROW_GAP) / 2]}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>
      <WhenConnected>
      {rows.map((row) => (
        <group key={row.name}>
          {/* row stripe and its line name; clicking the name flies the camera to the line */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, row.z]}>
            <planeGeometry args={[width - 4, ROW_GAP - 2.5]} />
            <meshBasicMaterial color={C.light} />
          </mesh>
          {/* line names (and fly-to) are buttons on the overlay above the canvas, see Floor.jsx */}
          {row.machines.map(({ m, x }) => (
            <Machine key={m.id} m={m} x={x} z={row.z} alarmText={alarmText(m.openStop?.alarmCode)} reduced={reduced} onSelect={onSelect} celebrate={celebrate[m.id]} />
          ))}
        </group>
      ))}
      </WhenConnected>
    </Canvas>
  );
}
