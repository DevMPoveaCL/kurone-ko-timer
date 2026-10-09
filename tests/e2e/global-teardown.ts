import { cleanupProcessInfoFile, PROCESS_INFO_FILE, readProcessInfo, stopOwnedLauncher } from "./shutdown-observability";

export default async function globalTeardown() {
  const processInfo = await readProcessInfo(PROCESS_INFO_FILE);

  if (processInfo === null) {
    return;
  }

  await stopOwnedLauncher(processInfo);

  await cleanupProcessInfoFile(PROCESS_INFO_FILE);
}
