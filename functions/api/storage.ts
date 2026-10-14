// Maintenance requires a separate operator token verified inside the authority.
import { forwardAuthority } from '../../cloudflare/authority';
import type { CloudflareEnv } from '../../cloudflare/auth';
export function onRequest({request,env}:{request:Request;env:CloudflareEnv}) { return forwardAuthority(request,env); }
