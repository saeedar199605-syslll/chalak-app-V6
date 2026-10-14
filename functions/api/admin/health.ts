// Admin-only read view; the role check happens inside the authority from the verified session.
import { forwardAuthority } from '../../../cloudflare/authority';
import type { CloudflareEnv } from '../../../cloudflare/auth';
export function onRequest({request,env}:{request:Request;env:CloudflareEnv}) { return forwardAuthority(request,env); }
