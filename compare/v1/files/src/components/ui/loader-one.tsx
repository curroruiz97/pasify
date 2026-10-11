/**
 * Pasify in-app loader (Suspense fallback, auth guards, bridge…).
 * Identical visual identity to the inline boot splash in `index.html` so
 * any transition between them is seamless: dark radial gradient, Pasify
 * wordmark, three bouncing terracotta dots. No gray bg, no blue spinner.
 */
const LoaderOne = ({ compact = false }: { compact?: boolean }) => {
  if (compact) {
    return (
      <div
        aria-label="Cargando"
        role="status"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "rgba(232, 84, 42, 0.85)",
              animation: "pasify-bounce 1.4s ease-in-out infinite both",
              animationDelay: `${i * 0.16}s`,
              display: "inline-block",
            }}
          />
        ))}
        <style>{`@keyframes pasify-bounce { 0%,80%,100% { transform: translateY(0); opacity: 0.5 } 40% { transform: translateY(-6px); opacity: 1 } }`}</style>
      </div>
    );
  }

  return (
    <div
      aria-label="Cargando Pasify"
      role="status"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at 50% 40%, #1a0e05 0%, #0a0a0a 70%)",
        margin: 0,
        padding: 0,
        border: 0,
        outline: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: 280,
          maxWidth: "60vw",
          animation: "pasify-loader-pulse 2s ease-in-out infinite",
          userSelect: "none",
          display: "block",
        }}
      >
        <img
          src="/pasify-logo.png"
          alt="Pasify"
          width={280}
          height={120}
          decoding="async"
          draggable={false}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
            border: 0,
            outline: 0,
            WebkitUserDrag: "none" as unknown as string,
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        />
      </div>
      <div
        style={{
          marginTop: 28,
          display: "flex",
          gap: 6,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "rgba(232, 84, 42, 0.85)",
              animation: "pasify-loader-bounce 1.4s ease-in-out infinite both",
              animationDelay: `${i * 0.16}s`,
              display: "inline-block",
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes pasify-loader-pulse  { 0%,100% { transform: scale(1) } 50% { transform: scale(1.05) } }
        @keyframes pasify-loader-bounce { 0%,80%,100% { transform: translateY(0); opacity: 0.5 } 40% { transform: translateY(-8px); opacity: 1 } }
      `}</style>
    </div>
  );
};

export default LoaderOne;
