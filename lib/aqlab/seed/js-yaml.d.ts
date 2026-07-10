// Minimal module-shim voor js-yaml (geen @types/js-yaml in de repo).
// De seedloader is een dev/CLI-tool (tsx); dit dekt het gebruik (load).
declare module 'js-yaml' {
  export function load(input: string): unknown;
  const _default: { load: typeof load };
  export default _default;
}
