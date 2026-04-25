import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  input: 'src/index.js',
  external: ['@holdfastjs/core'],
  output: [
    { file: 'dist/index.mjs', format: 'esm', sourcemap: true },
    { file: 'dist/index.cjs', format: 'cjs', sourcemap: true, exports: 'named' },
  ],
  plugins: [nodeResolve()],
};
