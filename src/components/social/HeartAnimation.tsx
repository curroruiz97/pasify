import { motion } from "framer-motion";

interface HeartAnimationProps {
  show: boolean;
}

const HeartAnimation = ({ show }: HeartAnimationProps) => {
  if (!show) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
      {/* Main heart with 3D-like effect */}
      <motion.div
        initial={{ scale: 0, rotate: -15 }}
        animate={{ 
          scale: [0, 1.3, 0.9, 1.1, 1, 0],
          rotate: [-15, 0, 5, -3, 0, 0],
          opacity: [0, 1, 1, 1, 1, 0]
        }}
        transition={{ 
          duration: 1.2,
          times: [0, 0.2, 0.35, 0.5, 0.65, 1],
          ease: "easeOut"
        }}
        className="relative"
      >
        {/* Shadow layer for 3D depth */}
        <motion.svg
          viewBox="0 0 24 24"
          className="w-28 h-28 absolute top-1 left-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.3, 0.3, 0] }}
          transition={{ duration: 1.2 }}
        >
          <path
            d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
            fill="rgba(0,0,0,0.3)"
          />
        </motion.svg>

        {/* Main heart with gradient */}
        <svg viewBox="0 0 24 24" className="w-28 h-28 relative">
          <defs>
            <linearGradient id="heartGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ff4d6d" />
              <stop offset="50%" stopColor="#ff1744" />
              <stop offset="100%" stopColor="#c51162" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          <path
            d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
            fill="url(#heartGradient)"
            filter="url(#glow)"
            className="drop-shadow-2xl"
          />
          {/* Highlight for 3D effect */}
          <path
            d="M8.5 6.5a3 3 0 0 0-2.12.88 3 3 0 0 0 0 4.24L12 17.24l.5-.5"
            fill="none"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>

        {/* Particle effects */}
        {[...Array(8)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute top-1/2 left-1/2 w-2 h-2 rounded-full bg-red-400"
            initial={{ 
              x: 0, 
              y: 0, 
              scale: 0,
              opacity: 1 
            }}
            animate={{ 
              x: Math.cos((i * Math.PI * 2) / 8) * 60,
              y: Math.sin((i * Math.PI * 2) / 8) * 60,
              scale: [0, 1, 0],
              opacity: [1, 1, 0]
            }}
            transition={{ 
              duration: 0.8,
              delay: 0.15,
              ease: "easeOut"
            }}
          />
        ))}

        {/* Ring burst effect */}
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border-4 border-red-400 rounded-full"
          initial={{ width: 0, height: 0, opacity: 0.8 }}
          animate={{ 
            width: 150, 
            height: 150, 
            opacity: 0,
          }}
          transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
        />
      </motion.div>
    </div>
  );
};

export default HeartAnimation;