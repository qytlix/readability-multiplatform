import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('brand splash resource', () => {
  it('contains the local brand identity without remote resources', () => {
    const html = fs.readFileSync(
      path.resolve(__dirname, '../../../resources/splash/splash.html'),
      'utf8',
    );

    expect(html).toContain('Shale · 页岩');
    expect(html).toContain('Let ideas settle into layers.');
    expect(html).toContain('<svg');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('<script');
  });
});
