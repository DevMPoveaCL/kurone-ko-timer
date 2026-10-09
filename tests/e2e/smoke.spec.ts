import { spawn } from "node:child_process";
import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { waitForKuroneKoAppPage } from "../../src/e2e/appPage";
import { closeOwnedVisibleWindow, isKuroneKoAppWindow } from "./native-close";
import {
  cleanupProcessInfoFile,
  getRemoteDebuggingPort,
  isCdpAvailable,
  isTauriAppProcessInfo,
  PROCESS_INFO_FILE,
  readProcessInfo,
  startAppProcessTracking,
  stopOwnedLauncher,
  waitForCdp,
  waitForLauncherProcessInfo,
  waitForShutdown,
  waitForTauriAppProcess,
  writeProcessInfo,
  type TauriDevProcessInfo,
} from "./shutdown-observability";

const CDP_ENDPOINT = process.env.KURONE_KO_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const REMOTE_DEBUGGING_PORT = getRemoteDebuggingPort(CDP_ENDPOINT);

interface KuroneKoE2EDriver {
  getAudioEvidence: () => Promise<KuroneKoAudioEvidence | null> | KuroneKoAudioEvidence | null;
  getWindowLabel: () => Promise<string> | string;
  isWindowVisible: (label: string) => Promise<boolean> | boolean;
  getMusicState: () => Promise<KuroneKoMusicState> | KuroneKoMusicState;
  reset: () => Promise<void> | void;
  setFastDurations: (settings: {
    focusDurationSeconds: number;
    shortBreakDurationSeconds: number;
    longBreakDurationSeconds: number;
    sessionGoal: number;
    sessionsBeforeLongBreak: number;
  }) => Promise<void> | void;
}

interface KuroneKoMusicState {
  ducked: boolean;
  enabled: boolean;
  isPlaying: boolean;
}

interface KuroneKoAudioEvidence {
  paused: boolean;
  source: string;
}

interface KuroneKoWindow extends Window {
  __KURONE_KO_E2E__?: KuroneKoE2EDriver;
}

