import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { DamageLabel, ViewAngle } from './inspections.types';
import { DAMAGE_LABELS, VIEW_ANGLES } from './inspections.ui';
import {
  CAPTURE_GAP_MS, CLOSEUP_CONFIDENCE, CLOSEUP_GAP_MS, HOLD_MS, MAX_CLOSEUPS, SEND_SIZE, SIDES,
  cameraProblem, drawFrame, gate, judge, score, sendFrame, strongest, toFile, toJpeg,
  type LiveFrame, type WalkResult,
} from './walkFrames';

const WHERE: Record<string, string> = {
  front: 'Stand 2–3 m in front of the vehicle',
  left: "Walk round to the vehicle's left side (passenger side)",
  rear: 'Walk round to the back of the vehicle',
  right: "Walk round to the vehicle's right side (driver's side)",
};

type Capture = { file: File; url: string };
type Closeup = Capture & { confidence: number; label: string };

/**
 * Live walk-around (full screen, phone camera). Frames go to the damage service one at a time (the next as soon as
 * the last is answered, about 2 a second); its answer is drawn over the camera view, and a side is captured by itself
 * once the vehicle is large, whole and sharp for HOLD_MS. Clear damage is kept as close-ups (strongest MAX_CLOSEUPS).
 */
export function LiveWalkAround({ onDone, onClose }: { onDone: (r: WalkResult) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [paused, setPaused] = useState<'person' | 'none' | null>(null); // damage hidden: no vehicle in view
  const [rate, setRate] = useState<{ fps: number; ms: number } | null>(null);
  const [hold, setHold] = useState(0); // 0-1: how far the current side is to being captured
  const [current, setCurrent] = useState(0); // index in SIDES; SIDES.length = all sides done
  const [sides, setSides] = useState<Partial<Record<ViewAngle, Capture>>>({});
  const [closeups, setCloseups] = useState<Closeup[]>([]);
  const [flash, setFlash] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  // The loop reads the latest state through this ref (it runs outside React's render)
  const live = useRef({ current: 0, sides: {} as Partial<Record<ViewAngle, Capture>>, closeups: [] as Closeup[], force: false, closeupNow: false });
  useEffect(() => {
    live.current.current = current;
    live.current.sides = sides;
    live.current.closeups = closeups;
  }, [current, sides, closeups]);

  // Object URLs of the captures are freed when the screen closes, unless they were handed over
  const handedOver = useRef(false);
  useEffect(() => () => {
    if (handedOver.current) return;
    Object.values(live.current.sides).forEach((c) => c && URL.revokeObjectURL(c.url));
    live.current.closeups.forEach((c) => URL.revokeObjectURL(c.url));
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let running = true;
    const controller = new AbortController();
    let readySince: number | null = null;
    let lastCloseup = 0;
    let vehicleSeenAt: number | null = null;
    let lastCapture = 0;
    const times: number[] = [];

    function nextMissing(after: number, have: Partial<Record<ViewAngle, Capture>>) {
      for (let k = 1; k <= SIDES.length; k++) {
        const i = (after + k) % SIDES.length;
        if (!have[SIDES[i]!]) return i;
      }
      return SIDES.length;
    }

    async function loop(el: HTMLVideoElement) {
      while (running) {
        if (el.readyState < 2) {
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        const full = drawFrame(el, 1920);
        const small = drawFrame(full, SEND_SIZE);
        const t0 = performance.now();
        let answer: LiveFrame;
        try {
          answer = await sendFrame(await toJpeg(small, 0.8), controller.signal);
        } catch {
          if (!running) return;
          await new Promise((r) => setTimeout(r, 500)); // a dropped frame: try the next one
          continue;
        }
        if (!running) return;
        const now = performance.now();
        times.push(now);
        while (times.length > 6) times.shift();
        if (answer.vehicle) vehicleSeenAt = now;
        const shown = gate(answer, vehicleSeenAt, now);
        const f = shown.frame;
        setFrame(f);
        setPaused(shown.paused);
        setRate({ fps: times.length > 1 ? ((times.length - 1) * 1000) / (now - times[0]!) : 0, ms: Math.round(now - t0) });

        const s = live.current;
        // A side: good for HOLD_MS (or "Capture now"), then on to the next side still missing
        if (s.current < SIDES.length) {
          // Only from the right side (the vehicle's shape), and not straight after the previous capture
          const ready = judge(f, SIDES[s.current]).ready && now - lastCapture >= CAPTURE_GAP_MS;
          readySince = ready ? (readySince ?? now) : null;
          const held = readySince === null ? 0 : (now - readySince) / HOLD_MS;
          setHold(Math.min(1, held));
          if (held >= 1 || s.force) {
            s.force = false;
            readySince = null;
            lastCapture = now;
            const side = SIDES[s.current]!;
            const file = toFile(await toJpeg(full, 0.92), `walkaround-${side}.jpg`);
            const capture = { file, url: URL.createObjectURL(file) };
            const have = { ...s.sides, [side]: capture };
            if (s.sides[side]) URL.revokeObjectURL(s.sides[side]!.url);
            s.sides = have;
            s.current = nextMissing(s.current, have);
            setSides(have);
            setCurrent(s.current);
            setHold(0);
            setFlash((n) => n + 1);
            navigator.vibrate?.(80);
            setToast(`${VIEW_ANGLES[side]} captured`);
          }
        }
        // Close-ups: clear damage, at most one every CLOSEUP_GAP_MS, the strongest MAX_CLOSEUPS kept ("Close-up" takes one now)
        const hit = strongest(f);
        const auto = hit && hit.confidence >= CLOSEUP_CONFIDENCE && now - lastCloseup >= CLOSEUP_GAP_MS;
        const weakest = s.closeups.length >= MAX_CLOSEUPS ? Math.min(...s.closeups.map((c) => c.confidence)) : -1;
        if (s.closeupNow || (auto && hit.confidence > weakest)) {
          const manual = s.closeupNow;
          s.closeupNow = false;
          lastCloseup = now;
          const file = toFile(await toJpeg(full, 0.92), `walkaround-closeup-${s.closeups.length + 1}.jpg`);
          const shot: Closeup = { file, url: URL.createObjectURL(file), confidence: manual ? 1 : hit!.confidence, label: hit?.label ?? 'close-up' };
          let list = [...s.closeups, shot].sort((a, b) => b.confidence - a.confidence);
          list.slice(MAX_CLOSEUPS).forEach((c) => URL.revokeObjectURL(c.url));
          list = list.slice(0, MAX_CLOSEUPS);
          s.closeups = list;
          setCloseups(list);
          setFlash((n) => n + 1);
          setToast(manual ? 'Close-up taken' : `Close-up: ${DAMAGE_LABELS[hit!.label as DamageLabel] ?? hit!.label} ${Math.round(hit!.confidence * 100)}%`);
        }
      }
    }

    navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        stream = s;
        if (!running || !video.current) return s.getTracks().forEach((t) => t.stop());
        video.current.srcObject = s;
        void video.current.play().catch(() => {});
        void loop(video.current);
      })
      .catch((err) => setError(cameraProblem(err)));
    if (!navigator.mediaDevices) queueMicrotask(() => setError(cameraProblem(null)));

    return () => {
      running = false;
      controller.abort();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // The little message after a capture fades by itself
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1600);
    return () => window.clearTimeout(t);
  }, [toast]);

  function finish() {
    handedOver.current = true;
    const result: WalkResult = {
      sides: Object.fromEntries(Object.entries(sides).map(([k, c]) => [k, c!.file])),
      closeups: closeups.map((c) => c.file),
    };
    Object.values(sides).forEach((c) => c && URL.revokeObjectURL(c.url));
    closeups.forEach((c) => URL.revokeObjectURL(c.url));
    onDone(result);
  }

  const side = SIDES[current];
  const verdict = judge(frame, side);
  const doneCount = SIDES.filter((s) => sides[s]).length;

  return (
    <div className="as-walk" role="dialog" aria-modal="true" aria-label="Live walk-around">
      <header className="as-walk-top">
        <button type="button" className="as-walk-icon" aria-label="Close the walk-around" onClick={onClose}><i className="bi bi-x-lg" aria-hidden="true" /></button>
        <div className="as-walk-prompt">
          {side ? (
            <>
              <small>Side {current + 1} of {SIDES.length}</small>
              <b>{VIEW_ANGLES[side]}</b>
              <span>{WHERE[side]}</span>
            </>
          ) : (
            <>
              <small>All sides captured</small>
              <b>Walk-around complete</b>
              <span>Take close-ups of any damage, or finish.</span>
            </>
          )}
        </div>
        <span className="as-walk-rate" title="Frames the AI analyses per second, and the time for the last one">
          <i className="bi bi-cpu" aria-hidden="true" />AI live{rate && <> · {rate.fps.toFixed(1)} fps · {rate.ms} ms</>}
        </span>
      </header>

      <div className="as-walk-stage">
        <video ref={video} muted playsInline autoPlay />
        {frame && <LiveOverlay frame={frame} side={side} />}
        {error ? (
          <div className="as-walk-error"><i className="bi bi-camera-video-off" aria-hidden="true" /><p>{error}</p></div>
        ) : side && (
          <div className={`as-walk-hint${verdict.ready ? ' ready' : ''}`}>
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="15" className="track" />
              <circle cx="18" cy="18" r="15" className="fill" style={{ strokeDashoffset: `${94.2 * (1 - hold)}` }} />
            </svg>
            <span>{verdict.hint}</span>
          </div>
        )}
        {paused && !error && (
          <span className="as-walk-paused" role="status">
            <i className={`bi ${paused === 'person' ? 'bi-person-x' : 'bi-car-front'}`} aria-hidden="true" />
            {paused === 'person' ? "That's a person, not a vehicle: damage detection paused" : 'No vehicle in view: damage detection paused'}
          </span>
        )}
        {flash > 0 && <span key={flash} className="as-walk-flash" aria-hidden="true" />}
        {toast && <span className="as-walk-toast" role="status">{toast}</span>}
      </div>

      <footer className="as-walk-bottom">
        <Compass sides={sides} current={current} onPick={(i) => { live.current.current = i; setCurrent(i); }} />
        <div className="as-walk-shots" aria-label="Captured photos">
          {SIDES.map((s) => sides[s] && <img key={s} src={sides[s]!.url} alt={`${VIEW_ANGLES[s]} captured`} />)}
          {closeups.map((c, i) => <img key={c.url} src={c.url} alt={`Close-up ${i + 1}`} className="closeup" />)}
          <span className="as-walk-count">{doneCount}/{SIDES.length} sides · {closeups.length} close-up{closeups.length === 1 ? '' : 's'}</span>
        </div>
        <div className="as-walk-actions">
          <button type="button" className="btn btn-light" disabled={!frame || !!error} onClick={() => { live.current.closeupNow = true; }}>
            <i className="bi bi-zoom-in me-1" aria-hidden="true" />Close-up
          </button>
          {side && (
            <button type="button" className="btn btn-light" disabled={!frame?.vehicle} title="Capture this side now, even if it is not ideal" onClick={() => { live.current.force = true; }}>
              <i className="bi bi-camera me-1" aria-hidden="true" />Capture now
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={doneCount === 0} onClick={finish}>
            <i className="bi bi-check2 me-1" aria-hidden="true" />Finish
          </button>
        </div>
      </footer>
    </div>
  );
}

/** The AI's answer drawn over the picture: corner brackets on the vehicle, damage outlines with their names. */
export function LiveOverlay({ frame, side }: { frame: LiveFrame; side?: ViewAngle }) {
  const { width: w, height: h } = frame;
  if (!w || !h) return null;
  const v = frame.vehicle?.bbox;
  const c = Math.min(w, h) * 0.06; // bracket length
  const fs = Math.max(11, w / 45);
  return (
    <svg className="as-walk-overlay" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {v && (
        <g className={`as-walk-vehicle${judge(frame, side).ready ? ' ready' : ''}`}>
          <path d={`M${v[0]} ${v[1]! + c}V${v[1]}H${v[0]! + c}M${v[2]! - c} ${v[1]}H${v[2]}V${v[1]! + c}M${v[2]} ${v[3]! - c}V${v[3]}H${v[2]! - c}M${v[0]! + c} ${v[3]}H${v[0]}V${v[3]! - c}`} />
        </g>
      )}
      {frame.detections.map((d, i) => (
        <g key={i} className={`as-walk-dmg${d.possible ? ' possible' : ''}`}>
          <polygon points={d.polygon.map((p) => p.join(',')).join(' ')} />
          <g transform={`translate(${d.bbox[0]} ${Math.max(fs + 4, d.bbox[1]!)})`}>
            <rect y={-fs - 4} width={(DAMAGE_LABELS[d.label as DamageLabel] ?? d.label).length * fs * 0.55 + fs * 2.6} height={fs + 6} rx={4} />
            <text x={4} y={-3} style={{ fontSize: fs } as CSSProperties}>
              {DAMAGE_LABELS[d.label as DamageLabel] ?? d.label} {Math.round(d.confidence * 100)}%
            </text>
          </g>
        </g>
      ))}
    </svg>
  );
}

/** A vehicle seen from above, front at the top: which sides are done, which is next. Tap a side to (re)take it. */
function Compass({ sides, current, onPick }: { sides: Partial<Record<ViewAngle, unknown>>; current: number; onPick: (i: number) => void }) {
  const spots: Record<string, [number, number]> = { front: [50, 8], left: [12, 50], rear: [50, 92], right: [88, 50] };
  return (
    <svg className="as-walk-compass" viewBox="0 0 100 100" role="group" aria-label="Sides of the vehicle">
      <rect x="32" y="20" width="36" height="60" rx="12" className="car" />
      <rect x="37" y="30" width="26" height="12" rx="3" className="glass" />
      <rect x="37" y="60" width="26" height="9" rx="3" className="glass" />
      {SIDES.map((s, i) => {
        const [x, y] = spots[s]!;
        const state = sides[s] ? 'done' : i === current ? 'on' : '';
        return (
          <g key={s} className={`spot ${state}`} role="button" tabIndex={0} aria-label={`${VIEW_ANGLES[s]}${sides[s] ? ', captured: tap to retake' : ''}`}
            onClick={() => onPick(i)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPick(i)}>
            <circle cx={x} cy={y} r="8" />
            <text x={x} y={y + 3.2} textAnchor="middle">{sides[s] ? '✓' : s[0]!.toUpperCase()}</text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Walk-around from a video (recorded with the phone's camera app): frames are taken at about 1.5 a second and sent to
 * the damage service like live frames; the video is split into four equal parts in the walking order (front, left,
 * rear, right) and the best frame of each part becomes that side's photo; clear damage gives close-ups.
 */
export function VideoWalkAround({ onDone }: { onDone: (r: WalkResult) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<
    | { stage: 'idle' }
    | { stage: 'reading'; done: number; total: number; frame: LiveFrame | null; preview: string | null }
    | { stage: 'picked'; sides: { side: ViewAngle; t: number; url: string }[]; closeups: { t: number; url: string }[]; files: WalkResult }
    | { stage: 'error'; message: string }
  >({ stage: 'idle' });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) return;
    let alive = true;
    const urls: string[] = [];
    const controller = new AbortController();
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.src = URL.createObjectURL(file);
    urls.push(el.src);
    const seek = (t: number) => new Promise<void>((resolve, reject) => {
      el.onseeked = () => resolve();
      el.onerror = () => reject(new Error('unreadable'));
      el.currentTime = t;
    });

    (async () => {
      await new Promise<void>((resolve, reject) => {
        el.onloadeddata = () => resolve();
        el.onerror = () => reject(new Error('unreadable'));
      });
      const duration = el.duration;
      if (!Number.isFinite(duration) || duration < 4) throw new Error('short');
      const total = Math.max(8, Math.min(60, Math.round(duration * 1.5)));
      const seen: { t: number; f: LiveFrame }[] = [];
      for (let i = 0; i < total && alive; i++) {
        const t = ((i + 0.5) * duration) / total;
        await seek(t);
        const small = drawFrame(el, SEND_SIZE);
        const blob = await toJpeg(small, 0.8);
        const f = gate(await sendFrame(blob, controller.signal), null, 0).frame;
        seen.push({ t, f });
        const preview = URL.createObjectURL(blob);
        urls.push(preview);
        if (alive) setState({ stage: 'reading', done: i + 1, total, frame: f, preview });
      }
      if (!alive) return;

      // The best frame of each quarter of the walk; then close-ups of clear damage, 2 s apart, not already a side
      const chosen: { side: ViewAngle; t: number }[] = [];
      SIDES.forEach((side, k) => {
        const part = seen.filter((x) => x.t >= (k * duration) / 4 && x.t < ((k + 1) * duration) / 4);
        // Best seen from that side (shape); if no frame of the quarter is, the largest view of the vehicle
        const best = [...part].sort((a, b) => score(b.f, side) - score(a.f, side) || (b.f.vehicle?.share ?? 0) - (a.f.vehicle?.share ?? 0))[0];
        if (best?.f.vehicle) chosen.push({ side, t: best.t });
      });
      const close: number[] = [];
      for (const x of [...seen].sort((a, b) => (strongest(b.f)?.confidence ?? 0) - (strongest(a.f)?.confidence ?? 0))) {
        if (close.length >= MAX_CLOSEUPS || (strongest(x.f)?.confidence ?? 0) < CLOSEUP_CONFIDENCE) break;
        if ([...close, ...chosen.map((c) => c.t)].every((t) => Math.abs(t - x.t) >= 2)) close.push(x.t);
      }
      if (!chosen.length) throw new Error('novehicle');

      // Full-size photos of the chosen moments
      const grab = async (t: number, name: string) => {
        await seek(t);
        const f = toFile(await toJpeg(drawFrame(el, 1920), 0.92), name);
        const url = URL.createObjectURL(f);
        urls.push(url);
        return { f, url };
      };
      const sides = [];
      const files: WalkResult = { sides: {}, closeups: [] };
      for (const c of chosen) {
        const g = await grab(c.t, `video-${c.side}.jpg`);
        files.sides[c.side] = g.f;
        sides.push({ side: c.side, t: c.t, url: g.url });
      }
      const closeups = [];
      for (const [i, t] of close.entries()) {
        const g = await grab(t, `video-closeup-${i + 1}.jpg`);
        files.closeups.push(g.f);
        closeups.push({ t, url: g.url });
      }
      if (alive) setState({ stage: 'picked', sides, closeups, files });
    })().catch((err: unknown) => {
      if (!alive) return;
      const message = err instanceof Error && err.message === 'short' ? 'The video is too short: walk round the whole vehicle (30–60 seconds).'
        : err instanceof Error && err.message === 'novehicle' ? 'No vehicle was found in the video. Film the whole vehicle from 2–3 m away.'
        : err instanceof Error && err.message === 'unreadable' ? 'This browser cannot read the video. Record it as MP4 (on iPhone: Settings › Camera › Formats › Most Compatible).'
        : err instanceof Error ? err.message : 'The video could not be read.';
      setState({ stage: 'error', message });
    });

    return () => {
      alive = false;
      controller.abort();
      el.removeAttribute('src');
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [file]);

  const choose = (f: File | undefined) => {
    if (input.current) input.current.value = ''; // so the same video can be chosen again
    if (!f) return;
    setState({ stage: 'reading', done: 0, total: 0, frame: null, preview: null });
    setFile(f);
  };
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  return (
    <div className="as-walk-video">
      <input ref={input} type="file" accept="video/*" className="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => choose(e.target.files?.[0])} />
      {state.stage === 'idle' || state.stage === 'error' ? (
        <div className="as-walk-intro">
          <i className="bi bi-film" aria-hidden="true" />
          <div>
            <b>Upload a walk-around video</b>
            <p>
              Film the vehicle with the phone's camera app, 30–60 seconds, walking at an even pace: start at the front, then
              the left side, the rear and the right side, 2–3 m away. The AI picks the best frame of each side.
            </p>
            {state.stage === 'error' && <p className="text-danger mb-2">{state.message}</p>}
            <button type="button" className="btn btn-primary" onClick={() => input.current?.click()}>
              <i className="bi bi-upload me-1" aria-hidden="true" />Choose video
            </button>
          </div>
        </div>
      ) : state.stage === 'reading' ? (
        <div className="as-walk-reading">
          <div className="as-walk-frame">
            {state.preview ? <img src={state.preview} alt="Frame being analysed" /> : <span className="as-walk-wait" />}
            {state.frame && <LiveOverlay frame={state.frame} />}
            <span className="as-an-scan" aria-hidden="true" />
          </div>
          <div className="as-walk-progress">
            <b>The AI is watching the video…</b>
            <span>{state.total ? `Frame ${state.done} of ${state.total}` : 'Opening the video'}</span>
            <div className="as-an-bar" role="progressbar" aria-valuemin={0} aria-valuemax={state.total || 1} aria-valuenow={state.done}>
              <i style={{ width: `${state.total ? (state.done / state.total) * 100 : 0}%` }} />
            </div>
          </div>
        </div>
      ) : (
        <div className="as-walk-picked">
          <b>The AI picked these frames</b>
          <div className="as-walk-grid">
            {state.sides.map((s) => (
              <figure key={s.side}><img src={s.url} alt={`${VIEW_ANGLES[s.side]} frame`} /><figcaption>{VIEW_ANGLES[s.side]} · {fmt(s.t)}</figcaption></figure>
            ))}
            {state.closeups.map((c, i) => (
              <figure key={c.t}><img src={c.url} alt={`Close-up ${i + 1}`} /><figcaption>Close-up · {fmt(c.t)}</figcaption></figure>
            ))}
          </div>
          {state.sides.length < SIDES.length && (
            <p className="small text-warning mb-2">No usable frame for {SIDES.filter((s) => !state.sides.some((x) => x.side === s)).map((s) => VIEW_ANGLES[s].toLowerCase()).join(', ')}: add it as a photo afterwards.</p>
          )}
          <div className="d-flex gap-2 flex-wrap">
            <button type="button" className="btn btn-primary" onClick={() => onDone(state.files)}>
              <i className="bi bi-check2 me-1" aria-hidden="true" />Use these photos
            </button>
            <button type="button" className="btn btn-light" onClick={() => input.current?.click()}>Choose another video</button>
          </div>
        </div>
      )}
    </div>
  );
}
