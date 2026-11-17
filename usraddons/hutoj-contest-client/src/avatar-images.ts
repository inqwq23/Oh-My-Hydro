// Inline only avatars selected by Hydro's scoreboard renderer. The client never
// needs an Internet exception or sends its contest credentials to an image host.
const cache = new Map<string, { expires: number; value: Promise<string> }>();
export async function inlineAvatars(
  html: string,
  origin: string,
  gravatar: string,
  fallback: string,
  download: typeof fetch = fetch,
): Promise<string> {
  const base = new URL(origin);
  const hosts = new Set([
    'q1.qlogo.cn',
    'q2.qlogo.cn',
    'github.com',
    'avatars.githubusercontent.com',
    'www.gravatar.com',
    'secure.gravatar.com',
  ]);
  try {
    if (/^(?:https?:)?\/\//.test(gravatar)) {
      hosts.add(new URL(gravatar, base).hostname);
    }
  } catch {
    /* Invalid admin setting uses the stock avatar. */
  }
  const tags = [...html.matchAll(/<img\b[^>]*>/gi)].filter(([tag]) =>
    /class=["'][^"']*\buser-profile-avatar\b/.test(tag),
  );
  const sources = new Map<string, string>();
  async function image(src: string): Promise<string> {
    if (
      /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(src) &&
      src.length < 90000
    ) {
      return src;
    }
    const allowed = (url: URL) =>
      !url.username &&
      !url.password &&
      url.protocol === 'https:' &&
      hosts.has(url.hostname) &&
      (!url.port || url.port === '443');
    let url: URL;
    try {
      url = new URL(src.replaceAll('&amp;', '&'), base);
    } catch {
      return fallback;
    }
    if (url.origin !== base.origin && url.protocol === 'http:' && hosts.has(url.hostname)) {
      url.protocol = 'https:';
    }
    if (!allowed(url)) {
      return fallback;
    }
    const key = url.href;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) {
      return hit.value;
    }
    const value = (async () => {
      try {
        for (let redirects = 0; redirects <= 3; redirects++) {
          const response = await download(url, {
            redirect: 'manual',
            headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif' },
            signal: AbortSignal.timeout(3000),
          });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            await response.body?.cancel();
            url = new URL(response.headers.get('location') || '', url);
            if (!allowed(url)) {
              return fallback;
            }
            continue;
          }
          const type = response.headers.get('content-type')?.split(';')[0] || '';
          if (
            !response.ok ||
            !/^image\/(png|jpeg|gif|webp)$/.test(type) ||
            Number(response.headers.get('content-length')) > 65536
          ) {
            await response.body?.cancel();
            return fallback;
          }
          const reader = response.body?.getReader();
          if (!reader) {
            return fallback;
          }
          const parts: Uint8Array[] = [];
          let size = 0;
          try {
            for (;;) {
              const item = await reader.read();
              if (item.done) {
                break;
              }
              size += item.value.length;
              if (size > 65536) {
                await reader.cancel();
                return fallback;
              }
              parts.push(item.value);
            }
          } finally {
            reader.releaseLock();
          }
          return size
            ? `data:${type};base64,${Buffer.concat(parts).toString('base64')}`
            : fallback;
        }
      } catch {
        /* Offline image providers must not break the scoreboard. */
      }
      return fallback;
    })();
    if (cache.size >= 256) {
      cache.delete(cache.keys().next().value!);
    }
    cache.set(key, { expires: Date.now() + 600000, value });
    return value;
  }
  // Bound concurrent provider requests even for a large scoreboard.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, tags.length) }, async () => {
      while (cursor < tags.length) {
        const tag = tags[cursor++][0];
        const src = /\bsrc=["']([^"']*)["']/.exec(tag)?.[1];
        if (src && !sources.has(src)) {
          sources.set(src, await image(src));
        }
      }
    }),
  );
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    /class=["'][^"']*\buser-profile-avatar\b/.test(tag)
      ? tag.replace(
          /\bsrc=(["'])([^"']*)\1/,
          (_, quote, src) => `src=${quote}${sources.get(src) || fallback}${quote}`,
        )
      : tag,
  );
}
