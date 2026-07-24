// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  getNativeVideoHtml,
  getTrustedVideoEmbed,
} from '../../../src/renderer/features/feeds/trustedVideoEmbed';

describe('trusted article video embeds', () => {
  it('converts YouTube article URLs to privacy-enhanced embeds', () => {
    expect(getTrustedVideoEmbed(
      'https://www.youtube.com/watch?v=uY2WF_sPecI',
    )).toEqual({
      provider: 'youtube',
      src: 'https://www.youtube-nocookie.com/embed/uY2WF_sPecI',
      title: 'YouTube 视频',
    });
    expect(getTrustedVideoEmbed(
      'https://youtu.be/uY2WF_sPecI?t=30',
    )?.src).toBe('https://www.youtube-nocookie.com/embed/uY2WF_sPecI');
  });

  it('extracts trusted lazy-loaded players without accepting arbitrary iframes', () => {
    const rawHtml = `
      <iframe src="https://tracker.example/frame"></iframe>
      <iframe
        title="Article video"
        data-src="/video/76979871"
        width="640"
        height="360"
      ></iframe>
    `;

    expect(getTrustedVideoEmbed(
      'https://player.vimeo.com/article',
      rawHtml,
    )).toEqual({
      provider: 'vimeo',
      src: 'https://player.vimeo.com/video/76979871',
      title: 'Vimeo 视频',
    });
  });

  it('rejects non-video pages and invalid video identifiers', () => {
    expect(getTrustedVideoEmbed('https://www.youtube.com/user/example')).toBeNull();
    expect(getTrustedVideoEmbed('javascript:alert(1)')).toBeNull();
    expect(getTrustedVideoEmbed(
      'https://example.com/article',
      '<iframe src="https://evil.example/embed/video"></iframe>',
    )).toBeNull();
  });

  it('extracts only native video elements from cleaned article content', () => {
    const videoHtml = getNativeVideoHtml(`
      <h2>Cranky Geeks 1987</h2>
      <img src="https://example.com/oversized-placeholder.png">
      <video controls poster="https://example.com/poster.jpg">
        <source src="https://example.com/episode.mp4" type="video/mp4">
      </video>
      <p>0:00 / 7:35</p>
      <a href="https://example.com/full">观看完整版视频</a>
    `);

    expect(videoHtml).toContain('<video');
    expect(videoHtml).toContain('episode.mp4');
    expect(videoHtml).not.toContain('Cranky Geeks');
    expect(videoHtml).not.toContain('oversized-placeholder');
    expect(videoHtml).not.toContain('0:00 / 7:35');
    expect(videoHtml).not.toContain('观看完整版');
  });

  it('returns null when cleaned content has no native video', () => {
    expect(getNativeVideoHtml('<article><p>Text article</p></article>')).toBeNull();
  });
});
