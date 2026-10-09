import { SESSION_TYPE, useHistoryStore } from "../features/history/store";
import { useSettingsStore } from "../features/settings/store";
import { createSilentMusicAudioService } from "../features/music/audio";
import { createPlaylistAudioService } from "../features/music/playlist";
import { createMemoryMusicPreferenceRepository, useMusicStore, VOLUME_PRESETS } from "../features/music/store";
import { getCurrentWindow, Window as TauriWindow } from "@tauri-apps/api/window";
import {
  createIdleTimerState,
  DEFAULT_TIMER_SETTINGS,
  type TimerSettings,
} from "../features/timer/model";
import { useTimerStore } from "../features/timer/store";

interface KuroneKoE2EDriver {
  getAudioEvidence: () => KuroneKoAudioEvidence | null;
  getMusicState: () => KuroneKoMusicState;
  getWindowLabel: () => string;
  isWindowVisible: (label: string) => Promise<boolean>;
  reset: () => Promise<void>;
  setFastDurations: (settings: TimerSettings) => void;
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

let activeAudioElement: HTMLAudioElement | null = null;

declare global {
  interface Window {
    __KURONE_KO_E2E__?: KuroneKoE2EDriver;
  }
}

const isE2EMode = (): boolean =>
  import.meta.env.DEV && import.meta.env.VITE_KURONE_KO_E2E === "1";

const createE2EAudioService = () => {
  if (import.meta.env.MODE === "test") {
    return createSilentMusicAudioService();
  }

  return createPlaylistAudioService((src) => {
    activeAudioElement = new Audio(src);
    return activeAudioElement;
  });
};

const resetStores = (settings: TimerSettings = DEFAULT_TIMER_SETTINGS): void => {
  window.localStorage.removeItem("kurone-ko.music.source");
  useHistoryStore.setState({ sessions: [], hydrated: true, error: null });
  useSettingsStore.setState({ settings, hydrated: true, error: null });
  useTimerStore.setState({
    ...createIdleTimerState(settings),
    settings,
    hydrated: true,
  });
  activeAudioElement = null;
  useMusicStore.getState().configure(createE2EAudioService(), createMemoryMusicPreferenceRepository(false));
  useMusicStore.setState({
    ducked: false,
    enabled: false,
    error: null,
    hydrated: true,
    isPlaying: false,
    loading: false,
    source: "kuroneko-playlist",
    volume: VOLUME_PRESETS.normal,
  });
};

export const installKuroneKoE2EDriver = (): void => {
  if (!isE2EMode()) {
    return;
  }

  window.__KURONE_KO_E2E__ = {
    getAudioEvidence: () => activeAudioElement === null
      ? null
      : { paused: activeAudioElement.paused, source: activeAudioElement.currentSrc || activeAudioElement.src },
    getMusicState: () => {
      const { ducked, enabled, isPlaying } = useMusicStore.getState();

      return { ducked, enabled, isPlaying };
    },
    getWindowLabel: () => getCurrentWindow().label,
    isWindowVisible: async (label) => {
      const targetWindow = await TauriWindow.getByLabel(label);

      return targetWindow?.isVisible() ?? false;
    },
    reset: async () => {
      resetStores();
      await useSettingsStore.getState().resetSettings();
      resetStores();
    },
    setFastDurations: (settings) => {
      resetStores(settings);
    },
  };
};

export const createCompletedE2ESession = (completedAt: number, duration: number) => ({
  completedAt,
  durationSeconds: duration,
  type: SESSION_TYPE.FOCUS,
});
