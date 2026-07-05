// Ambient (non-module) declarations for esbuild's non-TS loaders.
// SVGs are loaded as text strings, CSS as side-effect imports.

declare module '*.svg' {
  const content: string;
  export default content;
}

declare module '*.css' {
  const content: string;
  export default content;
}
