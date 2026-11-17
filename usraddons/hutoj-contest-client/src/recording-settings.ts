import path from 'node:path';
import type { Context } from 'hydrooj';
import type { ClientService } from './core.ts';
import { validatePolicy } from './core.ts';
import { load as parseYaml } from 'js-yaml';
export function recordingPath(directory: string) {
  if (/[\x00-\x1f]/.test(directory)) {
    throw new Error('录像存储目录不能包含控制字符。');
  }
  const value = directory.trim();
  if (!value) {
    return '';
  }
  if (
    value.length > 2048 ||
    /[\x00-\x1f%]/.test(value) ||
    !(path.posix.isAbsolute(value) || path.win32.isAbsolute(value))
  ) {
    throw new Error('录像存储目录必须是录像服务所在机器的绝对路径。');
  }
  return `${value.replaceAll('\\', '/').replace(/\/+$/, '')}/%path/%Y-%m-%d_%H-%M-%S-%f_%z`;
}
export async function configureRecording(
  api: string,
  directory: string,
  download: typeof fetch = fetch,
) {
  const recordPath = recordingPath(directory);
  if (!recordPath || !api) {
    return;
  }
  const url = new URL(`${api.replace(/\/$/, '')}/v3/config/pathdefaults/`);
  const current = await download(new URL('get', url), {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (!current.ok) {
    throw new Error('无法读取录像服务配置。');
  }
  if ((await current.json()).recordPath === recordPath) {
    return;
  }
  const result = await download(new URL('patch', url), {
    method: 'PATCH',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ record: true, recordPath }),
    signal: AbortSignal.timeout(5000),
  });
  if (!result.ok) {
    throw new Error('录像服务未能应用新的存储目录。');
  }
}
export async function registerRecordingSettings(
  ctx: Context,
  H: typeof import('hydrooj'),
  service: ClientService,
) {
  const mediaField = (label: string) => H.Schema.string().max(2048).description(label);
  const config = ctx.setting.requestConfig(
    H.Schema.object({
      contestClient: H.Schema.object({
        whipUrlTemplate: mediaField('WHIP 地址模板'),
        mediaApiUrl: mediaField('媒体管理 API 地址'),
        mediaPlaybackUrl: mediaField('录像回放服务地址'),
        recordingDirectory: H.Schema.string()
          .default('')
          .pattern(/^(?:$|(?:\/|[a-zA-Z]:[\\/]|\\\\)[^\x00-\x1f%]*)$/)
          .description('录像存储目录'),
      }).description('比赛客户端'),
    }),
  );
  // Keep the schema serializable as native text fields. Server-only callbacks in
  // Schema.transform cannot be rendered by Hydro's configuration form.
  ctx.on('handler/before/SystemConfig#post', (h) => {
    try {
      const values = parseYaml(h.request.body.value) as {
        contestClient?: Record<string, unknown>;
      } | null;
      validatePolicy(values?.contestClient || {});
    } catch (error) {
      throw new H.ValidationError('contestClient', '', (error as Error).message);
    }
  });
  // Import an unambiguous legacy value once. Explicit empty global values stay
  // empty; differing contest values are retained in storage for manual review.
  const rows = await service.settings.find({}).toArray();
  const migrated: Record<string, string> = {};
  for (const name of ['whipUrlTemplate', 'mediaApiUrl', 'mediaPlaybackUrl'] as const) {
    if (config.contestClient[name] !== undefined) continue;
    const values = [...new Set(rows.map((row) => row[name]?.trim()).filter(Boolean))];
    migrated[name] = values.length === 1 ? validatePolicy({ [name]: values[0] })[name] : '';
    if (values.length > 1) {
      console.warn(`比赛客户端：旧比赛的 ${name} 不一致，请在系统设置中统一配置。`);
    }
  }
  if (Object.keys(migrated).length) {
    await ctx.setting.setConfig('contestClient', { ...config.contestClient, ...migrated });
  }
  service.mediaSettings = () => {
    const validated = validatePolicy(config.contestClient);
    return {
      whipUrlTemplate: validated.whipUrlTemplate,
      mediaApiUrl: validated.mediaApiUrl,
      mediaPlaybackUrl: validated.mediaPlaybackUrl,
    };
  };
  const applied = new Map<string, { directory: string; time: number }>();
  const pending = new Map<string, Promise<void>>();
  const ensure = async (api: string) => {
    const directory = config.contestClient.recordingDirectory;
    if (!directory || !api) {
      return;
    }
    const previous = applied.get(api);
    if (previous?.directory === directory && Date.now() - previous.time < 30000) {
      return;
    }
    if (pending.has(api)) {
      return pending.get(api);
    }
    const job = configureRecording(api, directory).then(() => {
      applied.set(api, { directory, time: Date.now() });
    });
    pending.set(api, job);
    try {
      await job;
    } finally {
      pending.delete(api);
    }
  };
  ctx.on('handler/after', async (h) => {
    if (
      h.constructor.name.replace(/Handler$/, '') !== 'SystemConfig' ||
      h.request.method !== 'post'
    ) {
      return;
    }
    applied.clear();
    await ensure(service.mediaSettings().mediaApiUrl);
  });
  return ensure;
}
