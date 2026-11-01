import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ManagedLabPanel from "../components/ManagedLabPanel";
import type { Snapshot, ManagedLab } from "../api";
const lab: ManagedLab = {
  run: null,
  host: {
    enabled: true,
    online: true,
    ready: true,
    capacity: 2,
    available_slots: 2,
    can_start: true,
    reason: "ready",
  },
  limits: { session_minutes: 60, idle_minutes: 15 },
};
const user = { id: "owner", email: "owner@test.local", role: "admin" as const };
const props = (value = lab) => ({
  token: "test-token",
  user,
  data: { workspace: { lab: value }, collectors: [] } as unknown as Snapshot,
  refresh: vi.fn().mockResolvedValue(undefined),
});
afterEach(() => vi.unstubAllGlobals());
describe("one click real lab", () => {
  it("requests a lab and refreshes actual server state", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const p = props();
    render(<ManagedLabPanel {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Start my live lab" }));
    await waitFor(() => expect(p.refresh).toHaveBeenCalledOnce());
    expect(fetch.mock.calls[0][0]).toContain("/api/workspace/lab/start");
    expect(screen.getByText("A real network. One click away.")).toBeTruthy();
  });
  it("keeps startup unavailable when the host is offline", () => {
    render(
      <ManagedLabPanel
        {...props({
          ...lab,
          host: { ...lab.host, online: false, ready: false, can_start: false },
        })}
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Start my live lab",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText(/research host is offline/)).toBeTruthy();
  });
  it("shows actual failure without creating fake progress", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: "All slots are in use" }), {
            status: 409,
          }),
        ),
    );
    render(<ManagedLabPanel {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Start my live lab" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "All slots are in use",
    );
    expect(screen.queryByRole("button", { name: "Stop lab" })).toBeNull();
  });
  it("does not offer lifecycle actions to viewers", () => {
    render(<ManagedLabPanel {...props()} user={{ ...user, role: "viewer" }} />);
    expect(
      screen.queryByRole("button", { name: "Start my live lab" }),
    ).toBeNull();
  });
});
