import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

// Walk public/footage at build/dev-start time and emit a { urlPath: bytes }
// map as a virtual module. The runtime uses this as a fallback for the
// progress bar when the remote server omits Content-Length (e.g. chunked
// transfer encoding on the deployed CDN).
function footageSizes(): Plugin {
  const VIRTUAL = 'virtual:footage-sizes';
  const RESOLVED = '\0' + VIRTUAL;
  return {
    name: 'footage-sizes',
    resolveId(id) {
      if (id === VIRTUAL) return RESOLVED;
    },
    load(id) {
      if (id !== RESOLVED) return;
      const publicDir = join(process.cwd(), 'public');
      const root = join(publicDir, 'footage');
      const map: Record<string, number> = {};
      const walk = (dir: string, urlPrefix: string) => {
        for (const ent of readdirSync(dir, { withFileTypes: true })) {
          const abs = join(dir, ent.name);
          const url = posix.join(urlPrefix, ent.name);
          if (ent.isDirectory()) walk(abs, url);
          else if (ent.isFile() && ent.name.endsWith('.mp4'))
            map[url] = statSync(abs).size;
        }
      };
      try {
        walk(root, '/footage');
      } catch {
        // No footage dir yet — return empty map.
      }
      return `export default ${JSON.stringify(map)};`;
    },
  };
}

export default defineConfig({
  plugins: [preact(), tailwindcss(), footageSizes()],
});
