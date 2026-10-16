// The Machine Soul character: a chibi stamping press whose crown is its face.
// emotion: happy | calm | worried | sad | alarmed | shocked | sleepy. talking = mouth moves (voice playing).
import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';

const BLUE = '#1565C0';
const DARK = '#0D47A1';
const LIGHT = '#E3F2FD';
const SKY = '#42A5F5';

// Per emotion: brow tilt (inner end up > 0), brow height, eyelid closure 0..1, mouth curve (+1 smile, -1 frown, 0 'o'),
// arm pose and ring colour under the press.
export const EMOTIONS = {
  happy: { tilt: -0.12, browY: 0.02, lid: 0, mouth: 1, arms: 'wave', ring: '#43A047', label: 'Happy' },
  calm: { tilt: 0, browY: 0, lid: 0.15, mouth: 0.6, arms: 'rest', ring: SKY, label: 'Calm' },
  worried: { tilt: 0.35, browY: 0.04, lid: 0.25, mouth: -0.4, arms: 'rest', ring: '#F9A825', label: 'Worried' },
  sad: { tilt: 0.45, browY: -0.02, lid: 0.45, mouth: -1, arms: 'down', ring: '#E53935', label: 'Sad' },
  alarmed: { tilt: -0.4, browY: -0.03, lid: 0, mouth: -0.8, arms: 'up', ring: '#E53935', label: 'Alarmed' },
  shocked: { tilt: 0, browY: 0.12, lid: 0, mouth: 0, arms: 'up', ring: '#E65100', label: 'Shocked' },
  sleepy: { tilt: 0.1, browY: -0.04, lid: 0.95, mouth: 0.2, arms: 'down', ring: '#94A3B8', label: 'Sleepy' },
};

function Eye({ x, e }) {
  const lid = useRef();
  useFrame(({ clock }) => {
    const blink = Math.sin(clock.elapsedTime * 1.7 + x) > 0.995 ? 1 : 0; // a blink now and then
    const target = Math.max(e.lid, blink);
    lid.current.scale.y += (target - lid.current.scale.y) * 0.25;
    lid.current.position.y = 0.2 - lid.current.scale.y * 0.2;
  });
  return (
    <group position={[x, 0.08, 0.66]}>
      <mesh scale={[1, 1, 0.5]}><sphereGeometry args={[0.2, 24, 16]} /><meshStandardMaterial color="#FFFFFF" /></mesh>
      <mesh position={[0, -0.02, 0.09]}><sphereGeometry args={[0.095, 16, 12]} /><meshStandardMaterial color="#0F172A" /></mesh>
      <mesh position={[0.03, 0.03, 0.17]}><sphereGeometry args={[0.03, 8, 8]} /><meshStandardMaterial color="#FFFFFF" emissive="#FFFFFF" /></mesh>
      {/* eyelid: grows down from the top of the eye */}
      <mesh ref={lid} position={[0, 0.2, 0.06]} scale={[1, 0, 1]}><boxGeometry args={[0.46, 0.42, 0.12]} /><meshStandardMaterial color={LIGHT} /></mesh>
    </group>
  );
}

function Mouth({ e, talking }) {
  const smile = useRef();
  const open = useRef();
  useFrame(({ clock }) => {
    const amp = talking ? 0.35 + 0.65 * Math.abs(Math.sin(clock.elapsedTime * 14)) : 0;
    open.current.visible = talking || e.mouth === 0;
    smile.current.visible = !open.current.visible;
    open.current.scale.y = talking ? 0.25 + amp * 0.75 : 0.9;
  });
  const curve = Math.abs(e.mouth) < 0.05 ? 0.3 : e.mouth;
  return (
    <group position={[0, -0.32, 0.67]}>
      {/* smile (curve > 0) or frown (< 0): half a torus, flipped */}
      <mesh ref={smile} rotation={[0, 0, curve > 0 ? Math.PI : 0]} scale={[1, Math.max(0.35, Math.abs(curve)), 1]}>
        <torusGeometry args={[0.24, 0.05, 8, 24, Math.PI]} />
        <meshStandardMaterial color="#0F172A" />
      </mesh>
      {/* open mouth for talking or an 'o' of surprise */}
      <mesh ref={open} scale={[1, 0.9, 0.4]}><sphereGeometry args={[0.15, 20, 14]} /><meshStandardMaterial color="#7F1D1D" /></mesh>
    </group>
  );
}

function Arm({ side, e }) {
  const pivot = useRef();
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const base = { rest: 0.35, down: 0.12, up: 2.4, wave: side > 0 ? 2.2 : 0.35 }[e.arms];
    const wiggle = e.arms === 'wave' && side > 0 ? Math.sin(t * 6) * 0.45 : e.arms === 'up' ? Math.sin(t * 9 + side) * 0.2 : 0;
    const target = side * (base + wiggle);
    pivot.current.rotation.z += (target - pivot.current.rotation.z) * 0.15;
  });
  return (
    <group ref={pivot} position={[side * 1.32, -0.1, 0]}>
      <mesh position={[side * 0.05, -0.42, 0]}><capsuleGeometry args={[0.09, 0.62, 6, 12]} /><meshStandardMaterial color={BLUE} /></mesh>
      <mesh position={[side * 0.05, -0.85, 0]}><sphereGeometry args={[0.14, 14, 10]} /><meshStandardMaterial color={LIGHT} /></mesh>
    </group>
  );
}

