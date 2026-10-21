import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJobFrame, fetchVideoJob, occupancyHealth, occupancyModel, startVideoJob } from '../../integrations/ml/occupancyService.js';
import { area, bayBody, cameraBody, confirmBayBody, polygonSchema, rulesBody, sourceSchema } from './occupancy.routes.js';
import { plateCore } from './occupancy.plates.js';
import { autoConfirmChoice, chooseBayLink, pairBaysWithQueue, serviceJobId, transitionRows } from './occupancy.service.js';

const NO_PLATE = { plateText: null, plateCore: null, plateVotes: null, plateReads: null, plateStable: false, plateDone: false };

const SQUARE: [number, number][] = [[0.1, 0.1], [0.4, 0.1], [0.4, 0.5], [0.1, 0.5]];

describe('bay outlines', () => {
  it('accepts normalised points and rejects points outside the frame', () => {
    expect(polygonSchema.safeParse(SQUARE).success).toBe(true);
    expect(polygonSchema.safeParse([[0, 0], [1.2, 0], [0, 1]]).success).toBe(false);
  });

  it('rejects outlines with too few points or no area', () => {
    expect(polygonSchema.safeParse(SQUARE.slice(0, 2)).success).toBe(false);
    expect(polygonSchema.safeParse([[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]]).success).toBe(false); // a line
    expect(Math.abs(area(SQUARE))).toBeCloseTo(0.12);
  });

  it('validates bay fields, with readable messages', () => {
    expect(bayBody.parse({ code: 'B7', name: 'Bay 7', polygon: SQUARE }).code).toBe('B7');
    const bad = bayBody.safeParse({ code: 'B 7!', name: '' });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((i) => i.path.join('.'))).toEqual(expect.arrayContaining(['code', 'name']));
  });
});

describe('camera sources', () => {
  it('allows rtsp addresses and plain video file names only', () => {
    expect(sourceSchema.safeParse('rtsp://10.0.0.5/stream1').success).toBe(true);
    expect(sourceSchema.safeParse('workshop-a.mp4').success).toBe(true);
    for (const s of ['../secret.mp4', 'C:\\videos\\a.mp4', 'http://x/a.mp4', 'notes.txt']) {
      expect(sourceSchema.safeParse(s).success).toBe(false);
    }
  });

  it('treats an empty source as "none"', () => {
    expect(cameraBody.parse({ code: 'CAM-B', name: 'Workshop B', sourceUrl: '' }).sourceUrl).toBeNull();
  });
});

describe('occupancy rules', () => {
  const base = { overlapThreshold: 0.4, confirmOccupiedSeconds: 3, confirmFreeSeconds: 5, sampleFps: 2 };
  it('accepts the shipped defaults', () => {
    expect(rulesBody.parse(base)).toEqual(base);
  });
  it('rejects a release threshold above the overlap threshold', () => {
    expect(rulesBody.safeParse({ ...base, releaseThreshold: 0.5 }).success).toBe(false);
  });
  it('explains out-of-range values in words staff can act on', () => {
    const r = rulesBody.safeParse({ ...base, overlapThreshold: 2, confirmFreeSeconds: 0, sampleFps: 'x' });
    expect(r.success).toBe(false);
    const messages = Object.fromEntries(r.error!.issues.map((i) => [i.path.join('.'), i.message]));
    expect(messages).toEqual({
      overlapThreshold: 'Enter a number from 0.05 to 0.95.',
      confirmFreeSeconds: 'Enter a number above 0 and up to 120.',
      sampleFps: 'Enter a number.',
    });
  });
});

const report = {
  jobId: 'VJ-9', status: 'running' as const, error: null, framesProcessed: 30, totalFrames: 100, streamSeconds: 15,
  bays: {}, transitionCount: 2,
  transitions: [
    { bayId: '4', fromState: 'uncertain' as const, toState: 'occupied' as const, atSeconds: 5.5, trackId: 3, overlap: 0.82, evidence: 'present 7/7 samples over 3.0s' },
    { bayId: 'x', fromState: 'free' as const, toState: 'occupied' as const, atSeconds: 6, trackId: null, overlap: null, evidence: '' },
  ],
};

describe('storing what the service reports', () => {
  it('turns video seconds into times from the job start and skips unknown bays', () => {
    const rows = transitionRows(report, 9, new Date('2026-10-19T08:00:00Z'));
    expect(rows).toEqual([{
      bayId: 4, fromState: 'uncertain', toState: 'occupied', at: new Date('2026-10-19T08:00:05.500Z'),
      trackId: 3, overlap: 0.82, evidence: 'present 7/7 samples over 3.0s', videoJobId: 9,
    }]);
    expect(serviceJobId(9)).toBe('VJ-9');
  });
});

