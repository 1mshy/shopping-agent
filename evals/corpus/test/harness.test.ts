import { describe, expect, test } from 'vitest';
import { formatCounts, loadAreas } from '../count.ts';
import { defineArea, NotImplementedError, notImplemented, runCase } from '../harness.ts';

const accept = () => {};

describe('runCase', () => {
  test('a pending area counts a case only when the subject throws NotImplementedError', async () => {
    expect(await runCase('pending', () => notImplemented('x'), accept)).toBe('pending');
  });

  test('a pending area fails on any other error', async () => {
    const boom = () => {
      throw new TypeError('wrong case data');
    };
    await expect(runCase('pending', boom, accept)).rejects.toThrow('wrong case data');
  });

  test('a pending area fails when the subject answers', async () => {
    await expect(runCase('pending', () => 1, accept)).rejects.toThrow('still marked pending');
  });

  test('an implemented area fails when the subject is not implemented', async () => {
    await expect(runCase('implemented', () => notImplemented('x'), accept)).rejects.toThrow(
      'marked implemented',
    );
  });

  test('an implemented area passes only when verify accepts the answer', async () => {
    expect(
      await runCase(
        'implemented',
        () => 2,
        (n) => expect(n).toBe(2),
      ),
    ).toBe('passed');
    await expect(
      runCase(
        'implemented',
        () => 2,
        (n) => expect(n).toBe(3),
      ),
    ).rejects.toThrow();
  });

  test('verify is not run while pending', async () => {
    let ran = false;
    await runCase(
      'pending',
      () => notImplemented('x'),
      () => {
        ran = true;
      },
    );
    expect(ran).toBe(false);
  });

  test('async subjects are awaited', async () => {
    const later = async () => notImplemented('x');
    expect(await runCase('pending', later, accept)).toBe('pending');
    expect(
      await runCase(
        'implemented',
        async () => 5,
        (n) => expect(n).toBe(5),
      ),
    ).toBe('passed');
  });

  test('NotImplementedError names its subject', () => {
    const err = new NotImplementedError('wall classifier');
    expect(err.subject).toBe('wall classifier');
    expect(err.name).toBe('NotImplementedError');
  });
});

describe('defineArea', () => {
  const base = {
    id: 'some-area',
    status: 'pending',
    sources: ['a.py'],
    cases: [{ id: 'one' }],
  } as const;

  test('accepts a well-formed area', () => {
    expect(defineArea(base).cases).toHaveLength(1);
  });

  test.each([
    ['a bad area id', { ...base, id: 'Some Area' }],
    ['no sources', { ...base, sources: [] }],
    ['no cases', { ...base, cases: [] }],
    ['a bad case id', { ...base, cases: [{ id: 'One!' }] }],
    ['a repeated case id', { ...base, cases: [{ id: 'one' }, { id: 'one' }] }],
  ])('refuses %s', (_name, area) => {
    expect(() => defineArea(area)).toThrow();
  });
});

describe('count', () => {
  test('every directory under areas/ exports an area whose id is the directory name', async () => {
    const areas = await loadAreas();
    for (const a of areas) expect(() => defineArea(a)).not.toThrow();
  });

  test('totals pending and implemented cases', () => {
    const table = formatCounts([
      { id: 'a', status: 'pending', sources: ['s'], cases: [{ id: 'x' }, { id: 'y' }] },
      { id: 'b', status: 'implemented', sources: ['s'], cases: [{ id: 'z' }] },
    ]);
    expect(table).toContain('| **Total** | **3** | 2 pending, 1 implemented |');
  });
});
