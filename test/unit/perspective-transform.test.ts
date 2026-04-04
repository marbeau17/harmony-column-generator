import { describe, it, expect } from 'vitest';
import {
  getPerspectivePrompt,
  isValidPerspectiveType,
  getAllPerspectiveTypes,
} from '@/lib/content/perspective-transform';

describe('getPerspectivePrompt', () => {
  const types = getAllPerspectiveTypes();

  it.each(types)('タイプ "%s" で空でない文字列が返る', (type) => {
    const prompt = getPerspectivePrompt(type);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });
});

describe('isValidPerspectiveType', () => {
  it('有効なタイプでtrueが返る', () => {
    expect(isValidPerspectiveType('experience_to_lesson')).toBe(true);
    expect(isValidPerspectiveType('personal_to_universal')).toBe(true);
    expect(isValidPerspectiveType('concept_to_practice')).toBe(true);
    expect(isValidPerspectiveType('case_to_work')).toBe(true);
    expect(isValidPerspectiveType('past_to_modern')).toBe(true);
    expect(isValidPerspectiveType('deep_to_intro')).toBe(true);
  });

  it('無効なタイプでfalseが返る', () => {
    expect(isValidPerspectiveType('invalid_type')).toBe(false);
    expect(isValidPerspectiveType('')).toBe(false);
    expect(isValidPerspectiveType('EXPERIENCE_TO_LESSON')).toBe(false);
  });
});
