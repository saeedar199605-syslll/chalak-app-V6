const {createRequire}=require('node:module');const esbuild=createRequire(require.resolve('vite'))('esbuild');
esbuild.buildSync({entryPoints:['tools/state-transfer.ts'],bundle:true,packages:'external',platform:'node',format:'esm',outfile:'tools/state-transfer.mjs'});
