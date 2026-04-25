import { nodeResolve } from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';

export default {
  input: 'src/index.js',
  external: ['react', 'react-dom', '@holdgate/core'],
  output: [
    { file: 'dist/index.mjs', format: 'esm',  sourcemap: true },
    { file: 'dist/index.cjs', format: 'cjs',  sourcemap: true, exports: 'named' },
  ],
  plugins: [
    nodeResolve(),
    esbuild({ jsx: 'transform' }),
  ],
};
