import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import NetworkSetup from "../components/NetworkSetup";
import type { Snapshot, User } from "../api";

const data = {
  workspace: {
    id: "own-workspace",
    name: "My network",
    kind: "private",
    has_measurements: false,
    collector_key: null,
  },
  collectors: [],
  summary: { last_flow: null },
} as unknown as Snapshot;
const user: User = { id: "owner", email: "owner@example.test", role: "admin" };

describe("private network onboarding", () => {
  it("starts with explicit empty measurements and actionable collector setup", () => {
    render(
      <NetworkSetup
        token="isolated-test-token"
        user={user}
        data={data}
        refresh={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Your workspace is ready." }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Download collector setup",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      screen.getByText("No collector has connected to this workspace."),
    ).toBeTruthy();
    expect(
      screen.getByText(/does not capture your normal computer traffic/),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Workspace name") as HTMLInputElement).value,
    ).toBe("My network");
  });
  it("prevents a second credential from silently replacing an active collector", () => {
    const configured = {
      ...data,
      workspace: {
        ...data.workspace!,
        collector_key: {
          id: "key",
          prefix: "snc_test",
          created_at: "2026-11-01T00:00:00Z",
          last_used_at: null,
        },
      },
    };
    render(
      <NetworkSetup
        token="isolated-test-token"
        user={user}
        data={configured}
        refresh={vi.fn()}
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Setup key already created",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Revoke collector key" }),
    ).toBeTruthy();
  });
  it("lets viewers inspect status without changing workspace or credentials", () => {
    render(
      <NetworkSetup
        token="isolated-test-token"
        user={{ ...user, role: "viewer" }}
        data={data}
        refresh={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Download collector setup" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Workspace name")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Check connection" }),
    ).toBeTruthy();
  });
});
