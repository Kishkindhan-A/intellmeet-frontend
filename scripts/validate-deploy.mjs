import { readFile } from 'node:fs/promises';
import { parseAllDocuments } from 'yaml';
for (const file of [
  'compose.yaml',
  '.github/workflows/ci.yml',
  '.github/workflows/security.yml',
  'deploy/kubernetes.yaml',
]) {
  const docs = parseAllDocuments(await readFile(file, 'utf8'));
  for (const doc of docs)
    if (doc.errors.length)
      throw new Error(`${file}: ${doc.errors.map((e) => e.message).join('; ')}`);
  console.log(`${file}: valid YAML (${docs.length} document(s))`);
}
