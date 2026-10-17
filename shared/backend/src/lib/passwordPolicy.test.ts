import { describe, expect, it } from 'vitest';
import { DEFAULT_PASSWORD_POLICY as policy, passwordProblems } from './passwordPolicy.js';

describe('passwordProblems', () => {
  it('accepts a long password that mixes three kinds of character', () => {
    expect(passwordProblems('Garage2026', policy)).toEqual([]);
  });

  it('rejects short passwords', () => {
    expect(passwordProblems('Ab1!', policy)).toContain('Use at least 8 characters.');
  });

  it('rejects passwords that use only two kinds of character', () => {
    expect(passwordProblems('garage2026', policy).join(' ')).toMatch(/Mix at least 3/);
  });

  it('rejects a password containing the username', () => {
    expect(passwordProblems('Nimal.perera1', policy, 'nimal.perera').join(' ')).toMatch(/username/);
  });
});
