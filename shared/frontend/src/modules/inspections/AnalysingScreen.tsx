import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { InspectionDetail, SoundLabel, SoundSituation, ViewAngle } from './inspections.types';
import { SOUND_FAULTS, SOUND_SITUATIONS, VIEW_ANGLES, percent } from './inspections.ui';

/** What the server reports while it analyses (GET /api/inspections/progress/:progressId). */
export type PhotoDone = { viewAngle: string; regions: number; possible: number; ms: number; model: string };
export type SoundDone = { situation: string; label: string | null; confidence: number | null; sure: boolean; familiar: boolean | null; windows: number; ms: number };
export type LiveProgress = {
  stage: 'waiting' | 'photos' | 'sounds' | 'saving' | 'done' | 'failed';
  photos: { total: number; done: PhotoDone[] };
  sounds: { total: number; done: SoundDone[] };
};

type Item =
  | { kind: 'photo'; angle: ViewAngle; preview: string }
  | { kind: 'sound'; situation: SoundSituation; file: File };

// Each finished item stays on screen this long before the next one, so every step can be read. The server is never
// waited on longer than it takes: when it is faster, the steps simply pass at this pace.
const HOLD_MS = 900;
const FINISH_MS = 1700;
const PHOTO_STEPS = ['Finding the vehicle', 'Outlining damage', 'Grading severity'];
const SOUND_STEPS = ['Cutting into 1.5 s windows', 'PANNs fingerprint · 2,048 numbers a window', 'Odd-sound check', 'Fault classifier'];

/**
 * The "analysing" screen of a new inspection. Every step follows what the server really reports: the upload (bytes
 * sent), then each photo (damage model) and each recording (sound model) as it finishes, then saving. While an item is
 * being analysed its photo is scanned, or its recording's waveform and spectrogram (computed here from the file) are
 * played through, and the model's steps are named; its result appears only when the server has it.
 */
