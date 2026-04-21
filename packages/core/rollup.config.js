import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

export default {
  input: 'src/index.js',
  output: [
    {
      file   : 'dist/index.mjs',
      format : 'esm',
      sourcemap: true,
    },
    {
      file   : 'dist/index.cjs',
      format : 'cjs',
      sourcemap: true,
      exports: 'named',
    },
  ],
  // Zero external dependencies — ships entirely standalone
};
