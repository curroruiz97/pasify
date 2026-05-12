import { Play } from "lucide-react";

interface VideoSkeletonProps {
  className?: string;
  showPlayIcon?: boolean;
  variant?: "card" | "fullscreen";
}

const VideoSkeleton = ({
  className = "",
  showPlayIcon = true,
  variant = "card"
}: VideoSkeletonProps) => {
  if (variant === "fullscreen") {
    return (
      <div className={`absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center ${className}`}>
        {/* Animated background pattern */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-blue-500 rounded-full filter blur-3xl animate-pulse" />
            <div className="absolute bottom-1/4 right-1/4 w-48 h-48 bg-purple-500 rounded-full filter blur-3xl animate-pulse" style={{ animationDelay: "0.5s" }} />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-cyan-500 rounded-full filter blur-2xl animate-pulse" style={{ animationDelay: "1s" }} />
          </div>
        </div>

        {/* Loading spinner */}
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-white/20 rounded-full" />
            <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-white rounded-full animate-spin" />
            {showPlayIcon && (
              <Play className="absolute inset-0 m-auto w-6 h-6 text-white/80 fill-white/80" />
            )}
          </div>
          <div className="flex gap-1.5">
            <div className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        </div>
      </div>
    );
  }

  // Card variant (per PostCard)
  return (
    <div className={`relative bg-gradient-to-br from-gray-100 via-gray-50 to-gray-100 flex items-center justify-center min-h-[200px] ${className}`}>
      {/* Shimmer effect */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent"
          style={{
            animation: "shimmer 2s infinite",
          }}
        />
      </div>

      {/* Subtle gradient orbs */}
      <div className="absolute inset-0 overflow-hidden opacity-30">
        <div className="absolute top-1/3 left-1/4 w-24 h-24 bg-blue-200 rounded-full filter blur-2xl animate-pulse" />
        <div className="absolute bottom-1/3 right-1/4 w-20 h-20 bg-purple-200 rounded-full filter blur-2xl animate-pulse" style={{ animationDelay: "0.7s" }} />
      </div>

      {/* Loading indicator */}
      <div className="relative z-10 flex flex-col items-center gap-3">
        <div className="relative">
          <div className="w-12 h-12 border-3 border-gray-200 rounded-full" />
          <div className="absolute inset-0 w-12 h-12 border-3 border-transparent border-t-blue-400 rounded-full animate-spin" />
          {showPlayIcon && (
            <Play className="absolute inset-0 m-auto w-5 h-5 text-gray-400 fill-gray-400" />
          )}
        </div>
        <span className="text-xs text-gray-400 font-medium">Caricamento...</span>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

export default VideoSkeleton;
