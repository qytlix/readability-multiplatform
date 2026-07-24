import { describe, expect, it } from 'vitest';
import builtInExpertBundle from '../../../resources/ai-experts/experts.json';
import {
  compileUserExpertYaml,
  renderExpertInstruction,
} from '../../../src/main/ai/experts/ExpertCompiler';
import { TranslationExpertService } from '../../../src/main/ai/services/TranslationExpertService';
import { TranslationExpertStore } from '../../../src/main/ai/stores/TranslationExpertStore';
import type { BuiltInExpertBundle } from '../../../src/shared/contracts/translation-expert.types';
import { buildTestDb } from '../../fixtures/databases/feed-fixture';

const VALID_EXPERT = `
id: user-medical
version: 1.0.0
name: Medical expert
author: Tester
description: Clinical language
instruction: |
  Use precise {{targetLanguage}} clinical terminology.
  Preserve medicine names.
matches:
  - medical
`;

describe('AI expert compiler and store', () => {
  it('ships the pinned, complete built-in expert snapshot', () => {
    expect(builtInExpertBundle.sourceRepository)
      .toBe('https://github.com/immersive-translate/prompts');
    expect(builtInExpertBundle.sourceCommit)
      .toBe('94d6522081902fce6cbe07418c402b3a5ade99ca');
    expect(builtInExpertBundle.experts).toHaveLength(29);
    expect(new Set(builtInExpertBundle.experts.map((expert) => expert.id)).size).toBe(29);
    expect(builtInExpertBundle.experts.every((expert) =>
      /^[a-f0-9]{64}$/.test(expert.sourceSha256)
      && /^[a-f0-9]{64}$/.test(expert.compiledSha256)
      && expert.instruction.trim().length > 0)).toBe(true);
  });

  it('compiles safe domain guidance and renders the supported variables', () => {
    const preview = compileUserExpertYaml(VALID_EXPERT);

    expect(preview).toMatchObject({
      valid: true,
      expert: {
        id: 'user-medical',
        origin: 'user',
      },
    });
    expect(renderExpertInstruction(
      preview.expert?.instruction ?? '',
      'English',
      'German',
    )).toContain('German clinical terminology');
  });

  it.each([
    ['unknown variable', VALID_EXPERT.replace('{{targetLanguage}}', '{{secret}}')],
    ['custom tag', VALID_EXPERT.replace('Clinical language', '!danger Clinical language')],
    ['alias', `${VALID_EXPERT}\ndetails: &shared copied\nenv:\n  value: *shared\n`],
    ['unsafe env', `${VALID_EXPERT}\nenv:\n  count: 3\n`],
  ])('rejects unsafe %s YAML', (_name, yaml) => {
    const preview = compileUserExpertYaml(yaml);
    expect(preview.valid).toBe(false);
    expect(preview.errors.length).toBeGreaterThan(0);
  });

  it('strips expert-owned transport rules without weakening Shale output rules', () => {
    const preview = compileUserExpertYaml(VALID_EXPERT.replace(
      '  Preserve medicine names.',
      '  Return only YAML.\n  Preserve a formal clinical tone.',
    ));
    expect(preview.valid).toBe(true);
    expect(preview.expert?.instruction).not.toContain('Return only YAML');
    expect(preview.expert?.instruction).toContain('formal clinical tone');
    expect(preview.warnings.some((warning) =>
      warning.includes('Removed transport instruction'))).toBe(true);
  });

  it('persists user experts, requires explicit replacement, and protects built-ins', () => {
    const { db } = buildTestDb();
    const service = new TranslationExpertService(new TranslationExpertStore(
      db,
      builtInExpertBundle as BuiltInExpertBundle,
    ));

    expect(service.list().experts.filter((expert) => expert.origin === 'builtin')).toHaveLength(29);
    expect(service.import({ yaml: VALID_EXPERT })).toEqual({ expertId: 'user-medical' });
    expect(service.list().experts.find((expert) => expert.id === 'user-medical'))
      .toMatchObject({ origin: 'user', name: 'Medical expert' });
    expect(() => service.import({ yaml: VALID_EXPERT })).toThrow(/Confirm replacement/);
    expect(service.import({ yaml: VALID_EXPERT, replace: true }))
      .toEqual({ expertId: 'user-medical' });

    const builtIn = service.list().experts.find((expert) => expert.origin === 'builtin');
    expect(builtIn).toBeDefined();
    expect(() => service.remove({ id: builtIn?.id ?? '' })).toThrow(/cannot be removed/);
    expect(service.remove({ id: 'user-medical' })).toEqual({ expertId: 'user-medical' });
  });

  it('rejects a corrupted built-in artifact at startup', () => {
    const { db } = buildTestDb();
    const corrupted = structuredClone(builtInExpertBundle);
    const first = corrupted.experts[0];
    if (!first) throw new Error('Expected a built-in expert fixture.');
    first.instruction = `${first.instruction}\ncorrupted`;

    expect(() => new TranslationExpertStore(
      db,
      corrupted as BuiltInExpertBundle,
    )).toThrow(/integrity validation/);
  });
});
