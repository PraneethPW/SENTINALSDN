import { useState } from "react";
import { Activity, Radar } from "lucide-react";
import { compact, time } from "../api";
import type { Snapshot } from "../api";

export function TrafficChart({ data }: { data: Snapshot | null }) {
  const series = data?.series ?? [];
  const max = Math.max(1, ...series.map((point) => Number(point.bps)));
  const start = data
    ? new Date(data.timestamp).getTime() - data.window_minutes * 60000
    : 0;
  const end = data ? new Date(data.timestamp).getTime() : 1;
  const points = (field: "bps" | "attack_bps") =>
    series
      .map(
        (point) =>
          `${Math.max(0, Math.min(900, ((new Date(point.time).getTime() - start) / (end - start)) * 900))},${180 - (Number(point[field]) / max) * 150}`,
      )
      .join(" ");
  return (
    <div className="chart-container">
      <div className="chart-axis">
        <span>{compact(max, "bps")}</span>
        <span>{compact(max / 2, "bps")}</span>
        <span>0</span>
      </div>
      <div className="chart-inner">
        <svg
          viewBox="0 0 900 200"
          preserveAspectRatio="none"
          role="img"
          aria-label={
            series.length
              ? "Measured traffic in thirty second buckets"
              : "No measured traffic in the selected window"
          }
        >
          <defs>
            <linearGradient id="traffic-fill" x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#dfb874" stopOpacity=".23" />
              <stop offset="1" stopColor="#dfb874" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[30, 80, 130, 180].map((y) => (
            <line
              key={y}
              x1="0"
              x2="900"
              y1={y}
              y2={y}
              stroke="#ffffff0a"
              strokeDasharray="4 5"
            />
          ))}
          {series.length > 1 ? (
            <>
              <polygon
                points={`${points("bps")} ${Math.max(0, Math.min(900, ((new Date(series.at(-1)!.time).getTime() - start) / (end - start)) * 900))},180 ${Math.max(0, ((new Date(series[0].time).getTime() - start) / (end - start)) * 900)},180`}
                fill="url(#traffic-fill)"
              />
              <polyline
                points={points("bps")}
                fill="none"
                stroke="#dfb874"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                points={points("attack_bps")}
                fill="none"
                stroke="#dc796b"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : null}
        </svg>
        {series.length < 2 ? (
          <div className="chart-empty">
            <Activity size={21} strokeWidth={1} />
            <span>
              {series.length === 1
                ? "Collecting the next measurement"
                : "Listening for your first flow"}
            </span>
            <small>Only measured traffic appears here.</small>
          </div>
        ) : null}
        <div className="chart-times">
          <span>{data ? time(new Date(start).toISOString()) : "—"}</span>
          <span>
            {data ? time(new Date((start + end) / 2).toISOString()) : "—"}
          </span>
          <span>{data ? time(data.timestamp) : "Now"}</span>
        </div>
      </div>
    </div>
  );
}

export function Topology({data,large=false}:{data:Snapshot|null;large?:boolean}) {
  const [selected,setSelected]=useState<string|null>(null);
  const collectors=data?.collectors??[];
  const switches=collectors.flatMap(c=>c.switches.map(id=>({key:`${c.id}/${id}`,id,collector:c,online:c.online&&c.controller_status==='connected'})));
  const hosts=collectors.flatMap(c=>(c.topology?.hosts??[]).map(h=>({...h,key:`${c.id}/host/${h.mac}`,collector:c.id}))).sort((a,b)=>`${a.collector}/${a.switch_id}`.localeCompare(`${b.collector}/${b.switch_id}`,undefined,{numeric:true})).slice(0,24);
  const width=900, positions=new Map(switches.map((s,i)=>[s.key,{x:70+(i+.5)*760/Math.max(1,switches.length),y:105}]));
  const seen=new Set<string>();
  const links=collectors.flatMap(c=>(c.topology?.links??[]).flatMap(l=>{const a=`${c.id}/${l.source}`,b=`${c.id}/${l.target}`,key=[a,b].sort().join('-');if(seen.has(key)||!positions.has(a)||!positions.has(b))return [];seen.add(key);return [{key,a:positions.get(a)!,b:positions.get(b)!,online:c.online&&c.controller_status==='connected'}]}));
  const picked=switches.find(s=>s.key===selected);
  const ports=picked?.collector.topology?.ports.filter(p=>p.switch_id===picked.id)??[];
  const discovered=collectors.some(c=>c.topology?.available);
  return <div className={`topology measured-topology ${large?'large':''}`}>
    <div className="topology-grid"/>
    {switches.length?<>{large?<div className="switch-inspector-toolbar">{switches.map(sw=><button key={sw.key} className="button secondary" aria-label={`Inspect switch ${sw.id}`} aria-pressed={selected===sw.key} onClick={()=>setSelected(sw.key)}>SW-{sw.id}</button>)}</div>:null}<div className="topology-scroll" tabIndex={0} aria-label="Scrollable measured topology"><svg viewBox={`0 0 ${width} 310`} role="img" aria-label={`${switches.length} observed switches, ${links.length} discovered links, ${hosts.length} observed hosts`} className="measured-graph">
      {links.map(l=><g key={l.key}><line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} className={l.online?'network-link active':'network-link'}/></g>)}
      {hosts.map((h,i)=>{const source=positions.get(`${h.collector}/${h.switch_id}`);const x=45+(i+.5)*810/Math.max(1,hosts.length);if(!source)return null;return <g key={h.key}><path d={`M ${source.x} ${source.y+22} C ${source.x} 190 ${x} 170 ${x} 235`} className="host-link"/><rect x={x-15} y={226} width={30} height={23} rx={5} className="host-marker"/><text x={x} y={272} textAnchor="middle">{h.addresses[0]??h.mac}</text></g>})}
      {switches.map(sw=>{const pos=positions.get(sw.key)!;return <g key={sw.key} onClick={()=>setSelected(sw.key)} className="switch-target"><circle cx={pos.x} cy={pos.y} r={25} className={sw.online?'switch-marker online':'switch-marker'}/><text x={pos.x} y={pos.y+4} textAnchor="middle">{sw.id}</text><text x={pos.x} y={pos.y-39} textAnchor="middle">SW-{sw.id} · {sw.online?'observed':'offline'}</text></g>})}
    </svg></div><span className="topology-caption">{discovered?`${links.length} discovered switch links · ${hosts.length} observed hosts · select a switch`:'Switch membership only · controller does not expose link discovery'}</span>
    {large&&picked?<div className="topology-detail"><strong>Switch {picked.id} · {picked.collector.id}</strong><p className="footnote">Actual cumulative port counters, last captured {time(picked.collector.last_seen)}. Repeated hops are counted separately.</p><div className="table-wrap"><table><thead><tr><th>Port</th><th>Received</th><th>Transmitted</th><th>Drops / errors</th></tr></thead><tbody>{ports.map(p=><tr key={p.port}><td>{p.port}</td><td>{compact(p.rx_bytes,'B')}</td><td>{compact(p.tx_bytes,'B')}</td><td>{p.rx_dropped+p.tx_dropped} / {p.rx_errors+p.tx_errors}</td></tr>)}</tbody></table></div>{!ports.length?<p className="footnote">No port measurements have been reported.</p>:null}</div>:null}
    </>:<div className="topology-empty"><Radar size={29}/><strong>Your network, in focus.</strong><span>Connect a collector to discover real infrastructure.</span></div>}
  </div>
}
