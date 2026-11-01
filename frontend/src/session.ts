import { request } from "./api";

export const SESSION_KEY = "sentinel.session.v1";
export function readSession() {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
export function writeSession(token: string | null) {
  let stored = true;
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    stored = false;
  }
  window.dispatchEvent(new Event("sentinel:session"));
  return stored;
}

export async function endSession(token: string | null) {
  try {
    if (token)
      await request("/api/auth/logout", token, {
        method: "POST",
        keepalive: true,
        signal: AbortSignal.timeout(5000),
      });
  } catch {
    // A disconnected device must still be able to clear its local session.
  } finally {
    // Navigation listeners run only after the revocation attempt finishes.
    writeSession(null);
  }
}
