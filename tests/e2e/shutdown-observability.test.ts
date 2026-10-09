import { describe, expect, it } from "vitest";
import { assertStoredProcessIdentityAbsent, getRemoteDebuggingPort, isSameProcessIdentity, mergeProcessObservations, selectOwnedProcessDescendants, type ProcessIdentity, type TauriAppProcessInfo } from "./shutdown-observability";
import { buildNativeCloseScript } from "./native-close";

const identity = (overrides: Partial<ProcessIdentity> = {}): ProcessIdentity => ({
  creationTime: "2026-05-12T10:00:00.000Z",
  executablePath: "C:\\build\\kurone-ko.exe",
  name: "kurone-ko.exe",
  parentPid: 100,
  pid: 200,
  ...overrides,
});

describe("native close PowerShell script", () => {
  const processInfo: TauriAppProcessInfo = {
    launcherCreationTime: "2026-05-12T10:00:00.000Z",
    launcherPath: "C:\\node.exe",
    launcherPid: 100,
    appCreationTime: "2026-05-12T10:01:00.000Z",
    appName: "kurone-ko.exe",
    appPath: "C:\\build\\kurone-ko.exe",
    appPid: 200,
  };

  it("embeds the expected window identity as PowerShell string values", () => {
    const script = buildNativeCloseScript(processInfo);

    expect(script).toContain("$expectedClass = 'Tauri Window'");
    expect(script).toContain("$expectedTitle = 'KURONE-KO'");
    expect(script).not.toContain("$expectedClass = ${quote(KURONE_KO_WINDOW_CLASS)}");
  });

  it("sends WM_CLOSE to the verified HWND after rechecking app and window ownership", () => {
    const script = buildNativeCloseScript(processInfo);

    expect(script).toContain("$ErrorActionPreference = 'Stop'");
    expect(script).toContain("$windows[0].Window");
    expect(script).toContain("$owned = Get-CimInstance Win32_Process");
    expect(script).toContain("GetWindowThreadProcessId($targetWindow");
    expect(script).toContain("-eq $PidToClose");
    expect(script).toContain("$ExpectedCreationTime");
    expect(script).toContain("$ExpectedPath");
    expect(script.indexOf("app process identity changed before delivery")).toBeLessThan(script.indexOf("GetWindowThreadProcessId($targetWindow"));
    expect(script.indexOf("selected HWND identity changed before delivery")).toBeLessThan(script.indexOf("SendMessageTimeout($windows[0].Window"));
  });
});

describe("CDP remote debugging port", () => {
  it("uses the configured localhost endpoint port", () => {
    expect(getRemoteDebuggingPort("http://127.0.0.1:9333")).toBe(9333);
    expect(getRemoteDebuggingPort("http://localhost:9444")).toBe(9444);
  });

  it("retains port 9222 when the endpoint omits a port", () => {
    expect(getRemoteDebuggingPort("http://127.0.0.1")).toBe(9222);
  });

  it.each([
    "https://example.com:9333",
    "http://0.0.0.0:9333",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "not a URL",
  ])("rejects unsafe or invalid CDP endpoint %s", (endpoint) => {
    expect(() => getRemoteDebuggingPort(endpoint)).toThrow();
  });
});

describe("shutdown process identity", () => {
  it("accepts a truly absent stored PID during cleanup", () => {
    expect(() => assertStoredProcessIdentityAbsent(identity(), null)).not.toThrow();
  });

  it("refuses cleanup when the stored identity is still present", () => {
    expect(() => assertStoredProcessIdentityAbsent(identity(), identity())).toThrow("stored process PID 200 is still present");
  });

  it("refuses cleanup when a stored PID now belongs to a different identity", () => {
    expect(() => assertStoredProcessIdentityAbsent(identity(), identity({ creationTime: "2026-05-12T10:01:00.000Z" }))).toThrow("different process identity");
  });

  it("rejects PID reuse when creation time differs", () => {
    expect(isSameProcessIdentity(identity(), identity({ creationTime: "2026-05-12T10:01:00.000Z" }))).toBe(false);
  });

  it("requires matching executable paths when both are available", () => {
    expect(isSameProcessIdentity(identity(), identity({ executablePath: "C:\\other\\kurone-ko.exe" }))).toBe(false);
  });

  it("retains app-scoped descendants observed across successive snapshots", () => {
    const first = [identity({ pid: 201, parentPid: 200, name: "WebView2.exe" })];
    const second = [identity({ pid: 202, parentPid: 201, name: "audio-helper.exe" })];

    expect(mergeProcessObservations(first, second)).toEqual([...first, ...second]);
  });

  it("selects descendants from the stored app identity rather than launcher ancestry", () => {
    const app = identity({ pid: 200, parentPid: 100 });
    const webview = identity({ pid: 201, parentPid: 200, name: "msedgewebview2.exe" });

    expect(selectOwnedProcessDescendants(app, [app, webview])).toEqual([webview]);
  });

  it("refuses a process tree whose root no longer matches the stored identity", () => {
    const app = identity({ pid: 200 });
    const reusedPid = identity({ pid: 200, creationTime: "2026-05-12T10:01:00.000Z" });

    expect(() => selectOwnedProcessDescendants(app, [reusedPid])).toThrow("does not contain the expected root");
  });

  it("excludes unrelated entries that are not reachable from the verified root", () => {
    const app = identity({ pid: 200, parentPid: 100 });
    const child = identity({ pid: 201, parentPid: 200 });
    const unrelated = identity({ pid: 300, parentPid: 999 });

    expect(selectOwnedProcessDescendants(app, [app, child, unrelated])).toEqual([child]);
  });

  it("rejects a root whose executable identity is unavailable or different", () => {
    const app = identity({ pid: 200, parentPid: 100 });

    expect(() => selectOwnedProcessDescendants(app, [identity({ pid: 200, parentPid: 100, executablePath: null })])).toThrow("does not contain the expected root");
    expect(() => selectOwnedProcessDescendants(app, [identity({ pid: 200, parentPid: 100, name: "other.exe" })])).toThrow("does not contain the expected root");
  });

  it("fails closed when a child predates its parent despite a reused parent PID", () => {
    const app = identity({ pid: 200, parentPid: 100, creationTime: "2026-05-12T10:00:00.000Z" });
    const child = identity({ pid: 201, parentPid: 200, creationTime: "2026-05-12T09:59:59.000Z" });

    expect(() => selectOwnedProcessDescendants(app, [app, child])).toThrow("creation time predates its parent");
  });

  it("includes only reachable nested descendants with valid creation-time ancestry", () => {
    const app = identity({ pid: 200, parentPid: 100, creationTime: "2026-05-12T10:00:00.000Z" });
    const child = identity({ pid: 201, parentPid: 200, creationTime: "2026-05-12T10:00:01.000Z" });
    const grandchild = identity({ pid: 202, parentPid: 201, creationTime: "2026-05-12T10:00:02.000Z" });
    const unrelated = identity({ pid: 300, parentPid: 100, creationTime: "2026-05-12T10:00:03.000Z" });

    expect(selectOwnedProcessDescendants(app, [app, grandchild, unrelated, child])).toEqual([child, grandchild]);
  });
});
