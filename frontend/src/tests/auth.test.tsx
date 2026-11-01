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
