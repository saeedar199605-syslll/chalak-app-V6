import {createRequire} from 'node:module';import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url), viteRequire=createRequire(require.resolve('vite'));
const esbuild=viteRequire('esbuild');
esbuild.buildSync({entryPoints:['tests/v6-acceptance.ts'],bundle:true,packages:'external',platform:'node',format:'esm',outfile:'tests/.v6-connected-local.mjs'});
const run=spawnSync(process.execPath,['tests/.v6-connected-local.mjs',...process.argv.slice(2)],{stdio:'inherit',env:process.env});
fs.rmSync('tests/.v6-connected-local.mjs',{force:true});process.exit(run.status??1);
