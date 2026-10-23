import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { StatusPill } from '@/components/ui/StatusPill';
import type { SoundSituation } from './inspections.types';
import { SOUND_SITUATIONS } from './inspections.ui';
import { canRecord, startRecording, type Recording } from './soundRecorder';

export type Sound = { file: File; url: string; seconds: number | null };

const SITUATIONS = Object.keys(SOUND_SITUATIONS) as SoundSituation[];
const MAX_SECONDS = 10; // the model judges 1.5 s windows; 5-10 s gives several to vote
const GOOD_SECONDS = 5;
const AUDIO_TYPES = ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac', 'audio/x-flac', 'audio/ogg'];
const MAX_MB = 10;

/**
 * New inspection, step 3 (optional): record the vehicle starting, idling and/or braking, one recording each, or choose
 * a WAV/FLAC/OGG file. The sound model names the most likely fault of that situation when the inspection is analysed.
 */
export function SoundCapture({ sounds, onChange, disabled }: {
  sounds: Partial<Record<SoundSituation, Sound>>;
  onChange: (situation: SoundSituation, sound: Sound | undefined) => void;
  disabled: boolean;
}) {
  const [live, setLive] = useState<{ situation: SoundSituation; seconds: number; level: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The running recording, its situation and start time: refs, so the auto-stop timer reads the current ones
  const recording = useRef<{ r: Recording; situation: SoundSituation; startedAt: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const target = useRef<SoundSituation>('idling');
  const recorderAvailable = canRecord();
  const count = SITUATIONS.filter((s) => sounds[s]).length;

  // Leaving the page mid-recording frees the microphone
  useEffect(() => () => recording.current?.r.cancel(), []);

  // Recording clock: auto-stop at the limit
  const liveSituation = live?.situation;
  useEffect(() => {
    if (!liveSituation) return;
    const t = window.setInterval(() => {
      const current = recording.current;
      if (!current) return;
      const seconds = (Date.now() - current.startedAt) / 1000;
      if (seconds >= MAX_SECONDS) void stop();
      else setLive((l) => (l ? { ...l, seconds } : l));
    }, 200);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one clock per recording; stop() reads the refs
  }, [liveSituation]);

  async function record(situation: SoundSituation) {
    setProblem(null);
    try {
      const r = await startRecording(`${situation}.wav`, (level) => setLive((l) => (l ? { ...l, level } : l)));
      recording.current = { r, situation, startedAt: Date.now() };
      setLive({ situation, seconds: 0, level: 0 });
    } catch (err) {
      setProblem(err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Microphone access was refused. Allow it in the browser (the lock icon next to the address), or choose a recording file.'
        : 'The microphone could not be started. Choose a recording file instead.');
    }
  }

  async function stop() {
    const current = recording.current;
    recording.current = null;
    setLive(null);
    if (!current) return;
    const seconds = Math.round(((Date.now() - current.startedAt) / 1000) * 10) / 10;
    const file = await current.r.stop();
    onChange(current.situation, { file, url: URL.createObjectURL(file), seconds: Math.min(seconds, MAX_SECONDS) });
  }

  function choose(situation: SoundSituation) {
    target.current = situation;
    fileInput.current?.click();
  }

  function onFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    setProblem(null);
    if (!AUDIO_TYPES.includes(file.type)) return setProblem(`${file.name} is not a WAV, FLAC or OGG recording.`);
    if (file.size > MAX_MB * 1024 * 1024) return setProblem(`${file.name} is larger than ${MAX_MB} MB.`);
    const situation = target.current;
    const url = URL.createObjectURL(file);
    onChange(situation, { file, url, seconds: null });
    // The length shows once the browser has read the file's header
    const probe = new Audio(url);
    probe.onloadedmetadata = () => onChange(situation, { file, url, seconds: Math.round(probe.duration * 10) / 10 });
  }

  return (
    <Card
      className="mb-3"
      icon="bi-soundwave"
      title="3. Sound (optional)"
      subtitle="Record what the vehicle sounds like, 5–10 seconds each. The sound model names the most likely fault; a technician checks it."
      actions={<span className="small text-body-secondary as-num">{count} of {SITUATIONS.length}</span>}
    >
      <div className="as-card-body">
        {problem && <Alert tone="warning">{problem}</Alert>}
        {!recorderAvailable && (
          <Alert tone="info">
            Recording needs a secure page (https or this computer's localhost). You can still choose recording files.
          </Alert>
        )}
        <input
          ref={fileInput}
          type="file"
          className="visually-hidden"
          accept={AUDIO_TYPES.join(',')}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <div className="as-snd-slots">
          {SITUATIONS.map((situation) => {
            const s = SOUND_SITUATIONS[situation];
            const sound = sounds[situation];
            const recordingThis = live?.situation === situation;
            return (
              <div key={situation} className={`as-snd-slot${sound ? ' filled' : ''}${recordingThis ? ' live' : ''}`}>
                <div className="as-snd-head">
                  <i className={`bi ${s.icon}`} aria-hidden="true" />
                  <b>{s.label}</b>
                  {sound && (sound.seconds !== null && sound.seconds < GOOD_SECONDS
                    ? <StatusPill tone="warning">{sound.seconds} s · short</StatusPill>
                    : <StatusPill tone="success">{sound.seconds !== null ? `${sound.seconds} s` : 'Ready'}</StatusPill>)}
                </div>
                <p className="as-snd-how">{s.how}</p>
                {recordingThis ? (
                  <div className="as-snd-live" aria-live="polite">
                    <span className="as-snd-dot" aria-hidden="true" />
                    <span className="as-num">{live.seconds.toFixed(1)} / {MAX_SECONDS} s</span>
                    <i className="as-snd-level" aria-hidden="true"><b style={{ width: `${Math.min(100, live.level * 400)}%` }} /></i>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => void stop()}>
                      <i className="bi bi-stop-fill me-1" aria-hidden="true" />Stop
                    </button>
                  </div>
                ) : sound ? (
                  <>
                    <audio controls src={sound.url} className="as-snd-audio" aria-label={`${s.label} recording`} />
                    <div className="as-snd-actions">
                      {recorderAvailable && (
                        <button type="button" className="btn btn-sm btn-light" disabled={disabled || !!live} onClick={() => void record(situation)}>
                          <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />Record again
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm btn-light"
                        aria-label={`Remove the ${s.label.toLowerCase()} recording`}
                        disabled={disabled || !!live}
                        onClick={() => onChange(situation, undefined)}
                      >
                        <i className="bi bi-trash" aria-hidden="true" />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="as-snd-actions">
                    {recorderAvailable && (
                      <button type="button" className="btn btn-sm btn-light" disabled={disabled || !!live} onClick={() => void record(situation)}>
                        <i className="bi bi-mic-fill me-1" aria-hidden="true" />Record
                      </button>
                    )}
                    <button type="button" className="btn btn-sm btn-light" disabled={disabled || !!live} onClick={() => choose(situation)}>
                      <i className="bi bi-folder2-open me-1" aria-hidden="true" />Choose file
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="small text-body-secondary mt-3 mb-0">
          <i className="bi bi-info-circle me-1" aria-hidden="true" />
          The model learned from recordings made at the engine bay; recordings from inside the car are less reliable.
        </p>
      </div>
    </Card>
  );
}
