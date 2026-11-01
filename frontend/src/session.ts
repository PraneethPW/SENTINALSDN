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
