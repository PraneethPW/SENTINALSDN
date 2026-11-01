import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  WorkspaceControls,
  FlowHistory,
} from "../components/WorkspaceControls";
import { Topology, TrafficChart } from "../components/Charts";
import { request } from "../api";
import type { Snapshot } from "../api";
vi.mock("../api", async () => {
  const actual = await vi.importActual("../api");
  return { ...actual, request: vi.fn() };
});
const get = vi.mocked(request);
beforeEach(() => get.mockReset());
const viewer = {
  id: "v",
  email: "viewer@example.test",
  role: "viewer" as const,
};
describe("workspace access", () => {
  it("keeps account mutation controls out of viewer workflows", async () => {
    get.mockResolvedValue([]);
    render(
      <WorkspaceControls
        token="test-only"
        user={viewer}
        revision="1"
        onLogout={() => {}}
      />,
    );
    expect(screen.queryByText("Create account")).toBeNull();
    expect(screen.getByText("Change your password")).toBeTruthy();
  });
  it("shows server rejection instead of claiming account creation", async () => {
    get.mockImplementation((path, _token, options) =>
      path === "/api/users" && options?.method === "POST"
        ? Promise.reject(new Error("An account with this email already exists"))
        : Promise.resolve(path === "/api/users" ? [] : { google: false }),
    );
    render(
      <WorkspaceControls
        token="test-only"
        user={{ ...viewer, role: "admin" }}
        revision="1"
        onLogout={() => {}}
      />,
    );
    await screen.findByText("Create account");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "existing@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Initial password"), {
      target: { value: "Private-test-password!" },
    });
    fireEvent.click(screen.getByText("Create account"));
    await screen.findByText("An account with this email already exists");
  });
  it("searches server-side history and appends the next cursor without losing rows", async () => {
    const row = {
      id: 10,
      source_ip: "192.0.2.1",
      destination_ip: "192.0.2.2",
      observed_at: "2026-11-01T00:00:00Z",
      protocol: 17,
      packet_rate: 3,
      prediction: "benign",
    };
    get
      .mockResolvedValueOnce({ items: [row], next_cursor: 10 })
      .mockResolvedValueOnce({
        items: [{ ...row, id: 9, source_ip: "192.0.2.3" }],
        next_cursor: null,
      });
    render(<FlowHistory token="test-only" />);
    fireEvent.change(screen.getByLabelText("Search historical flows"), {
      target: { value: "192.0.2" },
    });
    fireEvent.click(screen.getByText("Search history"));
    await screen.findByText("Load older measurements");
    fireEvent.click(screen.getByText("Load older measurements"));
    await screen.findByText("192.0.2.3 → 192.0.2.2");
    expect(get.mock.calls.at(-1)?.[0]).toContain("cursor=10");
  });
  it("requires a fresh search after editing filters instead of reusing an old cursor", async () => {
    get.mockResolvedValueOnce({ items: [], next_cursor: 40 });
    render(<FlowHistory token="test-only" />);
    fireEvent.click(screen.getByText("Search history"));
    await screen.findByText("Load older measurements");
    fireEvent.change(screen.getByLabelText("Search historical flows"), {
      target: { value: "another-network" },
    });
    expect(screen.queryByText("Load older measurements")).toBeNull();
  });
});
const snapshot = {
  timestamp: "2026-11-01T00:00:00Z",
  collectors: [
    {
      id: "test",
      switches: ["1", "2"],
      online: true,
      controller_status: "connected",
      last_seen: "2026-11-01T00:00:00Z",
      topology: {
        available: true,
        hosts: [
          {
            mac: "00:00:00:00:00:01",
            addresses: ["192.0.2.1"],
            switch_id: "1",
            port: 3,
          },
        ],
        links: [
          { source: "1", target: "2", source_port: 1, target_port: 2 },
          { source: "2", target: "1", source_port: 2, target_port: 1 },
        ],
        ports: [
          {
            switch_id: "1",
            port: 3,
            rx_bytes: 100,
            tx_bytes: 200,
            rx_dropped: 0,
            tx_dropped: 0,
            rx_errors: 0,
            tx_errors: 0,
          },
        ],
      },
    },
  ],
} as unknown as Snapshot;
describe("measured visualizations", () => {
  it("deduplicates bidirectional discovery and supports explicit port inspection", () => {
    render(<Topology data={snapshot} large />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "1 discovered links",
    );
    fireEvent.click(screen.getByRole("button", { name: "Inspect switch 1" }));
    expect(screen.getByText("100 B")).toBeTruthy();
    expect(screen.getByText("192.0.2.1")).toBeTruthy();
  });
  it("does not present an empty chart as zero-valued invented samples", () => {
    render(<TrafficChart data={null} />);
    expect(screen.getByText("Listening for your first flow")).toBeTruthy();
  });
});
