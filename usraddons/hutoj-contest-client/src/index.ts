import * as Hydro from 'hydrooj';
import { register } from './plugin.ts';
import { registerTemplates } from './templates.ts';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
export { registerTemplates };

export const name = 'hutoj-contest-client';
export const inject = ['db', 'server', 'template', 'setting'];
export const Config = Hydro.Schema.object({
  clientKey: Hydro.Schema.string()
    .role('secret')
    .default('')
    .description('客户端部署密钥（至少 32 字符）'),
});
export async function apply(ctx: Hydro.Context, config: { clientKey: string }) {
  const sidebarTemplates = await registerTemplates(ctx, path.join(__dirname, 'templates'));
  const avatarFallback = `data:image/png;base64,${(await readFile(path.join(__dirname, 'web/avatar.png'))).toString('base64')}`;
  await register(ctx, Hydro, {
    clientKey: process.env.HUTOJ_CONTEST_CLIENT_KEY || config.clientKey || '',
    sidebarTemplates,
    avatarFallback,
  });
}
