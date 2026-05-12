import { useEffect, useRef } from "react";

const MUSIC_SRC = "/music_quiz.mp3";
const FADE_DURATION = 800;
const MAX_VOLUME = 0.35;
const FADE_STEPS = 20;

let sharedAudioEl: HTMLAudioElement | null = null;
let activeListeners = 0;
let currentFadeTimer: ReturnType<typeof setInterval> | null = null;

function clearFadeTimer() {
  if (currentFadeTimer) {
    clearInterval(currentFadeTimer);
    currentFadeTimer = null;
  }
}

function fadeTo(target: number, onDone?: () => void) {
  clearFadeTimer();
  const audio = sharedAudioEl;
  if (!audio) {
    onDone?.();
    return;
  }

  const stepTime = FADE_DURATION / FADE_STEPS;
  const start = audio.volume;
  const delta = (target - start) / FADE_STEPS;
  let step = 0;

  currentFadeTimer = setInterval(() => {
    step++;
    if (!sharedAudioEl || step >= FADE_STEPS) {
      clearFadeTimer();
      if (sharedAudioEl) sharedAudioEl.volume = Math.max(0, Math.min(1, target));
      onDone?.();
      return;
    }
    sharedAudioEl.volume = Math.max(0, Math.min(1, start + delta * step));
  }, stepTime);
}

function getOrCreateAudio(): HTMLAudioElement {
  if (sharedAudioEl) return sharedAudioEl;

  const el = document.createElement("audio");
  el.src = MUSIC_SRC;
  el.loop = true;
  el.volume = 0;
  el.preload = "auto";
  el.setAttribute("playsinline", "true");
  el.style.display = "none";
  document.body.appendChild(el);
  sharedAudioEl = el;
  return el;
}

function destroyAudio() {
  clearFadeTimer();
  if (sharedAudioEl) {
    sharedAudioEl.pause();
    sharedAudioEl.currentTime = 0;
    sharedAudioEl.volume = 0;
    sharedAudioEl.remove();
    sharedAudioEl = null;
  }
}

export const useQuizMusic = (enabled = true) => {
  const mountedRef = useRef(true);

  useEffect(() => {
    const musicOff = localStorage.getItem("quiz_music_off") === "true";
    if (!enabled || musicOff) return;
    mountedRef.current = true;

    const audio = getOrCreateAudio();
    activeListeners++;

    const tryPlay = () => {
      if (!mountedRef.current) return;
      const p = audio.play();
      if (p) {
        p.then(() => fadeTo(MAX_VOLUME)).catch(() => {});
      }
    };

    const p = audio.play();
    if (p) {
      p.then(() => fadeTo(MAX_VOLUME)).catch(() => {
        const resume = () => {
          tryPlay();
          document.removeEventListener("click", resume);
          document.removeEventListener("touchstart", resume);
        };
        document.addEventListener("click", resume, { once: true });
        document.addEventListener("touchstart", resume, { once: true });
      });
    }

    // Listen for settings toggle
    const handleToggle = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.on === false && sharedAudioEl) {
        fadeTo(0, () => {
          sharedAudioEl?.pause();
        });
      } else if (detail?.on === true && sharedAudioEl) {
        const pp = sharedAudioEl.play();
        if (pp) pp.then(() => fadeTo(MAX_VOLUME)).catch(() => {});
      }
    };
    window.addEventListener("quiz-music-toggle", handleToggle);

    return () => {
      mountedRef.current = false;
      activeListeners--;
      window.removeEventListener("quiz-music-toggle", handleToggle);

      if (activeListeners <= 0) {
        activeListeners = 0;
        if (sharedAudioEl && !sharedAudioEl.paused) {
          fadeTo(0, () => destroyAudio());
        } else {
          destroyAudio();
        }
      }
    };
  }, [enabled]);
};
