import {spawnSync} from 'node:child_process';
// Node 24 runs erasable TypeScript natively; scripts/*.mjs stay unbundled so their entry-point guards stay correct.
const run=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','tests/v7-acceptance.ts'],{stdio:'inherit',env:process.env});
process.exit(run.status??1);
