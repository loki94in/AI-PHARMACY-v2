import {
  runHeavyJob,
  isHeavyLaneBusy
} from '../src/utils/backgroundJobLane.js';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

describe('backgroundJobLane', () => {
  test('serializes concurrent jobs (no overlap)', async () => {
    const events: string[] = [];

    const a = runHeavyJob('job_a', async () => {
      events.push('a_start');
      await delay(50);
      events.push('a_end');
    });
    const b = runHeavyJob('job_b', async () => {
      events.push('b_start');
      await delay(10);
      events.push('b_end');
    });

    await Promise.all([a, b]);

    expect(events).toEqual(['a_start', 'a_end', 'b_start', 'b_end']);
  });

  test('skips a re-entrant tick of the same job while queued/running', async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>(res => { release = res; });

    const first = runHeavyJob('solo_job', async () => {
      runs++;
      await gate;
    });
    // Let the lane pick it up so it becomes active.
    await delay(10);

    // Same-name call while still running → skipped, not queued.
    const second = await runHeavyJob('solo_job', async () => {
      runs++;
    });
    expect(second).toEqual({ skipped: true });

    release();
    await first;
    expect(runs).toBe(1);
  });

  test('lane stays alive after a job rejects', async () => {
    await expect(
      runHeavyJob('boom', async () => {
        throw new Error('intentional');
      })
    ).rejects.toThrow('intentional');

    const result = await runHeavyJob('after_boom', async () => 'ok');
    expect(result).toBe('ok');
  });

  test('isHeavyLaneBusy reflects running state', async () => {
    expect(isHeavyLaneBusy()).toBe(false);
    let release!: () => void;
    const gate = new Promise<void>(res => { release = res; });
    const job = runHeavyJob('busy_check', async () => {
      await gate;
    });
    await delay(10);
    expect(isHeavyLaneBusy()).toBe(true);
    release();
    await job;
    await delay(0);
    expect(isHeavyLaneBusy()).toBe(false);
  });
});
