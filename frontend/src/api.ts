export const API = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
export type User = {
  id: string;
  workspace_id?: string;
  email: string;
  approved?: boolean;
  display_name?: string;
  password_enabled?: boolean;
  role: "admin" | "operator" | "viewer";
};
export type Flow = {
  id: number;
  collector_id?: string;
  observed_at: string;
  switch_id: string;
  source_ip: string;
  destination_ip: string;
  protocol: number;
  destination_port: number | null;
  packets: number;
  bytes: number;
  packet_rate: number;
  byte_rate: number;
  prediction: string;
  attack_probability: number | null;
};
export type Incident = {
  id: string;
  collector_id: string;
  switch_id: string;
  source_ip: string;
  destination_ip: string;
  protocol: number;
  destination_port: number | null;
  first_seen: string;
  last_seen: string;
  probability: number;
  packets: number;
  bytes: number;
  model_version: string;
  status: "open" | "acknowledged" | "resolved";
  revision: number;
  assignee_id: string | null;
  notes: string;
};
export type Command = {
  id: string;
  incident_id: string;
  kind: string;
  status: string;
  expires_at: string | null;
  detail: string | null;
};
export type Collector = {
  lab_run_id?: string | null;
  source_type?: "sdn_controller" | "isolated_lab";
  id: string;
  last_seen: string;
  switches: string[];
  controller_status: string;
  online: boolean;
  version: string;
  topology?: {
    available: boolean;
    links: {
      source: string;
      target: string;
      source_port: number;
      target_port: number;
    }[];
    hosts: {
      mac: string;
      addresses: string[];
      switch_id: string;
      port: number;
    }[];
    ports: {
      switch_id: string;
      port: number;
      rx_bytes: number;
      tx_bytes: number;
      rx_dropped: number;
      tx_dropped: number;
      rx_errors: number;
      tx_errors: number;
    }[];
  };
};
export type Model = {
  ready: boolean;
  error: string | null;
  threshold: number;
  features: string[];
  metadata: null | {
    version: string;
    algorithm: string;
    rows: number;
    test_rows: number;
    trained_at: string;
    roc_auc: number;
    average_precision: number;
    feature_importance: Record<string, number>;
    classification_report: Record<
      string,
      { precision: number; recall: number; "f1-score": number }
    >;
    cross_validation?: { precision: number; recall: number; fpr: number }[];
    limitations: string;
  };
};
export type ManagedLab = {
  run: null | {
    id: string;
    collector_id: string;
    desired_state: "running" | "stopped";
    state:
      | "queued"
      | "starting"
      | "awaiting_controller"
      | "awaiting_flows"
      | "running"
      | "stopping"
      | "stopped"
      | "failed"
      | "expired";
    revision: number;
    message: string;
    created_at: string;
    expires_at: string;
    idle_expires_at: string;
    started_at: string | null;
    controller_seen_at: string | null;
    first_flow_at: string | null;
    stopped_at: string | null;
    cleanup_pending: boolean;
  };
  host: {
    enabled: boolean;
    online: boolean;
    ready: boolean;
    capacity: number;
    available_slots: number;
    can_start: boolean;
    reason: string;
  };
  limits: { session_minutes: number; idle_minutes: number };
};
export type Snapshot = {
  workspace?: {
    id: string;
    name: string;
    kind: "private" | "research_lab";
    created_at: string;
    has_measurements: boolean;
    lab?: ManagedLab;
    collector_key: null | {
      id: string;
      prefix: string;
      created_at: string;
      last_used_at: string | null;
    };
  };
  revision?: string;
  reports?: {
    id: string;
    incident_id: string;
    status: string;
    content: string;
    model: string;
    created_at: string;
  }[];
  timestamp: string;
  window_minutes: number;
  summary: {
    open_incidents?: number;
    windows: number;
    packets: number;
    bytes: number;
    attack_windows: number;
    unclassified_windows: number;
    bits_per_second: number;
    packets_per_second: number;
    last_flow: string | null;
  };
  collectors: Collector[];
  flows: Flow[];
  incidents: Incident[];
  commands: Command[];
  series: { time: string; bps: number; pps: number; attack_bps: number }[];
  protocols: { protocol: number; bytes: number; packets: number }[];
  audit: {
    id: number;
    actor: string;
    action: string;
    resource: string;
    created_at: string;
  }[];
  model: Model;
  integrations: { database: boolean; ai: boolean; mitigation: boolean };
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function request<T>(
  path: string,
  token?: string | null,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(55000),
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      typeof data.detail === "string"
        ? data.detail
        : Array.isArray(data.detail)
          ? data.detail
              .slice(0, 3)
              .map((item: { msg?: string }) =>
                typeof item.msg === "string"
                  ? item.msg.replace(/^Value error, /, "")
                  : "Invalid input",
              )
              .join(". ")
          : `Request failed (${response.status})`,
    );
  return data as T;
}

export const protocolName = (id: number) =>
  ({ 1: "ICMP", 6: "TCP", 17: "UDP" })[id] ?? String(id);
export function compact(n: number, unit = "") {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} G${unit}`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M${unit}`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} K${unit}`;
  return `${Math.round(n)}${unit ? ` ${unit}` : ""}`;
}
export const time = (date: string) =>
  new Date(date).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
