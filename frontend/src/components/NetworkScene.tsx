import { Canvas, useFrame } from "@react-three/fiber";
import { Component, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";

function Geometry({ reduced }: { reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const particles = useMemo(() => {
    const vertices: number[] = [];
    // Decorative mathematical geometry; it never represents telemetry.
    for (let i = 0; i < 320; i++) {
      const y = 1 - (i / 319) * 2,
        r = Math.sqrt(1 - y * y),
        theta = i * Math.PI * (3 - Math.sqrt(5));
      vertices.push(
        Math.cos(theta) * r * 2.05,
        y * 2.05,
        Math.sin(theta) * r * 2.05,
      );
    }
    return new Float32Array(vertices);
  }, []);
  useFrame((state, delta) => {
    if (group.current && !reduced) {
      group.current.rotation.y += delta * 0.075;
      group.current.rotation.z =
        Math.sin(state.clock.elapsedTime * 0.12) * 0.06;
    }
  });
  return (
    <group ref={group} rotation={[0.25, 0.3, -0.25]}>
      <mesh>
        <icosahedronGeometry args={[1.72, 2]} />
        <meshBasicMaterial
          color="#d4ae6a"
          wireframe
          transparent
          opacity={0.22}
        />
      </mesh>
      <mesh rotation={[0.3, 0.1, 0.5]}>
        <icosahedronGeometry args={[1.3, 1]} />
        <meshBasicMaterial
          color="#edc782"
          wireframe
          transparent
          opacity={0.42}
        />
      </mesh>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particles, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.035}
          color="#f1d39d"
          transparent
          opacity={0.8}
          sizeAttenuation
        />
      </points>
      {[0, 1, 2].map((i) => (
        <mesh key={i} rotation={[Math.PI / 2 + i * 0.7, i * 0.7, 0]}>
          <torusGeometry args={[2.28, 0.006, 6, 180]} />
          <meshBasicMaterial color="#9d9279" transparent opacity={0.35} />
        </mesh>
      ))}
      <mesh>
        <sphereGeometry args={[0.43, 32, 32]} />
        <meshBasicMaterial
          color="#e9c080"
          wireframe
          transparent
          opacity={0.3}
        />
      </mesh>
    </group>
  );
}

class SceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="scene-fallback">
        <span />
        <span />
        <span />
      </div>
    ) : (
      this.props.children
    );
  }
}

export default function NetworkScene({ reduced }: { reduced: boolean }) {
  return (
    <SceneBoundary>
      <Canvas
        aria-label="Decorative rotating network geometry"
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 6.8], fov: 44 }}
        gl={{ alpha: true, antialias: true }}
        frameloop={reduced ? "demand" : "always"}
      >
        <Geometry reduced={reduced} />
      </Canvas>
    </SceneBoundary>
  );
}
