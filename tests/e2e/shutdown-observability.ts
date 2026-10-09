import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";

const STARTUP_TIMEOUT_MS = Number.parseInt(process.env.KURONE_KO_E2E_STARTUP_TIMEOUT_MS ?? "120000", 10);
const SHUTDOWN_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 500;

export interface ProcessIdentity {
  creationTime: string;
  executablePath: string | null;
  name: string;
  parentPid: number;
  pid: number;
}

export interface TauriDevProcessInfo {
  launcherCreationTime: string;
  launcherPath: string | null;
  launcherPid: number;
  appCreationTime?: string;
  appName?: string;
  appPath?: string;
  appPid?: number;
}

export interface TauriAppProcessInfo extends TauriDevProcessInfo {
  appCreationTime: string;
  appName: string;
  appPath: string;
  appPid: number;
}

export const PROCESS_INFO_FILE = ".playwright-state/kurone-ko-tauri-dev.json";

export const isSameProcessIdentity = (expected: ProcessIdentity, observed: ProcessIdentity): boolean =>
  expected.pid === observed.pid &&
  expected.creationTime === observed.creationTime &&
  (expected.executablePath === null || observed.executablePath === null ||
    expected.executablePath.toLowerCase() === observed.executablePath.toLowerCase());

export const assertStoredProcessIdentityAbsent = (expected: ProcessIdentity, current: ProcessIdentity | null): void => {
  if (current === null) return;
  if (!isSameProcessIdentity(expected, current)) {
    throw new Error(`Refusing cleanup: PID ${expected.pid} exists with a different process identity`);
  }
  throw new Error(`Refusing cleanup: stored process PID ${expected.pid} is still present`);
};

export const mergeProcessObservations = (...snapshots: ProcessIdentity[][]): ProcessIdentity[] => {
  const observed = new Map<string, ProcessIdentity>();

  for (const identity of snapshots.flat()) {
    observed.set(`${identity.pid}:${identity.creationTime}`, identity);
  }

  return [...observed.values()];
};

export const selectOwnedProcessDescendants = (expectedRoot: ProcessIdentity, snapshot: ProcessIdentity[]): ProcessIdentity[] => {
  const rootMatches = snapshot.filter((identity) =>
    identity.pid === expectedRoot.pid &&
    identity.creationTime === expectedRoot.creationTime &&
    identity.executablePath !== null && expectedRoot.executablePath !== null &&
    identity.executablePath.toLowerCase() === expectedRoot.executablePath.toLowerCase() &&
    identity.name.toLowerCase() === expectedRoot.name.toLowerCase(),
  );
  if (rootMatches.length !== 1) {
    throw new Error(`Process snapshot does not contain the expected root PID ${expectedRoot.pid}`);
  }

  const byPid = new Map<number, ProcessIdentity>();
  for (const identity of snapshot) {
    if (byPid.has(identity.pid)) {
      throw new Error(`Process snapshot has ambiguous ownership for PID ${identity.pid}`);
    }
    byPid.set(identity.pid, identity);
  }

  const rootTime = Date.parse(rootMatches[0].creationTime);
  if (!Number.isFinite(rootTime)) {
    throw new Error(`Process snapshot has uncertain creation time for root PID ${expectedRoot.pid}`);
  }

  const reachable = new Map<number, { identity: ProcessIdentity; depth: number }>([
    [expectedRoot.pid, { identity: rootMatches[0], depth: 0 }],
  ]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const identity of snapshot) {
      if (reachable.has(identity.pid)) continue;
      const parent = reachable.get(identity.parentPid);
      if (parent === undefined) continue;
      const parentTime = Date.parse(parent.identity.creationTime);
      const childTime = Date.parse(identity.creationTime);
      if (!Number.isFinite(childTime) || !Number.isFinite(parentTime)) {
        throw new Error(`Process snapshot has uncertain creation time for descendant PID ${identity.pid}`);
      }
      if (childTime < parentTime) {
        throw new Error(`Process snapshot creation time predates its parent for descendant PID ${identity.pid}`);
      }
      reachable.set(identity.pid, { identity, depth: parent.depth + 1 });
      changed = true;
    }
  }

  return [...reachable.values()]
    .filter(({ identity }) => identity.pid !== expectedRoot.pid)
    .sort((left, right) => left.depth - right.depth)
    .map(({ identity }) => identity);
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export const getRemoteDebuggingPort = (cdpEndpoint: string): number => {
  let endpoint: URL;
  try {
    endpoint = new URL(cdpEndpoint);
  } catch {
    throw new Error(`Invalid KURONE_KO_CDP_ENDPOINT: ${cdpEndpoint}`);
  }

  if (endpoint.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) {
    throw new Error(`KURONE_KO_CDP_ENDPOINT must use HTTP on localhost: ${cdpEndpoint}`);
  }

  const port = endpoint.port === "" ? 9222 : Number(endpoint.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`KURONE_KO_CDP_ENDPOINT has an invalid port: ${cdpEndpoint}`);
  }

  return port;
};

