import { cpSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const webDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const standaloneDirectory = resolve(webDirectory, '.next/standalone/apps/web');

copyIfPresent(resolve(webDirectory, '.next/static'), resolve(standaloneDirectory, '.next/static'));
copyIfPresent(resolve(webDirectory, 'public'), resolve(standaloneDirectory, 'public'));

await import(pathToFileURL(resolve(standaloneDirectory, 'server.js')).href);

function copyIfPresent(source, destination) {
  if (existsSync(source)) cpSync(source, destination, { force: true, recursive: true });
}
