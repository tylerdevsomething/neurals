// The sci-fi control panel homepage: a black console on light paper, white readouts, dials, a live
// activity graph and stage tiles around the 3D brain. Every number is live from the chain.
import { useEffect, useState } from 'react';
import { api, fmt, sol, type Brain, type Health, type EpochView, type Activity } from '../api.ts';
import { CURVE_SUPPLY, UNIT } from '../../../brain/model.ts';

const STAGES: [string, string, number, number][] = [['Tk', 'Tokenizer', 0, 3], ['Sy', 'Syntax', 4, 7], ['Se', 'Semantic', 8, 13], ['Me', 'Memory', 14, 19], ['Re', 'Reasoning', 20, 24], ['Pr', 'Prediction', 25, 27]];

function Dial({ v, label }: { v: number; label: string }) {
  const a = -135 + 270 * Math.max(0, Math.min(1, v));
  return (
    <div className="dial">
      <svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="17" /><line x1="20" y1="20" x2="20" y2="6" transform={`rotate(${a} 20 20)`} /><polygon points="20,1 17.5,5 22.5,5" transform={`rotate(${a} 20 20)`} /></svg>
      <span>{label}</span>
    </div>
  );
}

export function Hud({ iframe }: { iframe: string }) {
  const [brain, setBrain] = useState<Brain | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [epochs, setEpochs] = useState<EpochView[]>([]);
  const [act, setAct] = useState<Activity | null>(null);
  useEffect(() => {
    const load = () => { api.brain().then(setBrain).catch(() => {}); api.health().then(setHealth).catch(() => {}); api.epochs().then(setEpochs).catch(() => {}); api.activity().then(setAct).catch(() => {}); };
    load(); const t = setInterval(load, 10_000); return () => clearInterval(t);
  }, []);
  const sold = brain ? brain.issued / (CURVE_SUPPLY * UNIT) : 0;
  const bought = brain ? brain.slots.filter((s) => s.issued > 0).length : 0;
  const fees = epochs.reduce((a, e) => a + sol(e.fees), 0);
  // how much each layer fired across recent paid messages, from the real activity shares
  const perLayer = Array.from({ length: 28 }, (_, l) => (brain?.slots ?? []).filter((s) => s.part?.layer === l).reduce((a, s) => a + (act?.shares[s.part!.index] ?? 0), 0));
  const peak = Math.max(1, ...perLayer);
  const path = perLayer.map((v, i) => `${(i / 27) * 200},${60 - (v / peak) * 52}`).join(' ');
  const stageSold = (from: number, to: number) => {
    const ss = (brain?.slots ?? []).filter((s) => s.part?.layer !== null && s.part !== null && s.part.layer! >= from && s.part.layer! <= to);
    const tot = ss.reduce((a, s) => a + (s.end - s.start), 0) || 1;
    return ss.reduce((a, s) => a + s.issued, 0) / tot;
  };
  return (
    <section className="hud-home">
      <div className="hud-corner tl"><span>Epoch</span><i />{health ? fmt(health.epoch) : '…'}</div>
      <div className="hud-corner tr">2026</div>
      <div className="hud-rails"><div><span>Curve</span><i style={{ width: `${Math.max(4, sold * 100)}%` }} /></div><div><i /><span>Signal</span><b>· · · ·</b></div></div>
      <div className="console">
        <div className="col left">
          <div className="sys"><b>Neurals</b><span className="tag">• Live</span></div>
          <div className="readout"><span className="side">Sold</span><b>{fmt(sold * 100, 2)}</b><span className="unit">%</span></div>
          <div className="dials"><Dial v={sold} label={`${fmt(sold * 100, 1)}%`} /><Dial v={bought / 1318} label={`${bought}`} /><Dial v={Math.min(1, (act?.messages ?? 0) / 50)} label={`${act?.messages ?? 0}`} /></div>
          <dl className="facts">
            <div><dt>Parts bought</dt><dd>{bought} of 1,318</dd></div>
            <div><dt>Paid messages</dt><dd>{act?.messages ?? '…'}</dd></div>
            <div className="on"><dt>Live</dt><dd>true</dd></div>
            <div><dt>Paid to neurons</dt><dd>{fmt(fees, 3)} sol</dd></div>
            <div><dt>Layers</dt><dd>28</dd></div>
          </dl>
        </div>
        <div className="col mid"><iframe className="onion" src={iframe} title="The brain, live" /></div>
        <div className="col right">
          <div className="graph"><div className="gh"><span>Activity by layer</span><span>Input ▾</span></div>
            <svg viewBox="0 0 200 64" preserveAspectRatio="none"><polygon points={`0,62 ${path} 200,62`} /><polyline points={path} /></svg>
            <div className="gx"><span>0</span><span>14</span><span>27</span></div>
          </div>
          <div className="tiles">
            {STAGES.map(([sym, name, a, b]) => (
              <div key={sym} className="tile"><span className="n">{a} to {b}</span><b>{sym}</b><span>{name}</span><i style={{ height: `${Math.max(6, stageSold(a, b) * 100)}%` }} /></div>
            ))}
          </div>
        </div>
      </div>
      <div className="hud-corner bl"><b>{String(bought).padStart(3, '0')}</b></div>
      <div className="hud-corner br">@neurals</div>
    </section>
  );
}