export const isCdpAvailable = async (cdpEndpoint: string): Promise<boolean> => {
  try {
    const response = await fetch(`${cdpEndpoint}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
};

export const waitForCdp = async (processRef: ChildProcess, cdpEndpoint: string): Promise<void> => {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) {
      throw new Error(`tauri dev exited before CDP became available (code ${processRef.exitCode})`);
    }

    if (await isCdpAvailable(cdpEndpoint)) {
      return;
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for WebView2 CDP endpoint at ${cdpEndpoint}`);
};


export const readProcessTree = async (rootPid: number): Promise<ProcessIdentity[]> => {
  if (process.platform !== "win32") {
    throw new Error("Tauri process-tree observability is currently supported only on Windows");
  }

  const script = [
    `$rootPid = ${rootPid}`,
    "$processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CreationDate)",
    "$known = [System.Collections.Generic.HashSet[int]]::new()",
    "$null = $known.Add($rootPid)",
    "$changed = $true",
    "while ($changed) {",
    "  $changed = $false",
    "  foreach ($processInfo in $processes) {",
    "    if ($known.Contains([int]$processInfo.ParentProcessId) -and $known.Add([int]$processInfo.ProcessId)) { $changed = $true }",
    "  }",
    "}",
    "$processes | Where-Object { $known.Contains([int]$_.ProcessId) } | ForEach-Object { $_ | Add-Member -NotePropertyName CreationTimeIso -NotePropertyValue $_.CreationDate.ToUniversalTime().ToString('o') -PassThru } | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CreationTimeIso | ConvertTo-Json -Compress",
  ].join("; ");

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Failed to inspect launched process tree (${code}): ${stderr.trim()}`));
      }
    });
  });

  if (output.length === 0) {
    return [];
  }

  const parsed: unknown = JSON.parse(output);
  const entries = Array.isArray(parsed) ? parsed : [parsed];

  return entries.flatMap((entry): ProcessIdentity[] => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }

    const processInfo = entry as Record<string, unknown>;
    const pid = Number(processInfo.ProcessId);
    const parentPid = Number(processInfo.ParentProcessId);

    if (!Number.isInteger(pid) || !Number.isInteger(parentPid) || typeof processInfo.Name !== "string" || typeof processInfo.CreationTimeIso !== "string") {
      return [];
    }

    return [{
      creationTime: processInfo.CreationTimeIso,
      executablePath: typeof processInfo.ExecutablePath === "string" ? processInfo.ExecutablePath : null,
      name: processInfo.Name,
      parentPid,
      pid,
    }];
  });
};

export const waitForLauncherProcessInfo = async (launcherPid: number): Promise<TauriDevProcessInfo> => {
  const deadline = Date.now() + Math.min(STARTUP_TIMEOUT_MS, 10_000);

  while (Date.now() < deadline) {
    const launcher = await readProcessIdentity(launcherPid);
    if (launcher !== null) {
      return {
        launcherCreationTime: launcher.creationTime,
        launcherPath: launcher.executablePath,
        launcherPid,
      };
    }
    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`Could not verify spawned launcher PID ${launcherPid}; preserving any existing ownership evidence`);
};

export const waitForTauriAppProcess = async (launcherPid: number): Promise<TauriAppProcessInfo> => {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const processes = await readProcessTree(launcherPid);
    const appProcess = processes.find((processInfo) => processInfo.name.toLowerCase() === "kurone-ko.exe");

    const launcherProcess = processes.find((processInfo) => processInfo.pid === launcherPid);

    if (appProcess?.executablePath !== null && appProcess?.executablePath !== undefined && launcherProcess !== undefined) {
      return {
        appCreationTime: appProcess.creationTime,
        appName: appProcess.name,
        appPath: appProcess.executablePath,
        appPid: appProcess.pid,
        launcherCreationTime: launcherProcess.creationTime,
        launcherPath: launcherProcess.executablePath,
        launcherPid,
      };
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out finding kurone-ko.exe below launched npm PID ${launcherPid}`);
};

