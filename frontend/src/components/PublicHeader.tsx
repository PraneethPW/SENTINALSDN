import { Shield } from "lucide-react";
import { readSession } from "../session";
import { MotionToggle } from "./CinematicScene";

export function Brand() {
  return (
    <a href="/" className="lp-brand sentinel-brand" aria-label="Sentinel home">
      <span className="sentinel-mark"><Shield size={21} strokeWidth={2} /></span>
      <span>SENTINEL <b>SDN</b></span>
    </a>
  );
}

export default function PublicHeader() {
  return (
    <header className="research-header">
      <div className="research-width research-nav">
        <Brand />
        <nav aria-label="Project navigation">
          <a href="/lab#benchmark">Detection Lab</a>
          <a href="/#benchmark-evidence">Model results</a>
        </nav>
        <div className="research-nav-actions">
          <MotionToggle />
          <a className="research-button ghost" href={readSession() ? "/app" : "/auth/sign-in"}>
            {readSession() ? "Open console" : "Sign in"}
          </a>
        </div>
      </div>
    </header>
  );
}
