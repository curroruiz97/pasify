let audioEl: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement {
  if (audioEl) return audioEl;
  const el = document.createElement("audio");
  el.src = "/button_press.mp3";
  el.preload = "auto";
  el.setAttribute("playsinline", "true");
  el.style.display = "none";
  document.body.appendChild(el);
  audioEl = el;
  return el;
}

export const playButtonSound = () => {
  const audio = getAudio();
  audio.currentTime = 0;
  audio.volume = 0.5;
  audio.play().catch(() => {});
};
