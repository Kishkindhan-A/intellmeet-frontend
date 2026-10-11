import { writeFile } from 'node:fs/promises';
import { openapi } from '../src/openapi.js';
await writeFile(
  'docs/openapi.json',
  JSON.stringify(openapi('http://localhost:4000'), null, 2) + '\n',
);
console.log('Exported docs/openapi.json');
