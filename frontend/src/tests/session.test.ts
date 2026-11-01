import { beforeEach, expect, it, vi } from "vitest";
import { request } from "../api";
import { endSession, readSession, writeSession } from "../session";

vi.mock("../api", async () => ({
  ...(await vi.importActual("../api")),
  request: vi.fn(),
}));
const call = vi.mocked(request);
beforeEach(() => {
  call.mockReset();
});

it("finishes server revocation before publishing the navigation-triggering session event", async () => {
  let finish!: (value: unknown) => void;
  call.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  writeSession("isolated-session-test");
  const changed = vi.fn();
  window.addEventListener("sentinel:session", changed);
  const pending = endSession("isolated-session-test");
  expect(readSession()).toBe("isolated-session-test");
  expect(changed).not.toHaveBeenCalled();
  finish({ ok: true });
  await pending;
  expect(readSession()).toBeNull();
  expect(changed).toHaveBeenCalledOnce();
  expect(call).toHaveBeenCalledWith(
    "/api/auth/logout",
    "isolated-session-test",
    expect.objectContaining({ method: "POST", keepalive: true }),
  );
  window.removeEventListener("sentinel:session", changed);
});

it("still signs the device out when the server cannot be reached", async () => {
  call.mockRejectedValue(new Error("network offline"));
  writeSession("isolated-session-test");
  await endSession("isolated-session-test");
  expect(readSession()).toBeNull();
});
