import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AuthPortal from "../AuthPortal";
import { request } from "../api";
vi.mock("../api", async () => ({
  ...(await vi.importActual("../api")),
  request: vi.fn(),
}));
const call = vi.mocked(request);
beforeEach(() => {
  call.mockReset();
  call.mockResolvedValue({ registration: true, google: false });
});
describe("public account entry", () => {
  it("offers working email entry while clearly disabling an unconfigured Google provider", async () => {
    render(<AuthPortal register />);
    const button = await screen.findByText(
      "Google sign-in is awaiting setup. Email access is available below.",
    );
    expect(button).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Continue with Google",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe("/auth/sign-in");
  });
  it("runs the benchmark from sign-in and displays evidence beside the form", async () => {
    call.mockImplementation((url) =>
      Promise.resolve(
        url === "/api/benchmark/run"
          ? {
              id: "run",
              completed_at: "2026-11-14T12:00:00Z",
              inference_ms: 12,
              model: { algorithm: "Extra Trees", threshold: 0.525, version: "test" },
              dataset: {
                kind: "public", rows: 1, groups: 1, split: "test",
                source: { authors: [], url: "https://example.test", title: "Test dataset" },
              },
              windows: [[42, 1, 0.48, 30, 512, 17, 30, 6]],
            }
          : { registration: true, google: false },
      ),
    );
    render(<AuthPortal />);

    fireEvent.click(screen.getByRole("button", { name: "Run benchmark" }));

    await screen.findByRole("heading", { name: "Benchmark results" });
    expect(call).toHaveBeenCalledWith("/api/benchmark/run", null, { method: "POST" });
    expect(screen.getByRole("button", { name: /^Sign in$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "False negative 1 Attack missed" })).toBeTruthy();
  });

  it("rejects password confirmation mismatches before creating an account", async () => {
    render(<AuthPortal register />);
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Local Investigator" },
    });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "local@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
      target: { value: "A-long-private-passphrase!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "A-different-passphrase!" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Create account" }).closest("form")!,
    );
    await screen.findByText("Your passwords do not match.");
    expect(call.mock.calls.some((x) => x[0] === "/api/auth/register")).toBe(
      false,
    );
  });
  it("keeps server rejection visible and allows retry", async () => {
    call.mockImplementation((path) =>
      path === "/api/auth/register"
        ? Promise.reject(
            new Error("An account already uses this email. Sign in instead."),
          )
        : Promise.resolve({ registration: true, google: true }),
    );
    render(<AuthPortal register />);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "existing@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
      target: { value: "A-long-private-passphrase!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "A-long-private-passphrase!" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Create account" }).closest("form")!,
    );
    await screen.findByText(
      "An account already uses this email. Sign in instead.",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Create account",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
  it("toggles password visibility without changing its value", () => {
    render(<AuthPortal />);
    const input = screen.getByLabelText("Password", {
      exact: true,
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Private-passphrase!" } });
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    expect(input.value).toBe("Private-passphrase!");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input.type).toBe("password");
  });
});
