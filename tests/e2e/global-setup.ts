import { spawn } from "node:child_process";
import {
  cleanupProcessInfoFile,
  getRemoteDebuggingPort,
  isCdpAvailable,
  PROCESS_INFO_FILE,
  stopOwnedLauncher,
  waitForCdp,
  waitForLauncherProcessInfo,
  waitForTauriAppProcess,
  writeProcessInfo,
  type TauriDevProcessInfo,
} from "./shutdown-observability";

const CDP_ENDPOINT = process.env.KURONE_KO_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const REMOTE_DEBUGGING_PORT = getRemoteDebuggingPort(CDP_ENDPOINT);

export default async function globalSetup() {
  if (await isCdpAvailable(CDP_ENDPOINT)) {
    throw new Error(`Refusing to attach to unowned existing app at ${CDP_ENDPOINT}; shutdown evidence requires a process launched by this test run`);
  }

  const childProcess = spawn("npm", ["run", "tauri", "dev"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      KURONE_KO_E2E: "1",
      VITE_KURONE_KO_E2E: "1",
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`,
    },
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (childProcess.pid === undefined) {
    throw new Error("Failed to start tauri dev for E2E tests");
  }

  let processInfo: TauriDevProcessInfo | null = null;
  try {
    processInfo = await waitForLauncherProcessInfo(childProcess.pid);
    await writeProcessInfo(PROCESS_INFO_FILE, processInfo);
    await waitForCdp(childProcess, CDP_ENDPOINT);
    processInfo = await waitForTauriAppProcess(childProcess.pid);
    await writeProcessInfo(PROCESS_INFO_FILE, processInfo);
  } catch (error) {
    if (processInfo !== null) {
      try {
        await stopOwnedLauncher(processInfo);
        await cleanupProcessInfoFile(PROCESS_INFO_FILE);
      } catch (cleanupError) {
        console.error(`[e2e setup] Could not confirm cleanup of owned launcher ${processInfo.launcherPid}; preserving ${PROCESS_INFO_FILE}: ${String(cleanupError)}`);
      }
    }
    throw error;
  }
}