export function AnalysingScreen({ photos, sounds, upload, live, result, onFinished }: {
  photos: { angle: ViewAngle; preview: string }[];
  sounds: { situation: SoundSituation; file: File }[];
  upload: { sent: number; bytes: number };
  live: LiveProgress | null;
  result: InspectionDetail | null;
  onFinished: () => void;
}) {
  const items: Item[] = [
    ...photos.map((p) => ({ kind: 'photo' as const, ...p })),
    ...sounds.map((s) => ({ kind: 'sound' as const, ...s })),
  ];
  const known = result ? fromDetail(result) : live;
  const photosDone = known?.photos.done ?? [];
  const soundsDone = photosDone.length >= photos.length ? (known?.sounds.done ?? []) : [];
  const doneCount = photosDone.length + soundsDone.length;

  const [started] = useState(() => performance.now());
  const [now, setNow] = useState(started);
  // How many items are shown as finished, and since when the newest one is
  const [cursor, setCursor] = useState({ n: 0, at: 0, current: started });
  const uploading = upload.sent < 1;

  // One clock for the whole screen: advances the shown steps at a readable pace, never ahead of the server
  const n = cursor.n;
  const allShown = n >= items.length;
  const inHold = n > 0 && now - cursor.at < HOLD_MS;
  const finishing = allShown && !inHold;
  const latest = useRef({ doneCount, uploading, ready: false, onFinished });
  useEffect(() => {
    latest.current = { doneCount, uploading, ready: finishing && !!result, onFinished };
  });
  useEffect(() => {
    let readyAt: number | null = null;
    const t = window.setInterval(() => {
      const t1 = performance.now();
      const l = latest.current;
      setNow(t1);
      setCursor((c) => {
        if (l.uploading) return { ...c, current: t1 };
        if (c.n < l.doneCount && t1 - c.at >= HOLD_MS) return { n: c.n + 1, at: t1, current: t1 };
        return c;
      });
      // The summary stays a moment, then the results open (once)
      if (l.ready && readyAt === null) readyAt = t1;
      if (readyAt !== null && t1 - readyAt > FINISH_MS) {
        window.clearInterval(t);
        l.onFinished();
      }
    }, 120);
    return () => window.clearInterval(t);
  }, []);

  const focus = allShown ? items.length - 1 : inHold ? n - 1 : n; // the item in the big viewer
  const focusDone = focus < n;
  // How long the item in focus has been analysed (the first: since the upload ended; later ones: since the hold ended)
  const sinceStart = n === 0 ? now - cursor.current : now - cursor.at - HOLD_MS;
  const regions = photosDone.reduce((s, p) => s + p.regions, 0);
  const possible = photosDone.reduce((s, p) => s + p.possible, 0);
  const faults = soundsDone.filter((s) => s.label && !SOUND_FAULTS[s.label as SoundLabel]?.normal).length;
  const elapsed = (now - started) / 1000;

  const stages = [
    { key: 'upload', label: 'Upload', on: uploading, done: !uploading },
    { key: 'visual', label: 'Visual AI', on: !uploading && n < photos.length, done: n >= photos.length && !uploading },
    ...(sounds.length ? [{ key: 'sound', label: 'Acoustic AI', on: n >= photos.length && !allShown, done: allShown }] : []),
    { key: 'plan', label: 'Repair plan', on: finishing && !result, done: finishing && !!result },
  ];

  return (
    <section className="as-an" aria-live="polite" aria-label="Analysing the inspection">
      <header className="as-an-head">
        <span className="as-an-orb" aria-hidden="true"><i className="bi bi-cpu" /></span>
        <div className="as-an-title">
          <b>{uploading ? 'Uploading to the AI service' : finishing ? (result ? 'Analysis complete' : 'Building the repair plan') : 'AutoSense AI is analysing'}</b>
          <small>
            {items.length} {items.length === 1 ? 'item' : 'items'}: {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
            {sounds.length > 0 && `, ${sounds.length} ${sounds.length === 1 ? 'recording' : 'recordings'}`}
          </small>
        </div>
        <span className="as-an-clock as-num" aria-label={`${elapsed.toFixed(1)} seconds`}>{elapsed.toFixed(1)} s</span>
      </header>

      <ol className="as-an-stages">
        {stages.map((s) => (
          <li key={s.key} className={s.done ? 'done' : s.on ? 'on' : ''}>
            <i className={`bi ${s.done ? 'bi-check-lg' : 'bi-dot'}`} aria-hidden="true" />{s.label}
          </li>
        ))}
      </ol>

      {uploading ? (
        <UploadStage sent={upload.sent} bytes={upload.bytes} photos={photos} />
      ) : finishing ? (
        <Finish regions={regions} possible={possible} sounds={soundsDone.length} faults={faults} seconds={elapsed} ready={!!result} onOpen={onFinished} />
      ) : (
        <div className="as-an-body">
          <div className="as-an-main">
            {items[focus]?.kind === 'photo' ? (
              <PhotoScan
                key={focus}
                item={items[focus] as Extract<Item, { kind: 'photo' }>}
                done={focusDone ? photosDone[focus] : undefined}
                elapsed={sinceStart}
              />
            ) : items[focus] ? (
              <SoundScan
                key={focus}
                item={items[focus] as Extract<Item, { kind: 'sound' }>}
                done={focusDone ? soundsDone[focus - photos.length] : undefined}
                elapsed={sinceStart}
              />
            ) : null}
            <Queue items={items} n={n} focus={focus} photosDone={photosDone} soundsDone={soundsDone} photos={photos.length} />
          </div>
          <ModelLog photos={photosDone.slice(0, Math.min(n, photos.length))} sounds={soundsDone.slice(0, Math.max(0, n - photos.length))} />
        </div>
      )}
    </section>
  );
}

/** The progress as the finished inspection tells it (if the live progress was missed, e.g. an older backend). */
function fromDetail(d: InspectionDetail): LiveProgress {
  return {
    stage: 'done',
    photos: {
      total: d.images.length,
      done: d.images.map((im) => ({
        viewAngle: im.viewAngle,
        regions: im.detections.filter((x) => !x.suggestion && x.source === 'model').length,
        possible: im.detections.filter((x) => x.suggestion).length,
        ms: im.processingMs ?? 0,
        model: d.model?.version ?? 'damage model',
      })),
    },
    sounds: {
      total: d.sounds.length,
      done: d.sounds.map((s) => ({ situation: s.situation, label: s.label, confidence: s.confidence, sure: s.sure, familiar: s.familiar, windows: 0, ms: 0 })),
    },
  };
}

/** Which of the model's steps to name: one after the other while it works, staying on the last until it answers. */
const stepAt = (steps: string[], elapsed: number) => Math.min(steps.length - 1, Math.floor(elapsed / 550));

function UploadStage({ sent, bytes, photos }: { sent: number; bytes: number; photos: { angle: ViewAngle; preview: string }[] }) {
  const mb = (v: number) => (v / 1024 / 1024).toFixed(1);
  return (
    <div className="as-an-upload">
      <div className="as-an-thumbs">
        {photos.map((p, i) => <img key={p.angle} src={p.preview} alt="" style={{ '--i': i } as CSSProperties} />)}
      </div>
      <div className="as-an-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(sent * 100)}>
        <i style={{ width: `${sent * 100}%` }} />
      </div>
      <span className="small text-body-secondary as-num">{mb(sent * bytes)} of {mb(bytes)} MB · {Math.round(sent * 100)}%</span>
    </div>
  );
}

function PhotoScan({ item, done, elapsed }: { item: Extract<Item, { kind: 'photo' }>; done?: PhotoDone; elapsed: number }) {
  const step = stepAt(PHOTO_STEPS, elapsed);
  return (
    <figure className={`as-an-photo${done ? ' done' : ''}`}>
      <img src={item.preview} alt={`${VIEW_ANGLES[item.angle]} photo being analysed`} />
      <span className="as-an-grid" aria-hidden="true" />
      {!done && <span className="as-an-scan" aria-hidden="true" />}
      <span className="as-an-corners" aria-hidden="true"><i /><i /><i /><i /></span>
      <figcaption className="as-an-tag">
        <b>{VIEW_ANGLES[item.angle]}</b>
        {done ? (
          <span className="as-an-ok">
            <i className="bi bi-check-circle-fill" aria-hidden="true" />
            {done.regions === 0 ? 'No damage found' : `${done.regions} ${done.regions === 1 ? 'region' : 'regions'}`}
            {done.possible > 0 && ` + ${done.possible} possible`} · {(done.ms / 1000).toFixed(1)} s
          </span>
        ) : (
          <span key={step} className="as-an-step"><span className="as-an-spin" aria-hidden="true" />{PHOTO_STEPS[step]}…</span>
        )}
      </figcaption>
    </figure>
  );
}

function SoundScan({ item, done, elapsed }: { item: Extract<Item, { kind: 'sound' }>; done?: SoundDone; elapsed: number }) {
  const picture = useSoundPicture(item.file);
  const step = done ? SOUND_STEPS.length : stepAt(SOUND_STEPS, elapsed);
  const fault = done?.label ? SOUND_FAULTS[done.label as SoundLabel] : undefined;
  const situation = SOUND_SITUATIONS[item.situation];
  return (
    <figure className={`as-an-sound${done ? ' done' : ''}`}>
      <div className="as-an-sound-head">
        <b><i className={`bi ${situation.icon} me-1`} aria-hidden="true" />{situation.label}</b>
        {picture && <span className="as-num">{picture.seconds.toFixed(1)} s · {Math.round(picture.rate / 1000)} kHz</span>}
      </div>
      <div className="as-an-wave" aria-hidden="true">
        {picture ? (
          <svg viewBox={`0 0 ${picture.peaks.length} 40`} preserveAspectRatio="none">
            {picture.peaks.map((p, i) => (
              <rect key={i} x={i + 0.15} width={0.7} y={20 - Math.max(0.6, p * 19)} height={Math.max(1.2, p * 38)} rx={0.3} style={{ '--i': i } as CSSProperties} />
            ))}
          </svg>
        ) : <span className="as-an-wave-wait" />}
        {!done && <span className="as-an-playhead" />}
      </div>
      <div className="as-an-spec" aria-hidden="true">
        {picture && <Spectrogram data={picture.spectrum} />}
        <span className="as-an-spec-label">Spectrogram: low → high pitch, bottom to top</span>
      </div>
      <ol className="as-an-steps">
        {SOUND_STEPS.map((s, i) => (
          <li key={s} className={i < step ? 'done' : i === step ? 'on' : ''}>
            <i className={`bi ${i < step ? 'bi-check-lg' : i === step ? 'bi-arrow-right-short' : 'bi-dot'}`} aria-hidden="true" />
            {i === 0 && done?.windows ? `Cut into ${done.windows} windows of 1.5 s` : s}
          </li>
        ))}
      </ol>
      {done && (
        <figcaption className={`as-an-verdict${fault?.normal ? ' normal' : ''}${done.familiar === false || !done.sure ? ' unsure' : ''}`}>
          <i className={`bi ${done.familiar === false ? 'bi-question-diamond' : fault?.normal ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'}`} aria-hidden="true" />
          <span>
            <b>{fault?.name ?? 'No result'}</b> {done.confidence !== null && percent(done.confidence)}
            {done.familiar === false ? ' · Odd sound: check by ear' : !done.sure ? ' · Not sure' : ''}
          </span>
        </figcaption>
      )}
    </figure>
  );
}

/** The waveform (loudest point per slice) and a spectrogram (Goertzel power in log-spaced bands), from the file itself. */
function useSoundPicture(file: File) {
  const [picture, setPicture] = useState<{ peaks: number[]; spectrum: number[][]; seconds: number; rate: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    file.arrayBuffer()
      .then((buf) => ctx.decodeAudioData(buf))
      .then((audio) => {
        if (!alive) return;
        const x = audio.getChannelData(0);
        setPicture({ peaks: peaks(x, 120), spectrum: spectrogram(x, audio.sampleRate, 90, 26), seconds: audio.duration, rate: audio.sampleRate });
      })
      .catch(() => {})
      .finally(() => void ctx.close().catch(() => {}));
    return () => {
      alive = false;
    };
  }, [file]);
  return picture;
}

