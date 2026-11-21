// Public smoke checks only: no credentials or operational writes.
const frontend = (process.env.SENTINEL_FRONTEND_URL || 'https://sentinel-sdn.vercel.app').replace(/\/$/, '');
const api = (process.env.SENTINEL_API_URL || 'https://api-production-5de58.up.railway.app').replace(/\/$/, '');
let failures = 0;
async function check(name, url, validate, options = {}) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await validate(response);
    console.log(`PASS ${name}`);
  } catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}
await Promise.all([
  ...['/', '/auth/sign-in', '/auth/register', '/app', '/privacy'].map(route =>
    check(`frontend ${route}`, frontend + route, async response => {
      const html = await response.text();
      if (!html.includes('id="root"') || !html.includes('type="module"')) throw new Error('Application HTML missing (possibly deployment protection)');
    })),
  check('background image', frontend + '/assets/scene-fiber.webp', async response => {
    if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error('Image asset is missing');
  }),
  check('API liveness', api + '/health/live', async response => {
    if ((await response.json()).status !== 'alive') throw new Error('API is not alive');
  }),
  check('database readiness', api + '/health/ready', async response => {
    if (!(await response.json()).ready) throw new Error('Database is not ready');
  }),
  check('auth configuration and CORS', api + '/api/auth/config', async response => {
    const config = await response.json();
    if (typeof config.registration !== 'boolean') throw new Error('Auth configuration missing');
    if (response.headers.get('access-control-allow-origin') !== frontend) throw new Error('Frontend origin is missing from CORS_ORIGINS');
  }, { headers: { Origin: frontend } }),
  check('model and benchmark reference', api + '/api/benchmark/reference', async response => {
    const reference = await response.json();
    if (!reference.model?.sha256 || !reference.dataset?.rows || !reference.confusion_matrix) throw new Error('Model or benchmark reference unavailable');
  }),
]);
console.log(`${failures ? 'FAILED' : 'PASSED'}: public deployment checks. Authentication, provider OAuth, and live collector flows require separate verification.`);
process.exitCode = failures ? 1 : 0;