// Steam (alarmed / shocked) or sleep bubbles (sleepy) rising from the crown.
function Puffs({ kind }) {
  const refs = [useRef(), useRef(), useRef()];
  useFrame(({ clock }) => {
    refs.forEach((r, i) => {
      const t = (clock.elapsedTime * (kind === 'sleep' ? 0.35 : 0.9) + i / 3) % 1;
      r.current.position.set((kind === 'sleep' ? 0.7 : -0.6 + i * 0.6) + t * (kind === 'sleep' ? 0.5 : 0), 0.75 + t * 1.2, 0);
      r.current.scale.setScalar((kind === 'sleep' ? 0.08 + i * 0.05 : 0.18) * (0.6 + t));
      r.current.material.opacity = 1 - t;
    });
  });
  return refs.map((r, i) => (
    <mesh key={i} ref={r}>
      <sphereGeometry args={[1, 14, 10]} />
      <meshStandardMaterial color={kind === 'sleep' ? '#B0BEC5' : '#FFFFFF'} transparent opacity={0.8} />
    </mesh>
  ));
}

function Press({ emotion, talking, running }) {
  const e = EMOTIONS[emotion] ?? EMOTIONS.calm;
  const body = useRef();
  const ram = useRef();
  const brows = [useRef(), useRef()];
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // breathing bob; a nervous shake when alarmed or shocked
    const shake = emotion === 'alarmed' || emotion === 'shocked' ? Math.sin(t * 40) * 0.025 : 0;
    body.current.position.set(shake, Math.sin(t * 1.6) * 0.04, 0);
    body.current.rotation.z = emotion === 'sleepy' ? Math.sin(t * 0.8) * 0.04 : 0;
    ram.current.position.y = running ? 1.55 + 0.22 * Math.cos(t * 4) : 1.75; // the slide strokes while running
    brows.forEach((b, i) => {
      const side = i ? 1 : -1;
      b.current.rotation.z += (-side * e.tilt - b.current.rotation.z) * 0.2;
      b.current.position.y += (0.42 + e.browY - b.current.position.y) * 0.2;
    });
  });
  return (
    <group ref={body}>
      {/* bed, feet, bolster with die set */}
      <mesh position={[0, 0.3, 0]}><boxGeometry args={[2.5, 0.55, 1.4]} /><meshStandardMaterial color={DARK} /></mesh>
      {[-1, 1].map((x) => <mesh key={x} position={[x * 1.05, 0.03, 0]}><boxGeometry args={[0.45, 0.08, 1.2]} /><meshStandardMaterial color="#FFB300" /></mesh>)}
      <mesh position={[0, 0.7, 0]}><boxGeometry args={[1.7, 0.22, 1.0]} /><meshStandardMaterial color="#90CAF9" /></mesh>
      <mesh position={[0, 0.9, 0]}><boxGeometry args={[1.2, 0.2, 0.75]} /><meshStandardMaterial color="#2E7D32" /></mesh>
      {/* columns and the moving slide (ram) */}
      {[-1, 1].map((x) => <mesh key={x} position={[x * 1.02, 1.45, 0]}><boxGeometry args={[0.3, 1.8, 0.34]} /><meshStandardMaterial color={BLUE} /></mesh>)}
      <mesh ref={ram} position={[0, 1.75, 0]}><boxGeometry args={[1.5, 0.32, 0.9]} /><meshStandardMaterial color={SKY} /></mesh>
      {/* crown = head */}
      <group position={[0, 2.85, 0]}>
        <RoundedBox args={[2.6, 1.3, 1.3]} radius={0.26} smoothness={4}><meshStandardMaterial color={LIGHT} /></RoundedBox>
        <mesh position={[0, 0.68, 0]}><boxGeometry args={[1.6, 0.12, 0.9]} /><meshStandardMaterial color={BLUE} /></mesh>
        {[-0.42, 0.42].map((x) => <Eye key={x} x={x} e={e} />)}
        {[-0.42, 0.42].map((x, i) => (
          <mesh key={x} ref={brows[i]} position={[x, 0.42, 0.66]}><boxGeometry args={[0.36, 0.07, 0.06]} /><meshStandardMaterial color="#0F172A" /></mesh>
        ))}
        {emotion === 'happy' && [-0.78, 0.78].map((x) => <mesh key={x} position={[x, -0.18, 0.62]} scale={[1, 0.6, 0.3]}><sphereGeometry args={[0.13, 12, 10]} /><meshStandardMaterial color="#F48FB1" /></mesh>)}
        <Mouth e={e} talking={talking} />
        <Arm side={-1} e={e} />
        <Arm side={1} e={e} />
        {(emotion === 'alarmed' || emotion === 'shocked') && <Puffs kind="steam" />}
        {emotion === 'sleepy' && <Puffs kind="sleep" />}
      </group>
      {/* emotion ring on the floor (colour is never the only signal: the page also names the mood) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <ringGeometry args={[1.55, 1.85, 48]} />
        <meshBasicMaterial color={e.ring} />
      </mesh>
    </group>
  );
}

export default function PressCharacter({ emotion, talking, running, reduced }) {
  return (
    <Canvas camera={{ position: [0, 2.4, 7], fov: 38 }} dpr={[1, 1.75]} frameloop={reduced ? 'demand' : 'always'} aria-hidden>
      <ambientLight intensity={0.75} />
      <directionalLight position={[3, 6, 5]} intensity={1.3} />
      <group position={[0, -1.7, 0]}>
        <Press emotion={emotion} talking={talking} running={running} />
      </group>
    </Canvas>
  );
}