function peaks(x: Float32Array, n: number) {
  const size = Math.max(1, Math.floor(x.length / n));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * size; j < Math.min(x.length, (i + 1) * size); j++) m = Math.max(m, Math.abs(x[j]!));
    out.push(m);
  }
  const top = Math.max(1e-6, ...out);
  return out.map((v) => v / top);
}

function spectrogram(x: Float32Array, rate: number, frames: number, bands: number) {
  const N = 1024;
  const hi = Math.min(8000, rate / 2 - 1);
  const freqs = Array.from({ length: bands }, (_, b) => 60 * (hi / 60) ** (b / (bands - 1)));
  const step = Math.max(1, Math.floor((x.length - N) / frames));
  const out: number[][] = [];
  for (let f = 0; f < frames; f++) {
    const start = Math.min(f * step, Math.max(0, x.length - N));
    out.push(freqs.map((freq) => {
      const coeff = 2 * Math.cos((2 * Math.PI * freq) / rate);
      let s1 = 0, s2 = 0;
      for (let i = 0; i < N && start + i < x.length; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); // Hann window
        const s0 = x[start + i]! * w + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      return 10 * Math.log10(s1 * s1 + s2 * s2 - coeff * s1 * s2 + 1e-10);
    }));
  }
  const all = out.flat().sort((a, b) => a - b);
  const lo = all[Math.floor(all.length * 0.05)]!, top = all[Math.floor(all.length * 0.99)]!;
  return out.map((col) => col.map((v) => Math.max(0, Math.min(1, (v - lo) / Math.max(1e-6, top - lo)))));
}

