// The Machine Soul character: the face of a stamping press (glossy, Pixar-like toy look).
// emotion: happy | calm | worried | sad | alarmed | shocked | sleepy. talking = mouth moves (voice playing).
import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, RoundedBox } from '@react-three/drei';

const YELLOW = '#F7A912';
const GUN = '#2B2F36';

// Per emotion: brow tilt (inner end up > 0), brow height, eyelid closure 0..1 (0.5 = half), eye size, mouth curve
// (+1 smile, -1 frown, 0 'o'), body motion and the mood colour (shown with the mood label on the page).
export const EMOTIONS = {
  happy: { tilt: -0.18, browY: 0.04, lid: 0.12, eye: 1, mouth: 1, motion: 'hop', color: '#22C55E', label: 'Happy' },
  calm: { tilt: 0.05, browY: 0, lid: 0.28, eye: 1, mouth: 0.55, motion: 'breathe', color: '#38BDF8', label: 'Calm' },
  worried: { tilt: 0.4, browY: 0.05, lid: 0.3, eye: 1, mouth: -0.45, motion: 'breathe', color: '#F59E0B', label: 'Worried' },
  sad: { tilt: 0.55, browY: -0.03, lid: 0.45, eye: 0.95, mouth: -1, motion: 'droop', color: '#EF4444', label: 'Sad' },
  alarmed: { tilt: -0.5, browY: -0.06, lid: 0.1, eye: 1.05, mouth: -0.8, motion: 'shake', color: '#EF4444', label: 'Alarmed' },
  shocked: { tilt: 0.05, browY: 0.16, lid: 0, eye: 1.18, mouth: 0, motion: 'shake', color: '#F97316', label: 'Shocked' },
  sleepy: { tilt: 0.12, browY: -0.05, lid: 0.85, eye: 1, mouth: 0.2, motion: 'sway', color: '#94A3B8', label: 'Sleepy' },
};

const Gloss = ({ color = YELLOW }) => <meshPhysicalMaterial color={color} roughness={0.32} clearcoat={1} clearcoatRoughness={0.12} />;
const Metal = ({ color = GUN, rough = 0.32 }) => <meshStandardMaterial color={color} metalness={0.85} roughness={rough} />;

