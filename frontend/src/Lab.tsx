import DetectionLab from "./DetectionLab";
import PublicHeader, { Brand } from "./components/PublicHeader";
import { CinematicBackdrop } from "./components/CinematicScene";
import { useMotionPreference } from "./motionPreference";

export default function Lab() {
  const { reduced } = useMotionPreference();
  return (
    <div className={`research cinematic-page${reduced ? " motion-off" : ""}`}>
      <CinematicBackdrop scene="silicon" />
      <PublicHeader />
      <main className="research-width public-lab-main">
        <DetectionLab placement="public" />
      </main>
      <footer className="research-width research-footer"><Brand /><a href="/privacy">Privacy</a></footer>
    </div>
  );
}
