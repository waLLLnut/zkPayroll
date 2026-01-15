import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { kitRoutes } from "vite-plugin-kit-routes";
import resolve from "vite-plugin-resolve";

export default defineConfig({
  plugins: [
    kitRoutes(),
    sveltekit(),
    resolve({
      util: `export const inspect = {};
export const deprecate = (fn, msg) => fn;
export const format = (...args) => String(args[0]).replace(/%[sdj%]/g, (x) => {
  if (x === '%%') return '%';
  const arg = args[arguments.length];
  if (x === '%s') return String(arg);
  if (x === '%d') return Number(arg);
  if (x === '%j') return JSON.stringify(arg);
  return x;
});`,
      path: `const pathModule = {
  sep: '/',
  join: (...args) => args.join('/'),
  resolve: (...args) => args.join('/'),
  dirname: (p) => p.split('/').slice(0, -1).join('/') || '.',
  basename: (p) => p.split('/').pop() || '',
  extname: (p) => {
    const parts = p.split('/');
    const last = parts[parts.length - 1] || '';
    const idx = last.lastIndexOf('.');
    return idx > 0 ? last.slice(idx) : '';
  }
};
export const sep = pathModule.sep;
export const join = pathModule.join;
export const resolve = pathModule.resolve;
export const dirname = pathModule.dirname;
export const basename = pathModule.basename;
export const extname = pathModule.extname;
export default pathModule;`,
      perf_hooks: `export const performance = globalThis.performance || {
  now: () => Date.now(),
  mark: () => {},
  measure: () => {},
  getEntriesByType: () => [],
  getEntriesByName: () => [],
};
export const createHistogram = () => ({
  record: () => {},
  recordDelta: () => {},
  reset: () => {},
  percentile: () => 0,
  mean: 0,
  min: 0,
  max: 0,
  count: 0,
});`,
      os: `export const arch = () => 'x64';
export const platform = () => 'browser';
export const tmpdir = () => '/tmp';
export const cpus = () => [];
export const homedir = () => '/';
export const hostname = () => 'browser';
export const type = () => 'Browser';
export const release = () => '1.0.0';
export const endianness = () => 'LE';
export const EOL = '\\n';`,
    }),
  ],
  build: {
    target: "esnext",
  },
  optimizeDeps: {
    exclude: ["@noir-lang/noirc_abi", "@noir-lang/acvm_js"],
    esbuildOptions: {
      target: "esnext",
    },
  },
});