function Eye({ x, e }) {
  const eye = useRef();
  const lid = useRef();
  const look = useRef();
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const blink = Math.sin(t * 1.3 + x * 3) > 0.993 ? 1 : 0; // a blink now and then
    const target = -Math.PI / 2 + Math.max(e.lid, blink) * Math.PI; // lid swings from behind the eye over it
    lid.current.rotation.x += (target - lid.current.rotation.x) * 0.3;
    eye.current.scale.lerp({ x: e.eye, y: e.eye, z: e.eye }, 0.15);
    // pupils wander a little
    look.current.position.x = Math.sin(t * 0.5) * 0.035;
    look.current.position.y = Math.sin(t * 0.37) * 0.02 - (e.motion === 'droop' ? 0.04 : 0);
  });
  return (
    <group ref={eye} position={[x, 1.48, 0.72]}>
      <group scale={[1, 1.08, 0.62]}>
        <mesh><sphereGeometry args={[0.45, 40, 28]} /><meshPhysicalMaterial color="#FFFFFF" roughness={0.12} clearcoat={1} /></mesh>
        {/* eyelid: a body-coloured shell that rolls down over the eye */}
        <mesh ref={lid} rotation={[-Math.PI / 2, 0, 0]}>
          <sphereGeometry args={[0.468, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <Gloss />
        </mesh>
      </group>
      <group ref={look} position={[0, 0, 0.25]}>
        <mesh position={[0, -0.01, 0]} scale={[1, 1.05, 0.3]}><sphereGeometry args={[0.25, 32, 20]} /><meshPhysicalMaterial color="#C26A0A" roughness={0.25} clearcoat={1} /></mesh>
        <mesh position={[0, -0.01, 0.055]} scale={[1, 1.05, 0.3]}><sphereGeometry args={[0.14, 24, 16]} /><meshStandardMaterial color="#0B0B0F" roughness={0.2} /></mesh>
        <mesh position={[0.09, 0.1, 0.1]}><sphereGeometry args={[0.055, 16, 12]} /><meshBasicMaterial color="#FFFFFF" /></mesh>
        <mesh position={[-0.07, -0.09, 0.09]}><sphereGeometry args={[0.025, 10, 8]} /><meshBasicMaterial color="#FFFFFF" /></mesh>
      </group>
    </group>
  );
}

function Mouth({ e, talking }) {
  const line = useRef();
  const open = useRef();
  useFrame(({ clock }) => {
    const amp = talking ? 0.3 + 0.7 * Math.abs(Math.sin(clock.elapsedTime * 13)) : 0;
    open.current.visible = talking || e.mouth === 0;
    line.current.visible = !open.current.visible;
    open.current.scale.y = talking ? 0.3 + amp * 0.7 : 0.85;
  });
  const curve = Math.abs(e.mouth) < 0.05 ? 0.3 : e.mouth;
  return (
    <group position={[0.03, 0.9, 0.82]}>
      <mesh ref={line} rotation={[0, 0, curve > 0 ? Math.PI : 0]} scale={[1, Math.max(0.4, Math.abs(curve)) * 0.8, 1]}>
        <torusGeometry args={[0.24, 0.035, 12, 32, Math.PI]} />
        <meshStandardMaterial color="#1A1210" roughness={0.4} />
      </mesh>
      <group ref={open} scale={[1, 0.85, 1]}>
        <mesh scale={[1.25, 1, 0.35]}><sphereGeometry args={[0.15, 24, 16]} /><meshStandardMaterial color="#5B1515" roughness={0.6} /></mesh>
        <mesh position={[0, -0.07, 0.03]} scale={[1.2, 0.5, 0.35]}><sphereGeometry args={[0.1, 16, 12]} /><meshStandardMaterial color="#E86A6A" roughness={0.5} /></mesh>
      </group>
    </group>
  );
}

// Steam (alarmed / shocked) or sleep bubbles (sleepy) rising from the top.
function Puffs({ kind }) {
  const refs = [useRef(), useRef(), useRef()];
  useFrame(({ clock }) => {
    refs.forEach((r, i) => {
      const t = (clock.elapsedTime * (kind === 'sleep' ? 0.35 : 0.9) + i / 3) % 1;
      r.current.position.set((kind === 'sleep' ? 1 : -0.7 + i * 0.7) + t * (kind === 'sleep' ? 0.5 : 0), 2.45 + t * 0.9, 0);
      r.current.scale.setScalar((kind === 'sleep' ? 0.08 + i * 0.05 : 0.18) * (0.6 + t));
      r.current.material.opacity = 1 - t;
    });
  });
  return refs.map((r, i) => (
    <mesh key={i} ref={r}>
      <sphereGeometry args={[1, 16, 12]} />
      <meshStandardMaterial color={kind === 'sleep' ? '#CBD5E1' : '#FFFFFF'} transparent opacity={0.8} />
    </mesh>
  ));
}

function Face({ emotion, talking, running }) {
  const e = EMOTIONS[emotion] ?? EMOTIONS.calm;
  const body = useRef();
  const brows = [useRef(), useRef()];
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const m = e.motion;
    const shake = m === 'shake' ? Math.sin(t * 38) * 0.03 : 0;
    const y = m === 'hop' ? Math.abs(Math.sin(t * 3)) * 0.1 : m === 'droop' ? -0.05 + Math.sin(t * 1.1) * 0.02 : Math.sin(t * 1.6) * 0.035;
    body.current.position.set(shake, y, 0);
    body.current.rotation.z = m === 'sway' ? Math.sin(t * 0.8) * 0.05 : m === 'droop' ? -0.03 : 0;
    // slow look-around; a small working nod while the press strokes
    body.current.rotation.y = Math.sin(t * 0.4) * 0.14;
    body.current.rotation.x = running && m !== 'shake' && m !== 'sway' ? Math.sin(t * 4) * 0.015 : 0;
    body.current.scale.y = 1 + (m === 'hop' ? -Math.max(0, Math.cos(t * 6)) * 0.03 : 0); // squash on landing
    brows.forEach((b, i) => {
      const side = i ? 1 : -1;
      b.current.rotation.z += (Math.PI / 2 - side * e.tilt - b.current.rotation.z) * 0.2;
      b.current.position.y += (2.1 + e.browY - b.current.position.y) * 0.2;
    });
  });
  return (
    <group ref={body}>
      {/* the press crown as a face: glossy block, inset face panel, a bolt in each corner */}
      <RoundedBox args={[2.85, 1.85, 1.6]} radius={0.26} smoothness={6} position={[0, 1.42, 0]}><Gloss /></RoundedBox>
      <RoundedBox args={[2.45, 1.45, 0.06]} radius={0.05} smoothness={3} position={[0, 1.45, 0.79]}><Gloss color="#F39C0B" /></RoundedBox>
      {[[-1.1, 2.05], [1.1, 2.05], [-1.1, 0.82], [1.1, 0.82]].map(([x, y]) => (
        <group key={`${x}${y}`} position={[x, y, 0.83]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh><cylinderGeometry args={[0.075, 0.075, 0.05, 20]} /><Metal /></mesh>
          <mesh position={[0, 0.03, 0]}><cylinderGeometry args={[0.035, 0.035, 0.03, 6]} /><Metal color="#111" /></mesh>
        </group>
      ))}
      {[-0.6, 0.66].map((x) => <Eye key={x} x={x} e={e} />)}
      {[-0.6, 0.66].map((x, i) => (
        <mesh key={x} ref={brows[i]} position={[x, 2.06, 0.86]} rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.095, 0.5, 8, 16]} />
          <meshStandardMaterial color="#25262B" roughness={0.45} />
        </mesh>
      ))}
      {(emotion === 'happy' || emotion === 'calm') && [-1.1, 1.14].map((x) => (
        <mesh key={x} position={[x, 0.98, 0.8]} scale={[1, 0.55, 0.2]}><sphereGeometry args={[0.17, 16, 12]} /><meshStandardMaterial color="#F97316" transparent opacity={0.45} /></mesh>
      ))}
      <Mouth e={e} talking={talking} />
      {e.motion === 'shake' && <Puffs kind="steam" />}
      {emotion === 'sleepy' && <Puffs kind="sleep" />}
    </group>
  );
}