const readProcessIdentity = async (pid: number): Promise<ProcessIdentity | null> => {
  const output = await new Promise<string>((resolve, reject) => {
    const script = `$processInfo = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CreationDate; if ($processInfo) { $processInfo | ForEach-Object { $_ | Add-Member -NotePropertyName CreationTimeIso -NotePropertyValue $_.CreationDate.ToUniversalTime().ToString('o') -PassThru } | ConvertTo-Json -Compress }`;
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`Failed to inspect process ${pid}: ${stderr.trim()}`)));
  });

  if (output === "") return null;
  const entry: unknown = JSON.parse(output);
  if (typeof entry !== "object" || entry === null) return null;
  const value = entry as Record<string, unknown>;
  if (typeof value.Name !== "string" || typeof value.CreationTimeIso !== "string") return null;
  return {
    creationTime: value.CreationTimeIso,
    executablePath: typeof value.ExecutablePath === "string" ? value.ExecutablePath : null,
    name: value.Name,
    parentPid: Number(value.ParentProcessId),
    pid: Number(value.ProcessId),
  };
};

interface ProcessTrackingReport {
  startedAt: string;
  firstSampleAt: string | null;
  lastSampleAt: string | null;
  sampleCount: number;
  failedSamples: string[];
}

const activeProcessObservations = new Map<number, ProcessIdentity[]>();
const activeProcessTrackingReports = new Map<number, ProcessTrackingReport>();
const pendingProcessObservations = new Map<number, Promise<void>>();
const processTrackers = new Map<number, ReturnType<typeof setInterval>>();

export const startAppProcessTracking = async (processInfo: TauriAppProcessInfo): Promise<void> => {
  if (processTrackers.has(processInfo.appPid)) return;
  const pid = processInfo.appPid;
  activeProcessObservations.set(pid, []);
  const report: ProcessTrackingReport = {
    startedAt: new Date().toISOString(),
    firstSampleAt: null,
    lastSampleAt: null,
    sampleCount: 0,
    failedSamples: [],
  };
  activeProcessTrackingReports.set(pid, report);
  const observe = async () => {
    try {
      const snapshot = await readProcessTree(pid);
      const sampledAt = new Date().toISOString();
      report.sampleCount += 1;
      report.firstSampleAt ??= sampledAt;
      report.lastSampleAt = sampledAt;
      const descendants = snapshot.filter(({ pid: observedPid }) => observedPid !== pid);
      activeProcessObservations.set(pid, mergeProcessObservations(activeProcessObservations.get(pid) ?? [], descendants));
    } catch (error) {
      const failure = `${new Date().toISOString()}: ${String(error)}`;
      report.failedSamples.push(failure);
      console.warn(`[shutdown] process-tree tracking sample failed: ${failure}`);
    }
  };
  const sample = observe();
  pendingProcessObservations.set(pid, sample);
  await sample;
  pendingProcessObservations.delete(pid);
  processTrackers.set(pid, setInterval(() => {
    const nextSample = observe();
    pendingProcessObservations.set(pid, nextSample);
    void nextSample.finally(() => {
      if (pendingProcessObservations.get(pid) === nextSample) pendingProcessObservations.delete(pid);
    });
  }, POLL_INTERVAL_MS));
};

