import { useState, useRef, useEffect } from "react";
import { Mic, X, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useToast } from "@/hooks/use-toast";

interface VoiceRecorderButtonProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  disabled?: boolean;
}

const VoiceRecorderButton = ({ onRecordingComplete, disabled }: VoiceRecorderButtonProps) => {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(40).fill(0));
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Setup audio context for visualization
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 256;
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      // Determine best supported MIME type
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/wav',
      ];
      
      const supportedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
      
      if (!supportedMimeType) {
        throw new Error("Nessun formato audio supportato dal browser");
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType: supportedMimeType });
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      // Start visualization
      visualizeAudio();
    } catch (error: any) {
      toast({
        title: "Error",
        description: "No se pudo acceder al micrófono. Verifica los permisos.",
        variant: "destructive",
      });
    }
  };

  const visualizeAudio = () => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const updateLevels = () => {
      analyser.getByteFrequencyData(dataArray);
      
      // Take samples and normalize to 0-1 range
      const samples = 40;
      const step = Math.floor(dataArray.length / samples);
      const newLevels = [];
      
      for (let i = 0; i < samples; i++) {
        const index = i * step;
        const value = dataArray[index] / 255;
        newLevels.push(value);
      }
      
      setAudioLevels(newLevels);
      animationFrameRef.current = requestAnimationFrame(updateLevels);
    };

    updateLevels();
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
  };

  const handleSend = async () => {
    stopRecording();
    
    // Wait a bit for the recording to finalize
    setTimeout(() => {
      if (audioChunksRef.current.length > 0) {
        const mimeTypes = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/mp4;codecs=mp4a.40.2',
          'audio/mp4',
          'audio/ogg;codecs=opus',
          'audio/ogg',
          'audio/wav',
        ];
        
        const supportedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: supportedMimeType });
        onRecordingComplete(audioBlob);
      }
      handleClose();
    }, 100);
  };

  const handleClose = () => {
    if (isRecording) {
      stopRecording();
    }
    cleanup();
    setIsOpen(false);
    setRecordingTime(0);
    setAudioLevels(new Array(40).fill(0));
    audioChunksRef.current = [];
  };

  const handleOpen = () => {
    if (disabled) return;
    setIsOpen(true);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="rounded-full flex-shrink-0"
        disabled={disabled}
        onClick={handleOpen}
      >
        <Mic className="w-5 h-5" />
      </Button>

      <Drawer open={isOpen} onOpenChange={setIsOpen}>
        <DrawerContent className="h-[400px]">
          <DrawerHeader>
            <DrawerTitle className="text-center">Mensaje de voz</DrawerTitle>
          </DrawerHeader>
          
          <div className="flex flex-col items-center justify-center h-full gap-6 pb-8">
            {/* Waveform visualization */}
            <div className="flex items-center justify-center gap-1 h-32">
              {audioLevels.map((level, index) => (
                <div
                  key={index}
                  className="w-1 rounded-full transition-all duration-100 bg-primary"
                  style={{
                    height: `${Math.max(4, level * 100)}px`,
                  }}
                />
              ))}
            </div>

            {/* Timer */}
            <div className="text-2xl font-mono font-bold">
              {formatTime(recordingTime)}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4">
              {!isRecording ? (
                <Button
                  onClick={startRecording}
                  size="lg"
                  className="rounded-full w-16 h-16 bg-primary hover:bg-primary/90"
                >
                  <Mic className="w-6 h-6" />
                </Button>
              ) : (
                <>
                  <Button
                    onClick={stopRecording}
                    size="lg"
                    variant="destructive"
                    className="rounded-full w-16 h-16"
                  >
                    <Square className="w-6 h-6" />
                  </Button>
                  <Button
                    onClick={handleSend}
                    size="lg"
                    className="rounded-full w-16 h-16 bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90"
                  >
                    <Send className="w-6 h-6" />
                  </Button>
                </>
              )}
            </div>

            {/* Instructions */}
            <div className="text-sm text-muted-foreground text-center">
              {!isRecording ? (
                <p>Toca el micrófono para comenzar a grabar</p>
              ) : (
                <p>Toca el botón azul para enviar</p>
              )}
            </div>

            {/* Close button */}
            <Button
              onClick={handleClose}
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
};

export default VoiceRecorderButton;