// Keep the face centred and in view whatever the box shape: back the camera off in narrow boxes.
function Fit() {
  const { camera, size } = useThree();
  useEffect(() => {
    camera.position.z = 6.2 * Math.max(1, 1.15 / (size.width / size.height));
    camera.lookAt(0, 0.25, 0);
  }, [camera, size.width, size.height]);
  return null;
}

export default function PressCharacter({ emotion, talking, running, reduced }) {
  return (
    <Canvas camera={{ position: [0, 0.6, 6.2], fov: 36 }} dpr={[1, 1.75]} frameloop={reduced ? 'demand' : 'always'} gl={{ alpha: true }} aria-hidden>
      <Fit />
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 7, 6]} intensity={2} />
      <directionalLight position={[-5, 3, -2]} intensity={0.6} color="#93C5FD" />
      {/* soft studio light for the glossy look, built locally (no HDR download) */}
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={3} position={[0, 5, 5]} scale={[10, 4, 1]} />
        <Lightformer form="rect" intensity={1.5} position={[-6, 2, 2]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[6, 2, 2]} rotation-y={-Math.PI / 2} scale={[6, 3, 1]} color="#FFE4B5" />
        <Lightformer form="ring" intensity={2} position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={4} />
      </Environment>
      <group position={[0, -1.3, 0]}>
        <Face emotion={emotion} talking={talking} running={running} />
        <ContactShadows position={[0, 0.2, 0]} opacity={0.35} scale={6} blur={2.6} far={2} />
      </group>
    </Canvas>
  );
}
