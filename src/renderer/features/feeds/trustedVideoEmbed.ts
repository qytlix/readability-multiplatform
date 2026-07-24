export interface TrustedVideoEmbed {
  provider: 'youtube' | 'vimeo';
  src: string;
  title: string;
}

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_VIDEO_ID = /^\d+$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const VIMEO_HOSTS = new Set([
  'vimeo.com',
  'www.vimeo.com',
  'player.vimeo.com',
]);

export function getTrustedVideoEmbed(
  articleUrl?: string,
  rawHtml?: string,
): TrustedVideoEmbed | null {
  const directEmbed = toTrustedVideoEmbed(articleUrl);
  if (directEmbed) return directEmbed;
  if (!rawHtml || typeof DOMParser === 'undefined') return null;

  const document = new DOMParser().parseFromString(rawHtml, 'text/html');
  for (const iframe of document.querySelectorAll('iframe')) {
    if (isNonArticleVideoFrame(iframe)) continue;

    for (const attribute of ['src', 'data-src']) {
      const candidate = iframe.getAttribute(attribute);
      const embed = toTrustedVideoEmbed(candidate ?? undefined, articleUrl);
      if (embed) return embed;
    }
  }

  for (const liteYouTube of document.querySelectorAll('lite-youtube[videoid]')) {
    const videoId = liteYouTube.getAttribute('videoid')?.trim() ?? '';
    if (YOUTUBE_VIDEO_ID.test(videoId)) {
      return createYouTubeEmbed(videoId);
    }
  }

  return null;
}

export function getNativeVideoHtml(cleanedHtml?: string): string | null {
  if (!cleanedHtml || typeof DOMParser === 'undefined') return null;

  const document = new DOMParser().parseFromString(cleanedHtml, 'text/html');
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length === 0) return null;

  return videos.map((video) => video.outerHTML).join('');
}

function toTrustedVideoEmbed(
  candidate?: string,
  baseUrl?: string,
): TrustedVideoEmbed | null {
  if (!candidate?.trim()) return null;

  let url: URL;
  try {
    url = baseUrl
      ? new URL(candidate.trim(), baseUrl)
      : new URL(candidate.trim());
  } catch {
    return null;
  }

  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:')
    || url.username
    || url.password
  ) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const pathParts = url.pathname.split('/').filter(Boolean);

  if (hostname === 'youtu.be') {
    const videoId = pathParts[0] ?? '';
    return YOUTUBE_VIDEO_ID.test(videoId)
      ? createYouTubeEmbed(videoId)
      : null;
  }

  if (YOUTUBE_HOSTS.has(hostname)) {
    const videoId = url.pathname === '/watch'
      ? url.searchParams.get('v') ?? ''
      : ['embed', 'shorts', 'live'].includes(pathParts[0] ?? '')
        ? pathParts[1] ?? ''
        : '';
    return YOUTUBE_VIDEO_ID.test(videoId)
      ? createYouTubeEmbed(videoId)
      : null;
  }

  if (VIMEO_HOSTS.has(hostname)) {
    const videoId = hostname === 'player.vimeo.com' && pathParts[0] === 'video'
      ? pathParts[1] ?? ''
      : pathParts[0] ?? '';
    if (VIMEO_VIDEO_ID.test(videoId)) {
      return {
        provider: 'vimeo',
        src: `https://player.vimeo.com/video/${videoId}`,
        title: 'Vimeo 视频',
      };
    }
  }

  return null;
}

function createYouTubeEmbed(videoId: string): TrustedVideoEmbed {
  return {
    provider: 'youtube',
    src: `https://www.youtube-nocookie.com/embed/${videoId}`,
    title: 'YouTube 视频',
  };
}

function isNonArticleVideoFrame(iframe: Element): boolean {
  const title = iframe.getAttribute('title')?.toLowerCase() ?? '';
  const style = iframe.getAttribute('style')?.replace(/\s+/g, '').toLowerCase() ?? '';
  const width = Number.parseInt(iframe.getAttribute('width') ?? '', 10);
  const height = Number.parseInt(iframe.getAttribute('height') ?? '', 10);

  return title.includes('recent videos')
    || style.includes('display:none')
    || style.includes('visibility:hidden')
    || width === 0
    || height === 0;
}