function Spectrogram({ data }: { data: number[][] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const color = getComputedStyle(c).getPropertyValue('--as-primary').trim() || '#e8590c';
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = color;
    data.forEach((col, f) => col.forEach((v, b) => {
      g.globalAlpha = v ** 1.6;
      g.fillRect(f, col.length - 1 - b, 1, 1);
    }));
  }, [data]);
  return <canvas ref={canvas} width={data.length} height={data[0]?.length ?? 1} />;
}

function Queue({ items, n, focus, photosDone, soundsDone, photos }: {
  items: Item[];
  n: number;
  focus: number;
  photosDone: PhotoDone[];
  soundsDone: SoundDone[];
  photos: number;
}) {
  return (
    <ol className="as-an-queue" aria-label="Items">
      {items.map((it, i) => {
        const state = i < n ? 'done' : i === focus ? 'on' : '';
        const p = it.kind === 'photo' ? photosDone[i] : undefined;
        const s = it.kind === 'sound' ? soundsDone[i - photos] : undefined;
        return (
          <li key={i} className={state}>
            {it.kind === 'photo' ? <img src={it.preview} alt="" /> : <span className="as-an-qicon"><i className={`bi ${SOUND_SITUATIONS[it.situation].icon}`} aria-hidden="true" /></span>}
            <span>
              <b>{it.kind === 'photo' ? VIEW_ANGLES[it.angle] : SOUND_SITUATIONS[it.situation].label}</b>
              <small>
                {i < n
                  ? p ? `${p.regions} ${p.regions === 1 ? 'region' : 'regions'}` : s?.label ? SOUND_FAULTS[s.label as SoundLabel]?.name : 'done'
                  : i === focus ? 'analysing…' : 'waiting'}
              </small>
            </span>
            {i < n && <i className="bi bi-check-circle-fill as-an-qok" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

/** A console of what each model said, in the order it said it. */
function ModelLog({ photos, sounds }: { photos: PhotoDone[]; sounds: SoundDone[] }) {
  return (
    <aside className="as-an-log" aria-label="Model log">
      <div className="as-an-log-head"><i className="bi bi-terminal" aria-hidden="true" />Model log</div>
      <p className="dim">› damage model · YOLO11 segmentation · 640 px</p>
      {photos.map((p, i) => (
        <p key={`p${i}`} style={{ '--i': i } as CSSProperties}>
          <span className="t">{(p.ms / 1000).toFixed(2)} s</span> {VIEW_ANGLES[p.viewAngle as ViewAngle] ?? p.viewAngle}: {p.regions} {p.regions === 1 ? 'region' : 'regions'}
          {p.possible > 0 && `, ${p.possible} possible`}
        </p>
      ))}
      {sounds.length > 0 && <p className="dim">› sound model · PANNs CNN14 + MFCC · 32 kHz</p>}
      {sounds.map((s, i) => (
        <p key={`s${i}`}>
          <span className="t">{(s.ms / 1000).toFixed(2)} s</span> {SOUND_SITUATIONS[s.situation as SoundSituation]?.label ?? s.situation}:{' '}
          {s.label ? `${SOUND_FAULTS[s.label as SoundLabel]?.name ?? s.label} ${percent(s.confidence)}` : 'no result'}
          {s.familiar === false ? ' · odd sound' : !s.sure ? ' · not sure' : ''}
        </p>
      ))}
      <p className="as-an-cursor" aria-hidden="true">▍</p>
    </aside>
  );
}

function Finish({ regions, possible, sounds, faults, seconds, ready, onOpen }: {
  regions: number;
  possible: number;
  sounds: number;
  faults: number;
  seconds: number;
  ready: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="as-an-finish">
      <span className={`as-an-seal${ready ? ' ready' : ''}`} aria-hidden="true">
        <i className={`bi ${ready ? 'bi-check-lg' : 'bi-tools'}`} />
      </span>
      <div className="as-an-facts">
        <span><b className="as-num">{regions}</b>damage {regions === 1 ? 'region' : 'regions'}{possible > 0 && <small>+ {possible} possible</small>}</span>
        {sounds > 0 && <span><b className="as-num">{faults}</b>{faults === 1 ? 'fault' : 'faults'} heard<small>in {sounds} {sounds === 1 ? 'recording' : 'recordings'}</small></span>}
        <span><b className="as-num">{seconds.toFixed(1)}</b>seconds</span>
      </div>
      {ready ? (
        <button type="button" className="btn btn-primary" onClick={onOpen}>
          Open the results<i className="bi bi-arrow-right ms-1" aria-hidden="true" />
        </button>
      ) : (
        <span className="small text-body-secondary"><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Saving the inspection and its repair plan…</span>
      )}
    </div>
  );
}
