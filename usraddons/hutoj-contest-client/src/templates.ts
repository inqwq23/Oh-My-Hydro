import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Context } from 'hydrooj';

// Hydro's addon template scan runs only when TemplateService starts.
export async function registerTemplates(ctx: Context, folder: string) {
  const registry = (ctx as unknown as { template: { registry: Record<string, string> } })
    .template.registry;
  const entries: Array<[string, string]> = [];
  for (const file of await readdir(folder, { withFileTypes: true })) {
    if (!file.isFile() || !/^hutoj_client_[a-z_]+\.(html|json)$/.test(file.name)) {
      continue;
    }
    const filename = path.join(folder, file.name);
    entries.push(
      [file.name, await readFile(filename, 'utf8')],
      [`${file.name}.source`, filename],
    );
  }
  const sidebarTemplates: Record<string, string> = {};
  const sidebar = registry['partials/contest_sidebar_management.html'];
  const clarification =
    /<li\b[^>]*>\s*<a\b[^>]*\{\{\s*url\(['"]contest_clarification['"][\s\S]*?<\/a>\s*<\/li>/;
  if (sidebar && clarification.test(sidebar)) {
    const customSidebar = 'hutoj_client_management_sidebar.html';
    entries.push([
      customSidebar,
      sidebar.replace(clarification, '$&\n{% include "hutoj_client_sidebar_entry.html" %}'),
    ]);
    // Reuse Hydro's current page and sidebar templates, including addon changes.
    // New names also work with the DEV loader, which prioritizes builtin files.
    for (const [name, content] of Object.entries({
      ...registry,
      ...Object.fromEntries(entries),
    })) {
      if (
        !name.endsWith('.html') ||
        !content.includes('partials/contest_sidebar_management.html')
      ) {
        continue;
      }
      const alias = `hutoj_client_sidebar_${name.replace(/[^a-zA-Z0-9_]/g, '_')}.html`;
      sidebarTemplates[name] = alias;
      entries.push([
        alias,
        content.replaceAll('partials/contest_sidebar_management.html', customSidebar),
      ]);
    }
  }
  ctx.effect(() => {
    const previous = entries.map(([name]) => registry[name]);
    for (const [name, content] of entries) {
      registry[name] = content;
    }
    return () =>
      entries.forEach(([name, content], index) => {
        if (registry[name] !== content) {
          return;
        }
        if (previous[index] === undefined) {
          delete registry[name];
        } else {
          registry[name] = previous[index];
        }
      });
  });
  return sidebarTemplates;
}
