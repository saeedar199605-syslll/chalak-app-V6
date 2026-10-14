import { forwardAuthority } from '../../cloudflare/authority';
import type { CloudflareEnv } from '../../cloudflare/auth';
export function onRequestGet({env}:{env:CloudflareEnv}) { return forwardAuthority(new Request('https://authority/internal/health'),env); }
