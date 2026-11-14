import { useRef } from "react";
import type { ReactNode } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { useMotionPreference } from "../motionPreference";

export type Scene = "fiber" | "rack" | "silicon";

function SceneImage({ scene, priority = false }: { scene: Scene; priority?: boolean }) {
  return (
    <img
      className="scene-image"
      src={`/assets/scene-${scene}.webp`}
      srcSet={`/assets/scene-${scene}-mobile.webp 800w, /assets/scene-${scene}.webp 1600w`}
      sizes="(max-width: 700px) 100vw, 1600px"
      alt=""
      width={1600}
      height={900}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
    />
  );
}

export function CinematicBackdrop({ scene }: { scene: Scene }) {
  const { reduced } = useMotionPreference();
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "-14%"]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.14]);

  return (
    <>
      <div className="cinematic-backdrop" data-scene={scene} aria-hidden="true">
        <motion.div className="scene-frame" style={reduced ? undefined : { y, scale }}>
          <SceneImage scene={scene} priority />
        </motion.div>
      </div>
      {reduced ? null : (
        <motion.div className="scroll-progress cinematic-progress" aria-hidden="true" style={{ scaleX: scrollYProgress }} />
      )}
    </>
  );
}

export function CinematicChapter({
  children,
  scene,
  className = "",
  id,
  labelledBy,
}: {
  children: ReactNode;
  scene: Scene;
  className?: string;
  id?: string;
  labelledBy?: string;
}) {
  const { reduced } = useMotionPreference();
  const target = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["-11%", "11%"]);
  const scale = useTransform(scrollYProgress, [0, 0.55, 1], [1.03, 1.12, 1.07]);

  return (
    <section ref={target} id={id} aria-labelledby={labelledBy} className={`cinematic-chapter ${className}`}>
      <div className="chapter-scene" data-scene={scene} aria-hidden="true">
        <motion.div className="scene-frame" style={reduced ? undefined : { y, scale }}>
          <SceneImage scene={scene} />
        </motion.div>
      </div>
      <div className="chapter-content">{children}</div>
    </section>
  );
}

export function MotionToggle({ className = "research-motion-toggle" }: { className?: string }) {
  const { paused, toggle } = useMotionPreference();
  return (
    <button
      type="button"
      className={className}
      onClick={toggle}
      aria-label={paused ? "Enable motion" : "Pause motion"}
      aria-pressed={paused}
      title={paused ? "Enable motion" : "Pause motion"}
    >
      {paused ? <Play size={16} /> : <Pause size={16} />}
    </button>
  );
}