describe('occupancy service client', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('asks only for transitions not stored yet and checks the response', async () => {
    const fetch = reply(200, report);
    vi.stubGlobal('fetch', fetch);
    expect((await fetchVideoJob('http://svc:8002', 'VJ-9', 1))?.framesProcessed).toBe(30);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe('http://svc:8002/video-jobs/VJ-9?since=1');
  });

  it('reports a job the service no longer knows as null, and a malformed answer as an error', async () => {
    vi.stubGlobal('fetch', reply(404, { detail: 'No such video job' }));
    expect(await fetchVideoJob('http://svc:8002', 'VJ-9', 0)).toBeNull();
    vi.stubGlobal('fetch', reply(200, { status: 'running' }));
    await expect(fetchVideoJob('http://svc:8002', 'VJ-9', 0)).rejects.toMatchObject({ code: 'OCCUPANCY_SERVICE_BAD_RESPONSE' });
  });

  it('reads whether the service masked outside the bays, and accepts services that do not say', async () => {
    const request = { jobId: 'VJ-1', source: 'a.mp4', bays: [], rules: {}, sampleFps: 2 };
    vi.stubGlobal('fetch', reply(202, { ...report, roiMask: true }));
    expect((await startVideoJob('http://svc:8002', request)).roiMask).toBe(true);
    vi.stubGlobal('fetch', reply(202, report));
    expect((await startVideoJob('http://svc:8002', request)).roiMask).toBeUndefined();
  });

  it("fetches a live bay picture, and reports 'no picture yet' as null", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetch);
    expect((await fetchJobFrame('http://svc:8002', 'VJ-3', '25'))?.length).toBe(3);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe('http://svc:8002/video-jobs/VJ-3/frame?bay=25&width=480');
    vi.stubGlobal('fetch', reply(404, { detail: 'No picture yet' }));
    expect(await fetchJobFrame('http://svc:8002', 'VJ-3', '25')).toBeNull();
  });

  it('reports the model and its masking default, for the settings screen', async () => {
    const model = { version: 'pklot_yolo11s_1280', placeholder: false, imgsz: 1280, roiMask: { setting: 'auto', default: true, marginPx: 12 } };
    vi.stubGlobal('fetch', reply(200, { status: 'up', model, jobsRunning: 0 }));
    expect(await occupancyModel('http://svc:8002')).toEqual(model);
    vi.stubGlobal('fetch', reply(503, {}));
    await expect(occupancyModel('http://svc:8002')).rejects.toMatchObject({ status: 503 });
  });

  it("reads how many jobs the service is running, as 0 from services that do not say", async () => {
    const model = { version: 'v', placeholder: false };
    vi.stubGlobal('fetch', reply(200, { status: 'up', model, jobsRunning: 1 }));
    expect((await occupancyHealth('http://svc:8002')).jobsRunning).toBe(1);
    vi.stubGlobal('fetch', reply(200, { status: 'up', model }));
    expect((await occupancyHealth('http://svc:8002')).jobsRunning).toBe(0);
  });

  it("passes on the service's reason when it refuses a job, and 503 when it is down or not set up", async () => {
    const request = { jobId: 'VJ-1', source: 'a.mp4', bays: [], rules: {}, sampleFps: 2 };
    vi.stubGlobal('fetch', reply(404, { detail: 'Video not found in the video folder: a.mp4' }));
    await expect(startVideoJob('http://svc:8002', request)).rejects.toMatchObject({ status: 422, message: 'Video not found in the video folder: a.mp4' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(startVideoJob('http://svc:8002', request)).rejects.toMatchObject({ status: 503, code: 'OCCUPANCY_SERVICE_UNAVAILABLE' });
    await expect(startVideoJob(undefined, request)).rejects.toMatchObject({ code: 'OCCUPANCY_SERVICE_NOT_CONFIGURED' });
  });
});

describe('suggesting which waiting vehicle is in an occupied bay', () => {
  const bay = (bayId: number) => ({ bayId, code: `B${bayId}`, name: `Bay ${bayId}`, since: null, overlap: 0.8, ...NO_PLATE });
  const job = (jobId: number) => ({
    jobId, jobNo: `JOB-${jobId}`, registrationNo: 'WP CAB-0001', vehicle: 'Toyota Aqua', service: 'Full service',
    stage: 'waiting_for_bay' as const, checkedInAt: '2026-10-20T03:00:00Z',
  });

  it('gives the longest-occupied bay the first vehicle in the queue, and no vehicle when the queue runs out', () => {
    expect(pairBaysWithQueue([bay(3), bay(1)], [job(10)]).map((b) => [b.bayId, b.suggestedJobId])).toEqual([[3, 10], [1, null]]);
    expect(pairBaysWithQueue([], [job(10)])).toEqual([]);
  });

  it('needs both a bay and a vehicle to confirm', () => {
    expect(confirmBayBody.parse({ bayId: 3, jobId: 10 })).toEqual({ bayId: 3, jobId: 10 });
    const r = confirmBayBody.safeParse({ bayId: 3 });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe('Pick the vehicle that is in the bay.');
  });
});