export const waitForShutdown = async (processInfo: TauriAppProcessInfo, cdpEndpoint: string): Promise<void> => {
  const expectedApp: ProcessIdentity = {
    creationTime: processInfo.appCreationTime,
    executablePath: processInfo.appPath,
    name: processInfo.appName,
    parentPid: 0,
    pid: processInfo.appPid,
  };
  const tracker = processTrackers.get(processInfo.appPid);
  if (tracker !== undefined) clearInterval(tracker);
  processTrackers.delete(processInfo.appPid);
  await pendingProcessObservations.get(processInfo.appPid);
  pendingProcessObservations.delete(processInfo.appPid);
  const trackingReport = activeProcessTrackingReports.get(processInfo.appPid);
  activeProcessTrackingReports.delete(processInfo.appPid);
  let observed = mergeProcessObservations([expectedApp], activeProcessObservations.get(processInfo.appPid) ?? []);
  activeProcessObservations.delete(processInfo.appPid);
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const snapshot = await readProcessTree(processInfo.appPid);
    if (snapshot.some((identity) => identity.pid === processInfo.appPid && !isSameProcessIdentity(expectedApp, identity))) {
      throw new Error(`Application PID ${processInfo.appPid} was reused by a different process during shutdown observation`);
    }
    observed = mergeProcessObservations(observed, snapshot.filter(({ pid }) => pid !== processInfo.appPid));
    const alive: ProcessIdentity[] = [];
    for (const expected of observed) {
      const current = await readProcessIdentity(expected.pid);
      if (current !== null && isSameProcessIdentity(expected, current)) alive.push(expected);
    }
    if (alive.length === 0) {
      const identities = observed.map(({ name, pid, creationTime, executablePath }) => `${name} PID ${pid} created ${creationTime} (${executablePath ?? "path unavailable"})`);
      const report = trackingReport === undefined
        ? "tracking unavailable"
        : `tracking started ${trackingReport.startedAt}; samples ${trackingReport.sampleCount} (${trackingReport.firstSampleAt ?? "none"} to ${trackingReport.lastSampleAt ?? "none"}); failed samples ${trackingReport.failedSamples.length}${trackingReport.failedSamples.length === 0 ? "" : ` [${trackingReport.failedSamples.join(" | ")}]`}`;
      console.info(`[shutdown] app ${processInfo.appName} PID ${processInfo.appPid}; ${report}; observed process identities: ${identities.join("; ") || "none"}`);
      return;
    }
    await delay(POLL_INTERVAL_MS);
  }

  const survivors: string[] = [];
  for (const identity of observed) {
    const current = await readProcessIdentity(identity.pid);
    if (current !== null && isSameProcessIdentity(identity, current)) survivors.push(`${identity.name} PID ${identity.pid} (${identity.executablePath ?? "path unavailable"})`);
  }
  throw new Error(`Kurone-ko shutdown timed out; surviving app-scoped processes: ${survivors.join(", ") || "none"}; CDP endpoint ${cdpEndpoint} is not used as app-ownership evidence`);
};

export const isTauriAppProcessInfo = (processInfo: TauriDevProcessInfo): processInfo is TauriAppProcessInfo =>
  processInfo.appCreationTime !== undefined && processInfo.appName !== undefined &&
  processInfo.appPath !== undefined && processInfo.appPid !== undefined;

export const writeProcessInfo = async (pidFile: string, processInfo: TauriDevProcessInfo): Promise<void> => {
  await mkdir(dirname(pidFile), { recursive: true });
  await writeFile(pidFile, JSON.stringify(processInfo), "utf8");
};

