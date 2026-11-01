import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { request, protocolName, compact, time } from "../api";
import type { User, Flow } from "../api";
import { beginGoogle } from "../AuthPortal";
type Account = User & { active: boolean; approved?: boolean };
export function WorkspaceControls({
  token,
  user,
  revision,
  onLogout,
}: {
  token: string;
  user: User;
  revision: string;
  onLogout: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [role, setRole] = useState<User["role"]>("viewer"),
    [current, setCurrent] = useState(""),
    [next, setNext] = useState("");
  useEffect(() => {
    let active = true;
    void request<Account[]>("/api/users", token)
      .then((x) => {
        if (active) setAccounts(x);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [token, revision]);
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await request("/api/users", token, {
        method: "POST",
        body: JSON.stringify({ email, password, role }),
      });
      setPassword("");
      setEmail("");
      setAccounts(await request("/api/users", token));
      setMessage("Account created. Share credentials privately.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Creation failed");
    } finally {
      setBusy(false);
    }
  }
  async function change(a: Account, update: Partial<Account>) {
    setBusy(true);
    try {
      await request(`/api/users/${a.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ role: a.role, active: a.active, ...update }),
      });
      if (a.id === user.id) {
        onLogout();
        return;
      }
      setAccounts(await request("/api/users", token));
      setMessage("Account updated and existing sessions revoked.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }
  async function secure(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await request("/api/auth/password", token, {
        method: "POST",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      onLogout();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel section-gap operations-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">WORKSPACE ACCESS</span>
          <h2>Accounts & security</h2>
        </div>
        <span className="badge">{user.role}</span>
      </div>
      {message ? (
        <p className="operation-message" role="status">
          {message}
        </p>
      ) : null}
      {user.role === "admin" ? (
        <>
          <form onSubmit={create} className="access-form">
            <label>
              Email
              <input
                className="form-input"
                type="email"
                autoComplete="off"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Initial password
              <input
                className="form-input"
                type="password"
                autoComplete="new-password"
                required
                minLength={14}
                maxLength={256}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              Role
              <select
                className="form-input"
                value={role}
                onChange={(e) => setRole(e.target.value as User["role"])}
              >
                <option value="viewer">Viewer — read only</option>
                <option value="operator">Operator — investigations</option>
                <option value="admin">Administrator</option>
              </select>
            </label>
            <button className="button primary" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={16} /> : null}Create
              account
            </button>
          </form>
          <p className="footnote">
            Minimum 14-character passwords. The final active administrator is
            protected.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Role</th>
                  <th>Workspace approval</th>
                  <th>Access</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.email}
                      {a.id === user.id ? " · you" : ""}
                    </td>
                    <td>
                      <select
                        aria-label={`Role for ${a.email}`}
                        value={a.role}
                        disabled={busy}
                        onChange={(e) =>
                          void change(a, {
                            role: e.target.value as User["role"],
                          })
                        }
                      >
                        <option>viewer</option>
                        <option>operator</option>
                        <option>admin</option>
                      </select>
                    </td>
                    <td>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void change(a, { approved: a.approved === false })
                        }
                      >
                        {a.approved === false
                          ? "Approve access"
                          : "Revoke approval"}
                      </button>
                    </td>
                    <td>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void change(a, { active: !a.active })}
                      >
                        {a.active ? "Disable account" : "Enable account"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      <GoogleConnection token={token} />
      {user.password_enabled !== false ? (
        <details className="password-details">
          <summary>Change your password</summary>
          <form onSubmit={secure} className="access-form">
            <label>
              Current password
              <input
                className="form-input"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
            <label>
              New password
              <input
                className="form-input"
                type="password"
                autoComplete="new-password"
                required
                minLength={14}
                maxLength={256}
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </label>
            <button className="button secondary" disabled={busy}>
              Update and sign out
            </button>
          </form>
        </details>
      ) : null}
    </section>
  );
}
export function FlowHistory({ token }: { token: string }) {
  const [rows, setRows] = useState<Flow[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [query, setQuery] = useState(""),
    [range, setRange] = useState(1440),
    [verdict, setVerdict] = useState("all"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load(append = false) {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({
        minutes: String(range),
        search: query,
        verdict,
        limit: "50",
      });
      if (append && cursor) params.set("cursor", String(cursor));
      const result = await request<{
        items: Flow[];
        next_cursor: number | null;
      }>(`/api/flows?${params}`, token);
      setRows((prev) => (append ? [...prev, ...result.items] : result.items));
      setCursor(result.next_cursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "History unavailable");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel section-gap operations-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PERSISTED EVIDENCE</span>
          <h2>Flow history</h2>
        </div>
      </div>
      <p className="footnote">
        Search stored measurements independently of live updates. Results stay
        still while you investigate.
      </p>
      <form
        className="history-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <input
          className="form-input"
          aria-label="Search historical flows"
          placeholder="Source, destination or switch"
          maxLength={100}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(null);
          }}
        />
        <select
          aria-label="Historical time range"
          value={range}
          onChange={(e) => {
            setRange(Number(e.target.value));
            setCursor(null);
          }}
        >
          <option value={60}>Last hour</option>
          <option value={1440}>Last 24 hours</option>
          <option value={10080}>Last 7 days</option>
        </select>
        <select
          aria-label="Historical verdict"
          value={verdict}
          onChange={(e) => {
            setVerdict(e.target.value);
            setCursor(null);
          }}
        >
          <option value="all">All verdicts</option>
          <option value="benign">Benign</option>
          <option value="attack">Attack</option>
          <option value="unclassified">Unclassified</option>
        </select>
        <button className="button secondary" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={16} /> : null}Search
          history
        </button>
      </form>
      {error ? (
        <p role="alert" className="operation-message">
          {error}
        </p>
      ) : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Observed</th>
              <th>Source → destination</th>
              <th>Protocol</th>
              <th>Packet rate</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <td>
                  {new Date(f.observed_at).toLocaleDateString()}{" "}
                  {time(f.observed_at)}
                </td>
                <td className="mono">
                  {f.source_ip} → {f.destination_ip}
                </td>
                <td>{protocolName(f.protocol)}</td>
                <td>{compact(f.packet_rate, "pps")}</td>
                <td>{f.prediction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && !busy ? (
        <p className="footnote">
          Run a search to retrieve actual stored flow windows.
        </p>
      ) : null}
      {cursor ? (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void load(true)}
        >
          Load older measurements
        </button>
      ) : null}
    </section>
  );
}

function GoogleConnection({ token }: { token: string }) {
  const [linked, setLinked] = useState(false),
    [enabled, setEnabled] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([
      request<{ google: boolean }>("/api/auth/connections", token),
      request<{ google: boolean }>("/api/auth/config"),
    ])
      .then(([connection, config]) => {
        if (active) {
          setLinked(connection.google);
          setEnabled(config.google);
          setReady(true);
        }
      })
      .catch(() => {
        if (active) setError("Unable to check Google connection.");
      });
    return () => {
      active = false;
    };
  }, [token]);
  async function connect() {
    setBusy(true);
    try {
      const result = await request<{ ticket: string }>(
        "/api/auth/google/link-ticket",
        token,
        { method: "POST" },
      );
      await beginGoogle(result.ticket);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google connection failed");
      setBusy(false);
    }
  }
  return (
    <div className="google-connection">
      <div>
        <strong>Google sign-in</strong>
        <p className="footnote">
          {!ready
            ? "Checking Google connection…"
            : linked
              ? "Connected to this account."
              : enabled
                ? "Connect the Google account with the same email as your Sentinel account."
                : "Google provider setup is pending."}
        </p>
      </div>
      <button
        className="button secondary"
        disabled={!ready || !enabled || linked || busy}
        onClick={() => void connect()}
      >
        {linked
          ? "Google connected"
          : busy
            ? "Opening Google…"
            : "Connect Google"}
      </button>
      {error ? (
        <p role="alert" className="operation-message">
          {error}
        </p>
      ) : null}
    </div>
  );
}