describe('which cameras may have jobs in their bays', () => {
  it('allows real cameras and the simulated demo camera, not other test cameras', async () => {
    const { cameraTakesJobs } = await import('./occupancy.repository.js');
    expect(cameraTakesJobs('CAM-A')).toBe(true);
    expect(cameraTakesJobs(null)).toBe(true);
    expect(cameraTakesJobs('TEST-SIM')).toBe(true);
    expect(cameraTakesJobs('TEST-PKL04')).toBe(false);
  });
});

describe('auto-confirm', () => {
  const bay = (bayId: number) => ({ bayId, code: `B${bayId}`, name: `Bay ${bayId}`, since: null, overlap: 0.9, ...NO_PLATE });
  const job = (jobId: number) => ({
    jobId, jobNo: `JOB-${jobId}`, registrationNo: 'WP CAB-0001', vehicle: 'Toyota Aqua', service: 'Full service',
    stage: 'waiting_for_bay' as const, checkedInAt: '2026-10-20T03:00:00Z',
  });

  it('moves the only waiting vehicle into the only newly occupied bay', () => {
    expect(autoConfirmChoice(true, 3, [bay(3)], [job(10)])).toBe(10);
  });

  it('leaves everything with any doubt to staff', () => {
    expect(autoConfirmChoice(false, 3, [bay(3)], [job(10)])).toBeNull();              // switched off
    expect(autoConfirmChoice(true, 3, [bay(3), bay(4)], [job(10)])).toBeNull();       // two cars without a job
    expect(autoConfirmChoice(true, 3, [bay(3)], [job(10), job(11)])).toBeNull();      // several waiting
    expect(autoConfirmChoice(true, 3, [bay(3)], [])).toBeNull();                      // nobody waiting
    expect(autoConfirmChoice(true, 3, [bay(4)], [job(10)])).toBeNull();               // another bay is the unlinked one
  });

  it('is a setting staff can switch on and off', () => {
    const base = { overlapThreshold: 0.4, confirmOccupiedSeconds: 3, confirmFreeSeconds: 5, sampleFps: 2 };
    expect(rulesBody.parse({ ...base, autoConfirm: true }).autoConfirm).toBe(true);
    expect(rulesBody.parse(base).autoConfirm).toBeUndefined();
  });
});

describe('number plates', () => {
  it('reduces Sri Lankan plates to the part that is matched, like the occupancy service', () => {
    expect(plateCore('WP KP-0683')).toBe('KP0683');
    expect(plateCore('WPKP0683')).toBe('KP0683');
    expect(plateCore('KP-0683')).toBe('KP0683');
    expect(plateCore('WP CAB-4521')).toBe('CAB4521');
    expect(plateCore('19-1234')).toBe('191234');
    expect(plateCore('HONDA')).toBeNull();
    expect(plateCore(null)).toBeNull();
  });

  const job = (jobId: number, registrationNo: string) => ({
    jobId, jobNo: `JOB-${jobId}`, registrationNo, vehicle: 'Honda Fit', service: 'Full service',
    stage: 'waiting_for_bay' as const, checkedInAt: '2026-10-21T03:00:00Z',
  });
  const read = (text: string, stable = true, done = true) => ({
    bayId: 7, code: 'SIM7', name: 'Bay 7', since: null, overlap: 0.9,
    plateText: text, plateCore: plateCore(text), plateVotes: 3, plateReads: 4, plateStable: stable, plateDone: done,
  });
  const queue = [job(10, 'WP CAB-4521'), job(11, 'WP KP 0683')];

  it('links the vehicle whose plate the camera read, even when it is not first in the queue', () => {
    const link = chooseBayLink({}, 7, [read('WP KP-0683')], queue);
    expect(link).toMatchObject({ jobId: 11, how: 'plate' });
    expect(link!.note).toContain('WP KP-0683 (3 of 4 readings)');
  });

  it('never guesses when a read plate matches nobody waiting, and waits while reading', () => {
    expect(chooseBayLink({ autoConfirm: true }, 7, [read('WP NB-1111')], [job(10, 'WP CAB-4521')])).toBeNull();
    expect(chooseBayLink({ autoConfirm: true }, 7, [read('WP KP-0683', false, false)], [job(10, 'WP CAB-4521')])).toBeNull();
  });

  it('can be switched off, and falls back to auto-confirm only when no plate could be read', () => {
    expect(chooseBayLink({ plateLink: false }, 7, [read('WP KP-0683')], queue)).toBeNull();
    const unreadable = { ...read('x', false, true), plateText: null, plateCore: null, plateVotes: 0 };
    expect(chooseBayLink({ autoConfirm: true }, 7, [unreadable], [job(10, 'WP CAB-4521')])).toMatchObject({ jobId: 10, how: 'auto' });
  });

  it('suggests the plate owner first, and the queue in order for bays without a read plate', () => {
    const plain = { ...read('x'), bayId: 3, plateText: null, plateCore: null, plateStable: false };
    const s = pairBaysWithQueue([plain, read('WP KP-0683')], queue);
    expect(s.map((b) => [b.bayId, b.suggestedJobId, b.plateMatched])).toEqual([[3, 10, false], [7, 11, true]]);
  });
});