export const readProcessInfo = async (pidFile: string): Promise<TauriDevProcessInfo | null> => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(pidFile, "utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;

  if (
    typeof candidate.launcherPid !== "number" || !Number.isInteger(candidate.launcherPid) || candidate.launcherPid <= 0 ||
    typeof candidate.launcherCreationTime !== "string" ||
    (candidate.launcherPath !== null && typeof candidate.launcherPath !== "string")
  ) {
    return null;
  }

  const appFields = [candidate.appCreationTime, candidate.appName, candidate.appPath, candidate.appPid];
  const hasAppInfo = appFields.every((value) => value !== undefined);
  const hasPartialAppInfo = appFields.some((value) => value !== undefined);

  if (hasPartialAppInfo && (
    typeof candidate.appCreationTime !== "string" || typeof candidate.appName !== "string" ||
    typeof candidate.appPath !== "string" || typeof candidate.appPid !== "number" ||
    !Number.isInteger(candidate.appPid) || candidate.appPid <= 0
  )) {
    return null;
  }

  return {
    launcherCreationTime: candidate.launcherCreationTime,
    launcherPath: typeof candidate.launcherPath === "string" ? candidate.launcherPath : null,
    launcherPid: candidate.launcherPid,
    ...(hasAppInfo ? {
      appCreationTime: candidate.appCreationTime as string,
      appName: candidate.appName as string,
      appPath: candidate.appPath as string,
      appPid: candidate.appPid as number,
    } : {}),
  };
};

const stopOwnedProcess = async (expected: ProcessIdentity): Promise<void> => {
  const current = await readProcessIdentity(expected.pid);
  if (current === null) return;
  if (!isSameProcessIdentity(expected, current) || expected.executablePath === null || current.executablePath === null) {
    throw new Error(`Refusing to stop PID ${expected.pid}: creation time or executable path cannot be confirmed for the owned test process`);
  }

  if (process.platform !== "win32") {
    process.kill(expected.pid);
  } else {
    await new Promise<void>((resolve, reject) => {
      const taskkill = spawn("taskkill", ["/PID", String(expected.pid), "/F"], { stdio: "ignore" });
      taskkill.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Failed to stop owned PID ${expected.pid} (${code})`)));
      taskkill.on("error", reject);
    });
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const remaining = await readProcessIdentity(expected.pid);
    if (remaining === null || !isSameProcessIdentity(expected, remaining)) return;
    await delay(POLL_INTERVAL_MS);
  }
  const remaining = await readProcessIdentity(expected.pid);
  if (remaining !== null && isSameProcessIdentity(expected, remaining)) {
    throw new Error(`Could not confirm owned PID ${expected.pid} stopped`);
  }
};

export const stopOwnedLauncher = async (processInfo: TauriDevProcessInfo): Promise<void> => {
  const expected: ProcessIdentity = {
    creationTime: processInfo.launcherCreationTime,
    executablePath: processInfo.launcherPath,
    name: "",
    parentPid: 0,
    pid: processInfo.launcherPid,
  };
  await stopOwnedProcess(expected);

  if (isTauriAppProcessInfo(processInfo)) {
    const expectedApp: ProcessIdentity = {
      creationTime: processInfo.appCreationTime,
      executablePath: processInfo.appPath,
      name: processInfo.appName,
      parentPid: 0,
      pid: processInfo.appPid,
    };
    const app = await readProcessIdentity(expectedApp.pid);
    if (app !== null && !isSameProcessIdentity(expectedApp, app)) {
      throw new Error(`Refusing to stop app PID ${expectedApp.pid}: creation time or executable path no longer matches stored test identity`);
    }
    if (app !== null) {
      const tree = await readProcessTree(expectedApp.pid);
      let descendants: ProcessIdentity[];
      try {
        descendants = selectOwnedProcessDescendants(expectedApp, tree);
      } catch {
        throw new Error(`Could not confirm stored app PID ${expectedApp.pid} as the root of its process tree; preserving ${PROCESS_INFO_FILE}`);
      }
      for (const descendant of [...descendants].reverse()) {
        await stopOwnedProcess(descendant);
      }
      await stopOwnedProcess(expectedApp);
    }

  }

  assertStoredProcessIdentityAbsent(expected, await readProcessIdentity(expected.pid));
  if (isTauriAppProcessInfo(processInfo)) {
    const expectedApp: ProcessIdentity = {
      creationTime: processInfo.appCreationTime,
      executablePath: processInfo.appPath,
      name: processInfo.appName,
      parentPid: 0,
      pid: processInfo.appPid,
    };
    assertStoredProcessIdentityAbsent(expectedApp, await readProcessIdentity(expectedApp.pid));
  }
};

export const cleanupProcessInfoFile = async (pidFile: string): Promise<void> => {
  await rm(pidFile, { force: true });
};
