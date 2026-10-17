// 3D view of the press anatomy (same parts as the drawing): drag to turn, the lit part glows orange,
// sensor parts carry a blue marker, the slide strokes while the press runs.
import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import { TONES } from './pressParts.js';

const ACCENT = '#F97316';

function Part({ p, lit, running, reduced, onHover, onPick }) {
  const ref = useRef();
  const mat = useRef();
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (p.moves && ref.current) ref.current.position.y = base[1] + (running && !reduced ? -0.22 * (0.5 + 0.5 * Math.cos(t * 4)) : 0);
    if (lit && mat.current) mat.current.emissiveIntensity = reduced ? 0.6 : 0.35 + 0.35 * Math.sin(t * 5);
  });
  const color = lit ? ACCENT : TONES[p.tone];
  const hover = p.part ? { onPointerOver: (e) => (e.stopPropagation(), onHover(p.id)), onPointerOut: () => onHover(null), onClick: (e) => (e.stopPropagation(), onPick(p.id)) } : {};
  let base;
  if (p.kind === 'line') {
    return <Line points={p.points} color={color} lineWidth={lit ? 6 : 4} {...hover} />;
  }
  if (p.kind === 'box') {
    base = [p.pos[0] + p.size[0] / 2, p.pos[1] + p.size[1] / 2, p.pos[2] + p.size[2] / 2];
    return (
      <mesh ref={ref} position={base} {...hover}>
        <boxGeometry args={p.size} />
        <meshStandardMaterial ref={mat} color={color} emissive={lit ? ACCENT : '#000000'} emissiveIntensity={lit ? 0.5 : 0} />
      </mesh>
    );
  }
  base = p.center;
  return (
    <mesh ref={ref} position={base} rotation={p.kind === 'cylX' ? [0, 0, Math.PI / 2] : [0, 0, 0]} {...hover}>
      <cylinderGeometry args={[p.r, p.r, p.len, 32]} />
      <meshStandardMaterial ref={mat} color={color} emissive={lit ? ACCENT : '#000000'} emissiveIntensity={lit ? 0.5 : 0} />
    </mesh>
  );
}

const markerAt = (p) => (p.kind === 'box' ? [p.pos[0] + p.size[0] / 2, p.pos[1] + p.size[1] + 0.12, p.pos[2] + p.size[2] / 2] : p.kind === 'line' ? p.points.at(-1) : [p.center[0], p.center[1] + p.r + 0.12, p.center[2]]);

export default function Press3D({ parts, litId, running, reduced, onHover, onPick }) {
  return (
    <Canvas camera={{ position: [6.5, 5.2, 7.5], fov: 38 }} dpr={[1, 1.75]} onPointerMissed={() => onHover(null)}>
      <color attach="background" args={['#FBFDFF']} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[6, 10, 6]} intensity={1.3} />
      <OrbitControls target={[0, 2.2, 0]} maxPolarAngle={Math.PI / 2.05} minDistance={4} maxDistance={20} enableDamping={!reduced} />
      {parts.map((p) => <Part key={p.id} p={p} lit={p.id === litId} running={running} reduced={reduced} onHover={onHover} onPick={onPick} />)}
      {/* a marker on every sensor part, inside a wide invisible ball so it is easy to point at */}
      {parts.filter((p) => p.part).map((p) => (
        <group
          key={`m-${p.id}`} position={markerAt(p)}
          onPointerOver={(e) => (e.stopPropagation(), onHover(p.id), (document.body.style.cursor = 'pointer'))}
          onPointerOut={() => (onHover(null), (document.body.style.cursor = ''))}
          onClick={(e) => (e.stopPropagation(), onPick(p.id))}
        >
          <mesh><sphereGeometry args={[p.id === litId ? 0.11 : 0.08, 16, 12]} /><meshBasicMaterial color={p.id === litId ? ACCENT : '#1565C0'} /></mesh>
          <mesh><sphereGeometry args={[0.3, 12, 8]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} /></mesh>
        </group>
      ))}
    </Canvas>
  );
}
