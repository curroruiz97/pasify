import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";

interface VoiceRecorderProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  onCancel: () => void;
}

const VoiceRecorder = ({ onRecordingComplete, onCancel }: VoiceRecorderProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(40).fill(0));
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const selectedMimeTypeRef = useRef<string>("");
  const { t } = useTranslation();

  useEffect(() => {
    return () => {
      stopRecording();
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  const startRecording = async () => {
    try {
      // On Android, we need to check/request microphone permission first
      if (Capacitor.isNativePlatform()) {
        // Request permission through the browser API which triggers Android permission dialog
        try {
          const permissionResult = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          if (permissionResult.state === 'denied') {
            toast.error(t('chatMedia.microphonePermissionDenied'));
            return;
          }
        } catch (permError) {
          // Some browsers don't support permissions.query for microphone
          console.log('Permissions API not fully supported, proceeding with getUserMedia');
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,  // Disable for better quality
          noiseSuppression: false,  // Disable for better quality
          autoGainControl: false,   // Disable for better quality
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 1 },  // Mono is fine for voice
        }
      });

      // Setup audio context for visualization
      audioContextRef.current = new AudioContext({ sampleRate: 48000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      // Start visualization
      visualizeAudio();

      // Setup media recorder with best supported mime type and high bitrate
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/wav'
      ];
      const supported = candidates.filter((type) => {
        // @ts-ignore
        return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported ? MediaRecorder.isTypeSupported(type) : true;
      });
      const chosenMime = supported[0] || '';

      // Use higher bitrate for better quality (128kbps)
      const options: MediaRecorderOptions = {
        ...(chosenMime ? { mimeType: chosenMime } : {}),
        audioBitsPerSecond: 128000,
      };
      const mediaRecorder = new MediaRecorder(stream, options);
      selectedMimeTypeRef.current = mediaRecorder.mimeType || chosenMime || '';
      
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blobType = selectedMimeTypeRef.current || mediaRecorderRef.current?.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: blobType });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
        if (audioContextRef.current) {
          audioContextRef.current.close();
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('Error accessing microphone:', error);
      toast.error(t('chatMedia.errorCapture'));
    }
  };

  const visualizeAudio = () => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    
    const updateVisualization = () => {
      if (!analyserRef.current) return;
      
      analyserRef.current.getByteFrequencyData(dataArray);
      
      // Calculate average volume
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      
      // Update levels array (shift left and add new value)
      setAudioLevels(prev => {
        const newLevels = [...prev.slice(1), average / 255];
        return newLevels;
      });

      animationFrameRef.current = requestAnimationFrame(updateVisualization);
    };

    updateVisualization();
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }
  };

  const handleSend = () => {
    if (audioBlob) {
      onRecordingComplete(audioBlob);
    }
  };

  const handleCancel = () => {
    stopRecording();
    setAudioBlob(null);
    setRecordingTime(0);
    setAudioLevels(new Array(40).fill(0));
    onCancel();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between">
        <span className="font-semibold">{t('chatMedia.voiceMessage')}</span>
      </div>

      {/* Visualization */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="mb-8">
          <div className="w-32 h-32 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
            <Mic className="w-16 h-16 text-primary" />
          </div>
        </div>

        {/* Audio Wave Visualization */}
        <div className="w-full max-w-md h-24 flex items-center justify-center gap-1 px-4">
          {audioLevels.map((level, index) => (
            <div
              key={index}
              className="flex-1 bg-primary rounded-full transition-all duration-100"
              style={{
                height: `${Math.max(4, level * 80)}px`,
                opacity: isRecording ? 0.3 + (level * 0.7) : 0.3
              }}
            />
          ))}
        </div>

        {/* Timer */}
        <div className="mt-8 text-3xl font-bold text-primary">
          {formatTime(recordingTime)}
        </div>

        <p className="text-sm text-muted-foreground mt-4">
          {isRecording ? t('chatMedia.recording') : audioBlob ? t('chatMedia.recordingComplete') : t('chatMedia.pressToStart')}
        </p>
      </div>

      {/* Controls */}
      <div className="p-6 border-t">
        <div className="flex items-center justify-center gap-4">
          {!isRecording && !audioBlob && (
            <Button
              size="lg"
              onClick={startRecording}
              className="w-20 h-20 rounded-full"
            >
              <Mic className="w-8 h-8" />
            </Button>
          )}

          {isRecording && (
            <Button
              size="lg"
              variant="destructive"
              onClick={stopRecording}
              className="w-20 h-20 rounded-full"
            >
              <Square className="w-8 h-8" />
            </Button>
          )}

          {audioBlob && !isRecording && (
            <>
              <Button
                size="lg"
                variant="outline"
                onClick={handleCancel}
                className="w-16 h-16 rounded-full"
              >
                <X className="w-6 h-6" />
              </Button>
              <Button
                size="lg"
                onClick={handleSend}
                className="w-20 h-20 rounded-full"
              >
                <Send className="w-8 h-8" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default VoiceRecorder;