interface ElementBounds {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

interface ElementLayoutSnapshot extends ElementBounds {
  text: string;
}

interface CardFrameSnapshot extends ElementBounds {
  borderRadius: number;
  boxShadow: string;
  viewportHeight: number;
  viewportWidth: number;
}

const TIMER_VIEWPORT = {
  height: 150,
  width: 300,
} as const;

const DASHBOARD_VIEWPORT = {
  height: 640,
  width: 360,
} as const;

const MAX_TIMER_GUTTER_PX = 4;
const MAX_DASHBOARD_GUTTER_PX = 8;

const toElementBounds = (rect: DOMRect): ElementBounds => ({
  bottom: rect.bottom,
  height: rect.height,
  left: rect.left,
  right: rect.right,
  top: rect.top,
  width: rect.width,
});

const expectBoundsInsideViewport = (bounds: ElementBounds, viewport: typeof TIMER_VIEWPORT | typeof DASHBOARD_VIEWPORT) => {
  expect(bounds.width).toBeGreaterThan(0);
  expect(bounds.height).toBeGreaterThan(0);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(viewport.width);
  expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
};

const expectRoundedCardFrame = (snapshot: CardFrameSnapshot, viewport: typeof TIMER_VIEWPORT | typeof DASHBOARD_VIEWPORT, maxGutterPx: number) => {
  expect(snapshot.viewportWidth).toBe(viewport.width);
  expect(snapshot.viewportHeight).toBe(viewport.height);
  expect(snapshot.left).toBeGreaterThanOrEqual(0);
  expect(snapshot.top).toBeGreaterThanOrEqual(0);
  expect(snapshot.left).toBeLessThanOrEqual(maxGutterPx);
  expect(snapshot.top).toBeLessThanOrEqual(maxGutterPx);
  expect(viewport.width - snapshot.right).toBeLessThanOrEqual(maxGutterPx);
  expect(viewport.height - snapshot.bottom).toBeLessThanOrEqual(maxGutterPx);
  expect(snapshot.boxShadow).not.toBe("none");
  expect(snapshot.borderRadius).toBeGreaterThan(0);
};

const getViewportSize = async (page: Page): Promise<typeof TIMER_VIEWPORT | typeof DASHBOARD_VIEWPORT> =>
  page.evaluate(() => ({
    height: window.innerHeight,
    width: window.innerWidth,
  }));

const dismissDashboardOnboarding = async (dashboardPage: Page): Promise<void> => {
  const onboarding = dashboardPage.getByRole("dialog", { name: "Welcome to KURONE-KO" });
  if (await onboarding.isVisible()) {
    await dashboardPage.keyboard.press("Escape");
    await expect(onboarding).toBeHidden();
  }
};

const resetE2EState = async (page: Page) => {
  await page.evaluate(async () => {
    const driver = (window as KuroneKoWindow).__KURONE_KO_E2E__;

    if (driver === undefined) {
      throw new Error("KURONE-KO E2E driver is not available");
    }

    await driver.reset();
  });
};

const prepareTimerForE2E = async (timerPage: Page): Promise<void> => {
  await timerPage.getByRole("button", { name: "Show timer" }).click();
  await resetE2EState(timerPage);
};

const setFastDurations = async (page: Page, focusDurationSeconds: number) => {
  await page.evaluate(async (durationSeconds) => {
    const driver = (window as KuroneKoWindow).__KURONE_KO_E2E__;

    if (driver === undefined) {
      throw new Error("KURONE-KO E2E driver is not available");
    }

    await driver.setFastDurations({
      focusDurationSeconds: durationSeconds,
      shortBreakDurationSeconds: 1,
      longBreakDurationSeconds: 1,
      sessionGoal: 1,
      sessionsBeforeLongBreak: 1,
    });
  }, focusDurationSeconds);
};

const getAudioEvidence = async (page: Page): Promise<KuroneKoAudioEvidence | null> =>
  page.evaluate(async () => {
    const driver = (window as KuroneKoWindow).__KURONE_KO_E2E__;

    if (driver === undefined) {
      throw new Error("KURONE-KO E2E driver is not available");
    }

    return driver.getAudioEvidence();
  });

const getMusicState = async (page: Page): Promise<KuroneKoMusicState> =>
  page.evaluate(async () => {
    const driver = (window as KuroneKoWindow).__KURONE_KO_E2E__;

    if (driver === undefined) {
      throw new Error("KURONE-KO E2E driver is not available");
    }

    return driver.getMusicState();
  });

const getWindowLabel = async (page: Page): Promise<string> =>
  page.evaluate(async () => {
    const driver = (window as KuroneKoWindow).__KURONE_KO_E2E__;

    if (driver === undefined) {
      throw new Error("KURONE-KO E2E driver is not available");
    }

    return driver.getWindowLabel();
  });

const isWindowVisible = async (page: Page, label: string): Promise<boolean> =>
  page.evaluate(async (windowLabel) => {
    const driver = (window as KuroneKoWindow).__KURONE_KO_E2E__;

    if (driver === undefined) {
      throw new Error("KURONE-KO E2E driver is not available");
    }

    return driver.isWindowVisible(windowLabel);
  }, label);

const logShutdownStage = (stage: "dashboardExit" | "nativeDashboard" | "nativeTimer", state: "start" | "complete", processInfo: TauriDevProcessInfo | null): void => {
  const identity = processInfo === null
    ? "identity unavailable"
    : `launcher ${processInfo.launcherPid} (${processInfo.launcherCreationTime}); app ${processInfo.appPid ?? "not recorded"}${processInfo.appCreationTime === undefined ? "" : ` (${processInfo.appCreationTime})`}`;
  console.info(`[shutdown-stage] ${stage} ${state}; ${identity}`);
};

const assertKuroneKoShutdown = async () => {
  const processInfo = await readProcessInfo(PROCESS_INFO_FILE);

  if (processInfo === null || !isTauriAppProcessInfo(processInfo)) {
    throw new Error("Expected Tauri app pid metadata for shutdown assertion");
  }

  await waitForShutdown(processInfo, CDP_ENDPOINT);
};

test.describe("KURONE-KO native widget smoke", () => {
  test("native close selection excludes internal Tao windows", async () => {
    expect(isKuroneKoAppWindow("Tauri Window", "KURONE-KO")).toBe(true);
    expect(isKuroneKoAppWindow("Tao Thread Event Target", "")).toBe(false);
    expect(isKuroneKoAppWindow("Tauri Window", "Unrelated Window")).toBe(false);
  });
  let browser: Browser;
  let page: Page;

  test.beforeAll(async () => {
    browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    page = await waitForKuroneKoAppPage(browser, { label: "dashboard" });
    await expect(page.getByLabel("KURONE-KO dashboard")).toBeVisible();
    await expect.poll(() => getWindowLabel(page)).toBe("dashboard");
    await expect.poll(() => isWindowVisible(page, "dashboard")).toBe(true);
    await expect.poll(() => isWindowVisible(page, "timer")).toBe(false);
  });

  test.afterAll(async () => {
    await browser?.close();
  });

  test.beforeEach(async () => {
    const dashboardPage = await waitForKuroneKoAppPage(browser, { label: "dashboard" });
    const timerPage = await waitForKuroneKoAppPage(browser, { label: "timer" });

    if (await isWindowVisible(timerPage, "timer")) {
      await timerPage.getByRole("button", { name: "Return to dashboard" }).click();
    }

    await expect.poll(() => isWindowVisible(dashboardPage, "dashboard")).toBe(true);
    await expect(dashboardPage.getByLabel("KURONE-KO dashboard")).toBeVisible();
    await dismissDashboardOnboarding(dashboardPage);

    const backToDashboard = dashboardPage.getByRole("button", { name: "Back to dashboard" });
    if (await backToDashboard.isVisible()) {
      await backToDashboard.click();
    }

    await dashboardPage.getByRole("button", { name: "Start Session" }).click();

    page = timerPage;
    await expect.poll(() => isWindowVisible(page, "timer")).toBe(true);
    await expect.poll(() => isWindowVisible(page, "dashboard")).toBe(false);
    await expect(page.getByLabel("KURONE-KO focus timer; drag empty areas to move")).toBeVisible();
    await prepareTimerForE2E(page);
  });

  test("opens dashboard visibly at launch and keeps the timer hidden until selected", async () => {
    expect(await getWindowLabel(page)).toBe("timer");
    await expect.poll(() => isWindowVisible(page, "timer")).toBe(true);
    await expect.poll(() => isWindowVisible(page, "dashboard")).toBe(false);

    await page.getByRole("button", { name: "Return to dashboard" }).click();

    const dashboardPage = await waitForKuroneKoAppPage(browser, { label: "dashboard" });
    await expect.poll(() => isWindowVisible(dashboardPage, "dashboard")).toBe(true);
    await expect.poll(() => isWindowVisible(dashboardPage, "timer")).toBe(false);
    await expect(dashboardPage.getByLabel("KURONE-KO dashboard")).toBeVisible();

    await expect.poll(() => getViewportSize(dashboardPage)).toEqual(DASHBOARD_VIEWPORT);

    const dashboardCardFrame = await dashboardPage.locator(".dashboard-card").evaluate<CardFrameSnapshot>((element) => {
      const rect = element.getBoundingClientRect();
      const styles = window.getComputedStyle(element);

      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
        borderRadius: Number.parseFloat(styles.borderTopLeftRadius),
        boxShadow: styles.boxShadow,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    });

    expectRoundedCardFrame(dashboardCardFrame, DASHBOARD_VIEWPORT, MAX_DASHBOARD_GUTTER_PX);
    expect(dashboardCardFrame.borderRadius).toBeLessThanOrEqual(14);
  });

  test("launches the app window and responds to toolbar panel toggles", async () => {
    await expect(page.getByText(/drag/i)).toHaveCount(0);
    await expect(page.getByLabel("Move widget")).toHaveAttribute("data-tauri-drag-region", "");
    await expect(page.getByRole("button", { name: "Show timer" })).toHaveText("");
    await expect(page.getByRole("button", { name: "Show settings" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show history" })).toHaveText("");
    await expect(page.getByRole("button", { name: "Play Kurone-ko Playlist" })).toHaveText("");
    await expect(page.getByText("KURONE-KO · Ready to focus")).toBeVisible();

    await page.getByRole("button", { name: "Show history" }).click();
    await expect(page.getByLabel("Today history")).toBeVisible();

    await page.getByRole("button", { name: "Show history" }).click();
    await expect(page.getByLabel("Today history")).toBeHidden();
    await expect(page.getByText("KURONE-KO · Ready to focus")).toBeVisible();
  });

  test("toggles Kurone-ko Playlist from the compact widget control", async () => {
    await page.getByRole("button", { name: "Play Kurone-ko Playlist" }).click();

    await expect(page.getByRole("button", { name: "Stop Kurone-ko Playlist" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Stop Kurone-ko Playlist" }).click();

    await expect(page.getByRole("button", { name: "Play Kurone-ko Playlist" })).toHaveAttribute("aria-pressed", "false");
  });

  test("keeps settings controls out of the focus widget", async () => {
    await expect(page.getByRole("button", { name: "Show settings" })).toHaveCount(0);
    await expect(page.getByLabel("Timer settings")).toHaveCount(0);
    await expect(page.getByLabel("Focus minutes")).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "Generated Ambience" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Focus" })).toHaveCount(0);
  });

  test("does not expose obsolete generated ambience source from configuration", async () => {
    await page.getByRole("button", { name: "Return to dashboard" }).click();

    const dashboardPage = await waitForKuroneKoAppPage(browser, { label: "dashboard" });
    await expect(dashboardPage.getByLabel("KURONE-KO dashboard")).toBeVisible();
    await dashboardPage.getByRole("button", { name: "Configuration" }).click();
    await expect(dashboardPage.getByRole("heading", { name: "Configuration" })).toBeVisible();

    await expect(dashboardPage.getByRole("radio", { name: "Generated Ambience" })).toHaveCount(0);
    await expect(dashboardPage.getByRole("radio", { name: "Kurone-ko Playlist" })).toBeVisible();
  });

  test("persists Kurone-ko playlist source selection from configuration", async () => {
    await page.getByRole("button", { name: "Return to dashboard" }).click();

    const dashboardPage = await waitForKuroneKoAppPage(browser, { label: "dashboard" });
    await expect(dashboardPage.getByLabel("KURONE-KO dashboard")).toBeVisible();
    await dashboardPage.getByRole("button", { name: "Configuration" }).click();
    await expect(dashboardPage.getByRole("heading", { name: "Configuration" })).toBeVisible();

    await dashboardPage.getByRole("radio", { name: "Kurone-ko Playlist" }).click();

    await expect(dashboardPage.getByText("Kurone-ko Playlist configured for focus sessions")).toBeVisible();
    await expect(dashboardPage.getByRole("button", { name: "Deep Focus" })).toHaveCount(0);
    await expect(dashboardPage.getByRole("button", { name: "Nature Calm" })).toHaveCount(0);
    await expect(dashboardPage.getByRole("button", { name: "Lo-fi Flow" })).toHaveCount(0);
    await expect.poll(() => dashboardPage.evaluate(() => window.localStorage.getItem("kurone-ko.music.source"))).toBe("kuroneko-playlist");

    await dashboardPage.reload();
    await expect(dashboardPage.getByLabel("KURONE-KO dashboard")).toBeVisible();
    if (await dashboardPage.getByRole("dialog", { name: "Welcome to KURONE-KO" }).isVisible()) {
      await dashboardPage.keyboard.press("Escape");
    }
    await dashboardPage.getByRole("button", { name: "Configuration" }).click();
    await expect(dashboardPage.getByRole("heading", { name: "Configuration" })).toBeVisible();
    await expect(dashboardPage.getByRole("radio", { name: "Kurone-ko Playlist" })).toBeChecked();
    await expect(dashboardPage.getByText("Kurone-ko Playlist configured for focus sessions")).toBeVisible();
  });

  test("starts the timer and decrements the displayed time", async () => {
    await setFastDurations(page, 3);
    await expect(page.getByText("00:03")).toBeVisible();

    await page.getByRole("button", { name: "Start" }).click();

    await expect(page.getByText("00:02")).toBeVisible({ timeout: 2_500 });
  });

  test("completes a test-safe focus session and keeps sub-minute sessions out of history", async () => {
    await setFastDurations(page, 1);

    await page.getByRole("button", { name: "Start" }).click();

    await expect(page.getByLabel("Pomodoro session complete")).toBeVisible({ timeout: 3_000 });

    await expect.poll(() => getViewportSize(page)).toEqual(TIMER_VIEWPORT);

    const timerCardFrame = await page.locator(".timer-card").evaluate<CardFrameSnapshot>((element) => {
      const rect = element.getBoundingClientRect();
      const styles = window.getComputedStyle(element);

      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
        borderRadius: Number.parseFloat(styles.borderTopLeftRadius),
        boxShadow: styles.boxShadow,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    });

    expectRoundedCardFrame(timerCardFrame, TIMER_VIEWPORT, MAX_TIMER_GUTTER_PX);
    expect(timerCardFrame.borderRadius).toBeLessThanOrEqual(12);

    const sessionCompleteChildren = await page.locator(".session-complete-panel > *").evaluateAll<ElementLayoutSnapshot[]>((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();

        return {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          text: element.textContent?.trim() ?? "",
          top: rect.top,
          width: rect.width,
        };
      }),
    );

    expect(sessionCompleteChildren.map((child) => child.text)).toEqual([
      "KURONE-KO · Session complete",
      "Goal done",
      "0 focused minutes saved",
      "1/1 focus blocks",
      "Start againHistory",
    ]);

    for (const childBounds of sessionCompleteChildren) {
      expectBoundsInsideViewport(childBounds, TIMER_VIEWPORT);
    }

    await page.getByRole("button", { name: "History", exact: true }).click();

    await expect(page.getByText("Today: 0 sessions · 0 min")).toBeVisible();
    await expect(page.getByText("0 min focus")).toHaveCount(0);
  });

  test("stops Kurone-ko Playlist when the focus session completes", async () => {
    await setFastDurations(page, 1);
    await page.getByRole("button", { name: "Play Kurone-ko Playlist" }).click();

    await expect(page.getByRole("button", { name: "Stop Kurone-ko Playlist" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => getMusicState(page)).toMatchObject({ enabled: true, isPlaying: true, ducked: false });

    await page.getByRole("button", { name: "Start" }).click();

    await expect(page.getByLabel("Pomodoro session complete")).toBeVisible({ timeout: 3_000 });
    await expect.poll(() => getMusicState(page)).toMatchObject({ enabled: false, isPlaying: false, ducked: false });
    await expect(page.getByRole("button", { name: "Play Kurone-ko Playlist" })).toHaveAttribute("aria-pressed", "false");
  });

  const relaunchForNativeClose = async (): Promise<Page> => {
    await browser.close();
    if (await isCdpAvailable(CDP_ENDPOINT)) {
      throw new Error(`Refusing to launch while CDP is already available at ${CDP_ENDPOINT}`);
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
    if (childProcess.pid === undefined) throw new Error("Failed to relaunch test-owned tauri dev process");
    let launchedInfo = null;
    try {
      launchedInfo = await waitForLauncherProcessInfo(childProcess.pid);
      await writeProcessInfo(PROCESS_INFO_FILE, launchedInfo);
      await waitForCdp(childProcess, CDP_ENDPOINT);
      launchedInfo = await waitForTauriAppProcess(childProcess.pid);
      await writeProcessInfo(PROCESS_INFO_FILE, launchedInfo);
      browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    } catch (error) {
      if (launchedInfo !== null) {
        try {
          await stopOwnedLauncher(launchedInfo);
          await cleanupProcessInfoFile(PROCESS_INFO_FILE);
        } catch (cleanupError) {
          console.error(`[e2e relaunch] Could not confirm cleanup of owned launcher ${launchedInfo.launcherPid}; preserving ${PROCESS_INFO_FILE}: ${String(cleanupError)}`);
        }
      }
      throw error;
    }
    const dashboardPage = await waitForKuroneKoAppPage(browser, { label: "dashboard" });
    await expect(dashboardPage.getByLabel("KURONE-KO dashboard")).toBeVisible();
    await dismissDashboardOnboarding(dashboardPage);
    const processInfo = await readProcessInfo(PROCESS_INFO_FILE);
    if (processInfo === null || !isTauriAppProcessInfo(processInfo)) throw new Error("Expected process identity for relaunched test app");
    await startAppProcessTracking(processInfo);
    return dashboardPage;
  };

  test("exits app process after dashboard Exit and native dashboard/timer close with real playlist audio", async () => {
    test.setTimeout(180_000);
    const initialProcess = await readProcessInfo(PROCESS_INFO_FILE);
    if (initialProcess === null || !isTauriAppProcessInfo(initialProcess)) throw new Error("Expected process identity for dashboard Exit");
    await startAppProcessTracking(initialProcess);
    await page.getByRole("button", { name: "Play Kurone-ko Playlist" }).click();
    await expect(page.getByRole("button", { name: "Stop Kurone-ko Playlist" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => getMusicState(page)).toMatchObject({ enabled: true, isPlaying: true });
    await expect.poll(() => getAudioEvidence(page)).toMatchObject({ paused: false });
    expect((await getAudioEvidence(page))?.source).toContain("/audio/kuroneko-playlist/");

    await page.getByRole("button", { name: "Return to dashboard" }).click();
    const dashboardPage = await waitForKuroneKoAppPage(browser, { label: "dashboard" });
    await expect(dashboardPage.getByLabel("KURONE-KO dashboard")).toBeVisible();

    logShutdownStage("dashboardExit", "start", initialProcess);
    await dashboardPage.getByRole("button", { name: "Exit Kurone-ko Timer" }).click();
    await assertKuroneKoShutdown();
    logShutdownStage("dashboardExit", "complete", initialProcess);

    const nativeDashboardPage = await relaunchForNativeClose();
    await nativeDashboardPage.getByRole("button", { name: "Start Session" }).click();
    const dashboardCloseTimerPage = await waitForKuroneKoAppPage(browser, { label: "timer" });
    await prepareTimerForE2E(dashboardCloseTimerPage);
    await dashboardCloseTimerPage.getByRole("button", { name: "Play Kurone-ko Playlist" }).click();
    await expect.poll(() => getMusicState(dashboardCloseTimerPage)).toMatchObject({ enabled: true, isPlaying: true });
    await expect.poll(() => getAudioEvidence(dashboardCloseTimerPage)).toMatchObject({ paused: false });
    expect((await getAudioEvidence(dashboardCloseTimerPage))?.source).toContain("/audio/kuroneko-playlist/");
    await dashboardCloseTimerPage.getByRole("button", { name: "Return to dashboard" }).click();
    const dashboardForClose = await waitForKuroneKoAppPage(browser, { label: "dashboard" });
    await expect(dashboardForClose.getByLabel("KURONE-KO dashboard")).toBeVisible();
    const dashboardProcess = await readProcessInfo(PROCESS_INFO_FILE);
    if (dashboardProcess === null || !isTauriAppProcessInfo(dashboardProcess)) throw new Error("Expected process identity for native dashboard close");
    logShutdownStage("nativeDashboard", "start", dashboardProcess);
    await closeOwnedVisibleWindow(dashboardProcess);
    await waitForShutdown(dashboardProcess, CDP_ENDPOINT);
    logShutdownStage("nativeDashboard", "complete", dashboardProcess);

    const dashboardForTimer = await relaunchForNativeClose();
    await dashboardForTimer.getByRole("button", { name: "Start Session" }).click();
    const timerPage = await waitForKuroneKoAppPage(browser, { label: "timer" });
    await expect(timerPage.getByLabel("KURONE-KO focus timer; drag empty areas to move")).toBeVisible();
    await prepareTimerForE2E(timerPage);
    await timerPage.getByRole("button", { name: "Play Kurone-ko Playlist" }).click();
    await expect.poll(() => getMusicState(timerPage)).toMatchObject({ enabled: true, isPlaying: true });
    await expect.poll(() => getAudioEvidence(timerPage)).toMatchObject({ paused: false });
    expect((await getAudioEvidence(timerPage))?.source).toContain("/audio/kuroneko-playlist/");
    const timerProcess = await readProcessInfo(PROCESS_INFO_FILE);
    if (timerProcess === null || !isTauriAppProcessInfo(timerProcess)) throw new Error("Expected process identity for native timer close");
    logShutdownStage("nativeTimer", "start", timerProcess);
    await closeOwnedVisibleWindow(timerProcess);
    await waitForShutdown(timerProcess, CDP_ENDPOINT);
    logShutdownStage("nativeTimer", "complete", timerProcess);
  });
});
