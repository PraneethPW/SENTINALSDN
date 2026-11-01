import { useCallback, useEffect, useRef, useState } from "react";
import { API, ApiError, request } from "./api";
import type { Snapshot, User } from "./api";

import { readSession, writeSession, endSession } from "./session";
function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<Snapshot>;
  return (
    typeof d.timestamp === "string" &&
    Number.isFinite(Date.parse(d.timestamp)) &&
    Array.isArray(d.flows) &&
    Array.isArray(d.collectors) &&
    Array.isArray(d.incidents) &&
    Array.isArray(d.commands) &&
    Array.isArray(d.series) &&
    !!d.summary &&
    !!d.model &&
    !!d.integrations
  );
}
export function useNetwork(minutes: number) {
  const [token, setToken] = useState<string | null>(() => readSession());
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<
    "signed-out" | "connecting" | "live" | "reconnecting" | "error"
  >("signed-out");
  const [error, setError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const logoutStarted = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  const logout = useCallback(async () => {
    if (logoutStarted.current) return;
    logoutStarted.current = true;
    setSigningOut(true);
    await endSession(token);
    setToken(null);
    setUser(null);
    setData(null);
    setError("");
    socketRef.current?.close();
    setConnection("signed-out");
    setSigningOut(false);
  }, [token]);
  const login = async (email: string, password: string) => {
    const result = await request<{ token: string; user: User }>(
      "/api/auth/login",
      null,
      { method: "POST", body: JSON.stringify({ email, password }) },
    );
    logoutStarted.current = false;
    writeSession(result.token);
    setUser(result.user);
    setToken(result.token);
  };
  useEffect(() => {
    if (!token) return;
    let active = true,
      attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setConnection("connecting");
    setError("");
    async function connect() {
      if (!active || logoutStarted.current) return;
      try {
        const [me, snapshot, ticket] = await Promise.all([
          request<User>("/api/auth/me", token, { signal: controller.signal }),
          request<Snapshot>(`/api/snapshot?minutes=${minutes}`, token, {
            signal: controller.signal,
          }),
          request<{ ticket: string }>("/api/auth/ws-ticket", token, {
            method: "POST",
            signal: controller.signal,
          }),
        ]);
        if (!active || logoutStarted.current) return;
        setUser(me);
        setData(snapshot);
        const url = new URL(`${API}/api/live`, window.location.origin);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("ticket", ticket.ticket);
        url.searchParams.set("minutes", String(minutes));
        const socket = new WebSocket(url);
        socketRef.current = socket;
        const markStale = () => {
          clearTimeout(staleTimer);
          staleTimer = setTimeout(() => {
            if (active && !logoutStarted.current) {
              setConnection("reconnecting");
              setError("Stream interrupted. Reconnecting…");
              socket.close();
            }
          }, 15000);
        };
        socket.onopen = markStale;
        socket.onmessage = (event) => {
          if (!active || logoutStarted.current) return;
          try {
            const incoming: unknown = JSON.parse(event.data);
            if (!validSnapshot(incoming))
              throw new Error("Invalid snapshot schema");
            setData((previous) =>
              !previous || incoming.timestamp >= previous.timestamp
                ? incoming
                : previous,
            );
            setConnection("live");
            setError("");
            attempts = 0;
            markStale();
          } catch {
            setError("Invalid live update received");
            socket.close();
          }
        };
        socket.onclose = (event) => {
          clearTimeout(staleTimer);
          if (!active || logoutStarted.current) return;
          if (event.code === 4401) {
            logout();
            return;
          }
          retry();
        };
        socket.onerror = () => socket.close();
      } catch (reason) {
        if (!active || logoutStarted.current) return;
        if (reason instanceof ApiError && reason.status === 401) {
          logout();
          return;
        }
        setError(
          reason instanceof Error ? reason.message : "Unable to reach backend",
        );
        retry();
      }
    }
    function retry() {
      if (logoutStarted.current) return;
      setConnection("reconnecting");
      attempts += 1;
      timer = setTimeout(
        connect,
        Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)) +
          Math.random() * 500,
      );
    }
    void connect();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      clearTimeout(staleTimer);
      socketRef.current?.close();
    };
  }, [token, minutes, logout]);
  const labId =
    data?.workspace?.lab?.run?.desired_state === "running"
      ? data.workspace.lab.run.id
      : null;
  useEffect(() => {
    if (!token || !labId) return;
    const controller = new AbortController();
    const keepAlive = () => {
      if (document.visibilityState !== "visible" || logoutStarted.current)
        return;
      void request("/api/workspace/lab/presence", token, {
        method: "POST",
        body: JSON.stringify({ lab_id: labId }),
        signal: controller.signal,
      }).catch(() => {});
    };
    keepAlive();
    const interval = setInterval(keepAlive, 60000);
    document.addEventListener("visibilitychange", keepAlive);
    return () => {
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", keepAlive);
    };
  }, [token, labId]);
  const refresh = async () => {
    if (token)
      setData(
        await request<Snapshot>(`/api/snapshot?minutes=${minutes}`, token),
      );
  };
  return {
    token,
    user,
    data,
    connection,
    error,
    login,
    logout,
    refresh,
    signingOut,
  };
}
