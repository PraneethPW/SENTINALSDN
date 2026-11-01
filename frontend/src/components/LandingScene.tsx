import { Component, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { MotionValue } from "framer-motion";
import * as THREE from "three";

function SignalCore({
  reduced,
  progress,
}: {
  reduced: boolean;
  progress: MotionValue<number>;
}) {
  const ref = useRef<THREE.Group>(null);
  const shell = useRef<THREE.Mesh>(null);
  const particles = useMemo(() => {
    const points = [];
    for (let i = 0; i < 180; i++) {
      const a = i * 2.39996323;
      const z = 1 - i / 90;
      const r = Math.sqrt(1 - z * z);
      points.push(Math.cos(a) * r * 2.65, z * 2.65, Math.sin(a) * r * 2.65);
    }
    return new Float32Array(points);
  }, []);
  useFrame((state, delta) => {
    if (!ref.current) return;
    const p = progress.get();
    if (!reduced) {
      ref.current.rotation.y += delta * 0.09;
      ref.current.rotation.z =
        Math.sin(state.clock.elapsedTime * 0.16) * 0.09 + p * 0.4;
      ref.current.position.y = Math.sin(state.clock.elapsedTime * 0.6) * 0.09;
      state.camera.position.x = THREE.MathUtils.lerp(
        state.camera.position.x,
        state.pointer.x * 0.3,
        0.025,
      );
      state.camera.position.y = THREE.MathUtils.lerp(
        state.camera.position.y,
        state.pointer.y * 0.22,
        0.025,
      );
      state.camera.lookAt(0, 0, 0);
      if (shell.current) {
        const size = 1 + Math.sin(state.clock.elapsedTime * 0.65) * 0.055;
        shell.current.scale.setScalar(size);
      }
    }
  });
  return (
    <group ref={ref} rotation={[0.15, 0.3, 0.1]}>
      <mesh ref={shell}>
        <icosahedronGeometry args={[1.5, 1]} />
        <meshBasicMaterial
          color="#e8c98c"
          wireframe
          transparent
          opacity={0.7}
        />
      </mesh>
      <mesh rotation={[0.5, 0.2, 0.7]}>
        <octahedronGeometry args={[0.78, 0]} />
        <meshBasicMaterial
          color="#f9e3ae"
          wireframe
          transparent
          opacity={0.8}
        />
      </mesh>
      <mesh rotation={[0.4, 0.5, 0.7]}>
        <icosahedronGeometry args={[2.1, 0]} />
        <meshBasicMaterial
          color="#b9bd8d"
          wireframe
          transparent
          opacity={0.22}
        />
      </mesh>
      {[0, 1, 2, 3].map((n) => (
        <group key={n} rotation={[n * 0.71 + 0.3, n * 0.6, 0.3]}>
          <mesh>
            <torusGeometry args={[2.35 + n * 0.09, 0.007, 6, 160]} />
            <meshBasicMaterial
              color={n % 2 ? "#bbce9a" : "#e7c584"}
              transparent
              opacity={0.45}
            />
          </mesh>
          <mesh position={[2.35 + n * 0.09, 0, 0]}>
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshBasicMaterial color="#f1dda9" />
          </mesh>
        </group>
      ))}
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particles, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.021}
          color="#e8d4a8"
          transparent
          opacity={0.7}
          sizeAttenuation
        />
      </points>
    </group>
  );
}
class VisualBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="lp-css-core" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function LandingScene({
  reduced,
  progress,
}: {
  reduced: boolean;
  progress: MotionValue<number>;
}) {
  return (
    <VisualBoundary>
      <Canvas
        aria-label="Abstract animated signal core, decorative geometry"
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 7.6], fov: 46 }}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        frameloop={reduced ? "demand" : "always"}
      >
        <SignalCore reduced={reduced} progress={progress} />
      </Canvas>
    </VisualBoundary>
  );
}
