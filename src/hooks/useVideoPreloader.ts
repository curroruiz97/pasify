import { useEffect, useRef, useCallback } from "react";

// Cache per i video precaricati
const videoCache = new Map<string, HTMLVideoElement>();
const preloadQueue: string[] = [];
const MAX_CACHED_VIDEOS = 10;
const PRELOAD_AHEAD = 3; // Numero di video da precaricare in anticipo

// Pulisce i video più vecchi dalla cache
const cleanupCache = () => {
  while (videoCache.size > MAX_CACHED_VIDEOS) {
    const firstKey = videoCache.keys().next().value;
    if (firstKey) {
      const video = videoCache.get(firstKey);
      if (video) {
        video.src = "";
        video.load();
      }
      videoCache.delete(firstKey);
    }
  }
};

// Precarica un singolo video
const preloadVideo = (url: string): Promise<HTMLVideoElement> => {
  return new Promise((resolve, reject) => {
    // Se già in cache, restituisci
    if (videoCache.has(url)) {
      resolve(videoCache.get(url)!);
      return;
    }

    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    video.onerror = () => {
      reject(new Error(`Failed to preload video: ${url}`));
    };

    // Timeout per evitare attese infinite
    const timeout = setTimeout(() => {
      if (!videoCache.has(url)) {
        videoCache.set(url, video); // Salva comunque parzialmente
      }
      resolve(video);
    }, 5000);

    video.oncanplaythrough = () => {
      clearTimeout(timeout);
      videoCache.set(url, video);
      cleanupCache();
      resolve(video);
    };

    video.src = url;
    video.load();
  });
};

// Hook principale
export const useVideoPreloader = (
  videos: Array<{ video_url?: string; image_url?: string }>,
  currentIndex: number
) => {
  const preloadingRef = useRef(new Set<string>());

  // Funzione per precarica video intorno all'indice corrente
  const preloadAround = useCallback(async () => {
    if (!videos.length) return;

    const urlsToPreload: string[] = [];

    // Precarica video precedenti e successivi
    for (let i = -1; i <= PRELOAD_AHEAD; i++) {
      const index = currentIndex + i;
      if (index >= 0 && index < videos.length) {
        const video = videos[index];
        const url = video.video_url || video.image_url;
        if (url && !videoCache.has(url) && !preloadingRef.current.has(url)) {
          urlsToPreload.push(url);
        }
      }
    }

    // Precarica in parallelo
    for (const url of urlsToPreload) {
      preloadingRef.current.add(url);
      preloadVideo(url)
        .catch(() => {})
        .finally(() => {
          preloadingRef.current.delete(url);
        });
    }
  }, [videos, currentIndex]);

  useEffect(() => {
    preloadAround();
  }, [preloadAround]);

  // Controlla se un video è in cache
  const isVideoCached = useCallback((url: string) => {
    return videoCache.has(url);
  }, []);

  // Ottieni un video dalla cache
  const getCachedVideo = useCallback((url: string) => {
    return videoCache.get(url);
  }, []);

  return {
    isVideoCached,
    getCachedVideo,
    preloadVideo,
    cacheSize: videoCache.size,
  };
};

// Export per uso diretto
export { preloadVideo, videoCache };
