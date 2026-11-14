import { ArrowUpRight, Shield } from "lucide-react";
import { readSession } from "../session";

export function Brand() {
  return (
    <a href="/" className="lp-brand sentinel-brand" aria-label="Sentinel home">
      <span className="sentinel-mark"><Shield size={21} strokeWidth={2} /></span>
      <span>SENTINEL <b>SDN</b></span>
    </a>
  );
}

export default function PublicHeader({ lab = false }: { lab?: boolean }) {
  return (
    <header className="research-header">
      <div className="research-width research-nav">
        <Brand />
        <nav aria-label="Project navigation">
          <a href="/lab" aria-current={lab ? "page" : undefined}>Detection Lab</a>
          <a href="/#methodology">Methodology</a>
        </nav>
        <a className="research-button ghost" href={readSession() ? "/app" : "/auth/sign-in"}>
          Live workspace <ArrowUpRight size={15} />
        </a>
      </div>
    </header>
  );
}
