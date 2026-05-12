import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause } from "lucide-react";

interface VoiceMessagePlayerProps {
  audioUrl: string;
  isOwn: boolean;
}

const VoiceMessagePlayer = ({ audioUrl, isOwn }: VoiceMessagePlayerProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(30).fill(0.3));
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const sourceConnectedRef = useRef(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      // Simple visualization based on time
      if (isPlaying) {
        updateSimpleVisualization();
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      setAudioLevels(new Array(30).fill(0.3));
    };

    const handleError = (e: Event) => {
      console.error('Audio error:', e);
      setIsPlaying(false);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying]);

  const updateSimpleVisualization = () => {
    // Generate pseudo-random levels based on time for visual effect
    const newLevels = audioLevels.map((_, index) => {
      const baseLevel = 0.3;
      const variation = Math.sin(Date.now() / 100 + index * 0.5) * 0.3 + 0.3;
      return Math.min(1, baseLevel + variation);
    });
    setAudioLevels(newLevels);
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        setAudioLevels(new Array(30).fill(0.3));
      } else {
        // Reset to beginning if at end
        if (audio.ended || audio.currentTime >= audio.duration) {
          audio.currentTime = 0;
        }

        // Play the audio
        await audio.play();
        setIsPlaying(true);

        // Start simple visualization animation
        const animate = () => {
          if (audioRef.current && !audioRef.current.paused) {
            updateSimpleVisualization();
            animationFrameRef.current = requestAnimationFrame(animate);
          }
        };
        animate();
      }
    } catch (error) {
      console.error('Error playing audio:', error);
      setIsPlaying(false);
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`flex items-center gap-2 min-w-[200px] max-w-[280px] ${isOwn ? 'flex-row' : 'flex-row'}`}>
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="auto"
        playsInline
      />

      {/* Play/Pause Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={togglePlay}
        className={`rounded-full flex-shrink-0 h-9 w-9 ${
          isOwn
            ? 'text-primary-foreground hover:bg-primary-foreground/20'
            : 'text-foreground hover:bg-foreground/10'
        }`}
      >
        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
      </Button>

      {/* Waveform Visualization */}
      <div className="flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-0.5 h-8">
          {audioLevels.map((level, index) => {
            const isPassed = progress > 0 && (index / audioLevels.length) * 100 < progress;
            return (
              <div
                key={index}
                className={`flex-1 rounded-full transition-all duration-100 ${
                  isOwn
                    ? isPassed
                      ? 'bg-primary-foreground'
                      : 'bg-primary-foreground/30'
                    : isPassed
                    ? 'bg-primary'
                    : 'bg-foreground/30'
                }`}
                style={{
                  height: `${Math.max(12, (isPlaying ? level : 0.3) * 100)}%`,
                  minHeight: '3px'
                }}
              />
            );
          })}
        </div>

        {/* Duration */}
        <div className={`text-[10px] ${isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
          {formatTime(isPlaying ? currentTime : duration)}
        </div>
      </div>
    </div>
  );
};

export default VoiceMessagePlayer;
