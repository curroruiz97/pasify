interface QuizTimerRingProps {
  timeRemaining: number;
  size?: number;
}

const QuizTimerRing = ({ timeRemaining, size = 56 }: QuizTimerRingProps) => {
  const seconds = Math.ceil(timeRemaining / 1000);
  const progress = timeRemaining / 10000;
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  const getColor = () => {
    if (seconds > 5) return "#60a5fa"; // blue-400
    if (seconds > 3) return "#fbbf24"; // yellow
    return "#f87171"; // red
  };

  return (
    <div
      className={`relative flex items-center justify-center ${seconds <= 3 ? "quiz-timer-pulse" : ""}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="rgba(15,23,42,0.7)"
          stroke="rgba(96,165,250,0.2)"
          strokeWidth={5}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={getColor()}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: "stroke-dashoffset 0.05s linear" }}
        />
      </svg>
      <span
        className="absolute text-lg font-black drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
        style={{ color: getColor() }}
      >
        {seconds}
      </span>
    </div>
  );
};

export default QuizTimerRing;
