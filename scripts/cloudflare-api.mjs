// Read-only Cloudflare API client. It can only issue GET requests; there is no write path in this module.
export function makeReader({ accountId, token, fetchImpl = fetch }) {
  if (!/^[0-9a-f]{32}$/i.test(accountId || '')) throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character hex id');
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not set in the process environment');
  return async function get(path) {
    const response = await fetchImpl('https://api.cloudflare.com/client/v4/accounts/' + accountId + path, { method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    let body;
    try { body = await response.json(); } catch { throw new Error(`Cloudflare GET ${path} returned a non-JSON body (HTTP ${response.status})`); }
    if (!response.ok || body.success === false) throw new Error(`Cloudflare GET ${path} failed: HTTP ${response.status} ${(body.errors || []).map(e => e.code).join(',')}`);
    return body.result;
  };
}
