import { spawn } from "node:child_process";
import type { TauriAppProcessInfo } from "./shutdown-observability";

const KURONE_KO_WINDOW_CLASS = "Tauri Window";
const KURONE_KO_WINDOW_TITLE = "KURONE-KO";

export const isKuroneKoAppWindow = (className: string, title: string): boolean =>
  className === KURONE_KO_WINDOW_CLASS && title === KURONE_KO_WINDOW_TITLE;

export const buildNativeCloseScript = (processInfo: TauriAppProcessInfo): string => {
  const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

  return [
    "$ErrorActionPreference = 'Stop'",
    `$PidToClose = ${processInfo.appPid}`,
    `$ExpectedPath = ${quote(processInfo.appPath)}`,
    `$ExpectedCreationTime = ${quote(processInfo.appCreationTime)}`,
    "Add-Type -TypeDefinition @'",
    "using System; using System.Runtime.InteropServices;",
    "public static class KuroneKoWindowClose {",
    "[DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr extra);",
    "[DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr window);",
    "[DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, System.Text.StringBuilder className, int maxCount);",
    "[DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, System.Text.StringBuilder title, int maxCount);",
    "[DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);",
    "[DllImport(\"user32.dll\", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);",
    "public delegate bool EnumWindowsProc(IntPtr window, IntPtr extra);",
    "}",
    "'@",
    "$owned = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $PidToClose)",
    "if (-not $owned -or $owned.ExecutablePath -ne $ExpectedPath -or $owned.CreationDate.ToUniversalTime().ToString('o') -ne $ExpectedCreationTime) { throw 'Refusing WM_CLOSE: app process identity does not match the test-owned instance' }",
    "$inventory = [System.Collections.Generic.List[object]]::new()",
    `$expectedClass = ${quote(KURONE_KO_WINDOW_CLASS)}`,
    `$expectedTitle = ${quote(KURONE_KO_WINDOW_TITLE)}`,
    "$callback = [KuroneKoWindowClose+EnumWindowsProc]{ param($window, $extra); $windowPid = [uint32]0; [void][KuroneKoWindowClose]::GetWindowThreadProcessId($window, [ref]$windowPid); if ($windowPid -eq $PidToClose) { $className = [System.Text.StringBuilder]::new(256); $title = [System.Text.StringBuilder]::new(256); [void][KuroneKoWindowClose]::GetClassName($window, $className, $className.Capacity); [void][KuroneKoWindowClose]::GetWindowText($window, $title, $title.Capacity); $visible = [KuroneKoWindowClose]::IsWindowVisible($window); $inventory.Add([pscustomobject]@{ Window = $window; HWND = ('0x{0:X}' -f $window.ToInt64()); Title = $title.ToString(); Class = $className.ToString(); Visible = $visible }) }; return $true }",
    "[void][KuroneKoWindowClose]::EnumWindows($callback, [IntPtr]::Zero)",
    "$windows = @($inventory | Where-Object { $_.Visible -and $_.Class -eq $expectedClass -and $_.Title -eq $expectedTitle })",
    "if ($windows.Count -ne 1) { $boundedInventory = @($inventory | Select-Object -First 40 HWND, Title, Class, Visible | ConvertTo-Json -Compress); $truncated = $inventory.Count -gt 40; throw ('Refusing WM_CLOSE: expected exactly one visible owned Tauri app window, found ' + $windows.Count + '; owned HWND inventory (' + $inventory.Count + ' total' + $(if ($truncated) { ', first 40 shown' } else { '' }) + '): ' + $(if ($boundedInventory) { $boundedInventory } else { '[]' })) }",
    "$owned = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $PidToClose)",
    "if (-not $owned -or $owned.ExecutablePath -ne $ExpectedPath -or $owned.CreationDate.ToUniversalTime().ToString('o') -ne $ExpectedCreationTime) { throw 'Refusing WM_CLOSE: app process identity changed before delivery' }",
    "$targetWindow = $windows[0].Window",
    "$windowResult = [IntPtr]::Zero",
    "$targetPid = [uint32]0",
    "[void][KuroneKoWindowClose]::GetWindowThreadProcessId($targetWindow, [ref]$targetPid)",
    "$className = [System.Text.StringBuilder]::new(256); $title = [System.Text.StringBuilder]::new(256)",
    "[void][KuroneKoWindowClose]::GetClassName($targetWindow, $className, $className.Capacity)",
    "[void][KuroneKoWindowClose]::GetWindowText($targetWindow, $title, $title.Capacity)",
    "if ($targetPid -ne $PidToClose -or -not [KuroneKoWindowClose]::IsWindowVisible($targetWindow) -or $className.ToString() -ne $expectedClass -or $title.ToString() -ne $expectedTitle) { throw 'Refusing WM_CLOSE: selected HWND identity changed before delivery' }",
    "$sent = [KuroneKoWindowClose]::SendMessageTimeout($windows[0].Window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero, 0x0002, 5000, [ref]$windowResult)",
    "if ($sent -eq [IntPtr]::Zero) { throw 'WM_CLOSE delivery timed out or failed' }",
  ].join("\n");
};

export const closeOwnedVisibleWindow = async (processInfo: TauriAppProcessInfo): Promise<void> => {
  if (process.platform !== "win32") {
    throw new Error("Native WM_CLOSE shutdown verification is supported only on Windows");
  }

  const script = buildNativeCloseScript(processInfo);

  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`Failed to close exactly one visible test-owned Kurone-ko window (${code}): ${stderr.trim()}`)));
  });
};
