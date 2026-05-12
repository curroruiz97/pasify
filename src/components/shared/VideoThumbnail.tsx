import { useState, useEffect } from "react";
import { Play, Loader2 } from "lucide-react";

interface VideoThumbnailProps {
  videoUrl: string;
  thumbnailUrl?: string | null;
  className?: string;
  showPlayIcon?: boolean;
  onClick?: () => void;
}

const VideoThumbnail = ({ videoUrl, thumbnailUrl, className = "", showPlayIcon = false, onClick }: VideoThumbnailProps) => {
  const [thumbnail, setThumbnail] = useState<string | null>(thumbnailUrl || null);
  const [loading, setLoading] = useState(!thumbnailUrl);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (thumbnailUrl) {
      setThumbnail(thumbnailUrl);
      setLoading(false);
      setFailed(false);
      return;
    }
    if (videoUrl) {
      generateThumbnail(videoUrl);
    }
  }, [videoUrl, thumbnailUrl]);

  const generateThumbnail = (url: string) => {
    setLoading(true);
    setThumbnail(null);
    setFailed(false);

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.setAttribute('webkit-playsinline', 'true');

    let done = false;
    let attempts = 0;
    const maxAttempts = 3;

    const captureFrame = () => {
      if (done) return;

      try {
        const canvas = document.createElement('canvas');
        const w = video.videoWidth || 320;
        const h = video.videoHeight || 568;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx && video.videoWidth > 0) {
          ctx.drawImage(video, 0, 0, w, h);

          // Detect black frame: sample pixels from the center area
          const imageData = ctx.getImageData(
            Math.floor(w * 0.25), Math.floor(h * 0.25),
            Math.floor(w * 0.5), Math.floor(h * 0.5)
          );
          const pixels = imageData.data;
          let nonBlackPixels = 0;
          // Sample every 40th pixel for performance
          for (let i = 0; i < pixels.length; i += 160) {
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
            if (r > 15 || g > 15 || b > 15) {
              nonBlackPixels++;
            }
          }
          const totalSampled = Math.floor(pixels.length / 160);
          const nonBlackRatio = totalSampled > 0 ? nonBlackPixels / totalSampled : 0;

          // If more than 5% of pixels are non-black, it's a valid frame
          if (nonBlackRatio > 0.05) {
            done = true;
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            setThumbnail(dataUrl);
            setLoading(false);
            cleanup();
            return;
          }
        }
      } catch (e) {
        // Canvas tainted by CORS — fall through to retry or fail
        console.log('Canvas capture failed:', e);
      }

      attempts++;
      if (attempts >= maxAttempts) {
        done = true;
        setLoading(false);
        setFailed(true);
        cleanup();
      } else {
        // Try progressively later frames
        video.currentTime = attempts * 1.5;
      }
    };

    const cleanup = () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    video.onloadedmetadata = () => {
      // Seek to 1s or 10% of duration, whichever is smaller
      video.currentTime = Math.min(1, video.duration * 0.1);
    };

    video.onseeked = captureFrame;

    video.onerror = () => {
      if (!done) {
        done = true;
        setLoading(false);
        setFailed(true);
      }
    };

    // Timeout: don't block forever
    const timeoutId = setTimeout(() => {
      if (!done) {
        done = true;
        setLoading(false);
        setFailed(true);
        cleanup();
      }
    }, 6000);

    video.src = url;
    video.load();

    return () => {
      clearTimeout(timeoutId);
      if (!done) cleanup();
    };
  };

  // If the pre-generated thumbnail URL fails to load, retry with canvas
  const handleImageError = () => {
    setThumbnail(null);
    if (videoUrl) {
      generateThumbnail(videoUrl);
    } else {
      setFailed(true);
    }
  };

  if (loading) {
    return (
      <div
        className={`bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center ${className}`}
        onClick={onClick}
      >
        <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
      </div>
    );
  }

  // Successful thumbnail (pre-generated URL or canvas-captured)
  if (thumbnail && !failed) {
    return (
      <div className={`relative overflow-hidden ${className}`} onClick={onClick}>
        <img
          src={thumbnail}
          alt=""
          className="w-full h-full object-cover"
          onError={handleImageError}
        />
        {showPlayIcon && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
              <Play className="w-4 h-4 text-blue-500 ml-0.5" fill="currentColor" />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Fallback: gradient placeholder with play icon (never shows a black frame)
  return (
    <div
      className={`bg-gradient-to-br from-violet-100 to-blue-200 dark:from-violet-900/40 dark:to-blue-900/40 flex items-center justify-center ${className}`}
      onClick={onClick}
    >
      <div className="w-10 h-10 rounded-full bg-white/90 dark:bg-white/20 flex items-center justify-center shadow-lg">
        <Play className="w-5 h-5 text-blue-500 dark:text-blue-300 ml-0.5" fill="currentColor" />
      </div>
    </div>
  );
};

export default VideoThumbnail;
