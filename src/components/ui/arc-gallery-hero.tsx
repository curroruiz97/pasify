import React, { useEffect, useState } from "react";

// ArcGalleryHero — arch of poster cards rising from the bottom of the
// hero. Adapted from the original "memories" template: removed the
// hardcoded CTA + headline so the parent (Calendar / partner page) owns
// the copy, and made the section height fit-content rather than
// min-h-screen so it sits above other content instead of taking over
// the viewport.

type ArcGalleryHeroProps = {
  images: string[];
  startAngle?: number;
  endAngle?: number;
  // radius for different screen sizes
  radiusLg?: number;
  radiusMd?: number;
  radiusSm?: number;
  // size of each card for different screen sizes
  cardSizeLg?: number;
  cardSizeMd?: number;
  cardSizeSm?: number;
  className?: string;
  children?: React.ReactNode;
};

export const ArcGalleryHero: React.FC<ArcGalleryHeroProps> = ({
  images,
  startAngle = 20,
  endAngle = 160,
  radiusLg = 480,
  radiusMd = 360,
  radiusSm = 220,
  cardSizeLg = 130,
  cardSizeMd = 100,
  cardSizeSm = 70,
  className = "",
  children,
}) => {
  const [dimensions, setDimensions] = useState({
    radius: radiusLg,
    cardSize: cardSizeLg,
  });

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 640) {
        setDimensions({ radius: radiusSm, cardSize: cardSizeSm });
      } else if (width < 1024) {
        setDimensions({ radius: radiusMd, cardSize: cardSizeMd });
      } else {
        setDimensions({ radius: radiusLg, cardSize: cardSizeLg });
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [radiusLg, radiusMd, radiusSm, cardSizeLg, cardSizeMd, cardSizeSm]);

  const count = Math.max(images.length, 2);
  const step = (endAngle - startAngle) / (count - 1);

  return (
    <section
      className={`relative flex flex-col overflow-hidden bg-background text-foreground ${className}`}
    >
      {/* Arc container — height tuned to the radius so the cards never clip */}
      <div
        className="relative mx-auto"
        style={{
          width: "100%",
          height: dimensions.radius * 1.05,
        }}
      >
        {/* Pivot at the bottom-center of the section */}
        <div className="absolute left-1/2 bottom-0 -translate-x-1/2">
          {images.map((src, i) => {
            const angle = startAngle + step * i;
            const angleRad = (angle * Math.PI) / 180;

            const x = Math.cos(angleRad) * dimensions.radius;
            const y = Math.sin(angleRad) * dimensions.radius;

            return (
              <div
                key={`${src}-${i}`}
                className="absolute opacity-0 animate-arc-fade-in-up"
                style={{
                  width: dimensions.cardSize,
                  height: dimensions.cardSize,
                  left: `calc(50% + ${x}px)`,
                  bottom: `${y}px`,
                  transform: "translate(-50%, 50%)",
                  animationDelay: `${i * 80}ms`,
                  animationFillMode: "forwards",
                  zIndex: count - i,
                }}
              >
                <div
                  className="h-full w-full overflow-hidden rounded-2xl bg-black shadow-xl ring-1 ring-white/10 transition-transform hover:scale-105"
                  style={{ transform: `rotate(${angle / 4}deg)` }}
                >
                  <img
                    src={src}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    className="block h-full w-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.opacity = "0";
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Optional caller-provided overlay (title / subtitle) */}
      {children && (
        <div className="relative z-10 -mt-32 px-6 pb-4 text-center sm:-mt-40 lg:-mt-48">
          {children}
        </div>
      )}

      <style>{`
        @keyframes arc-fade-in-up {
          from { opacity: 0; transform: translate(-50%, 70%); }
          to   { opacity: 1; transform: translate(-50%, 50%); }
        }
        .animate-arc-fade-in-up {
          animation-name: arc-fade-in-up;
          animation-duration: 0.7s;
          animation-timing-function: ease-out;
        }
      `}</style>
    </section>
  );
};

export default ArcGalleryHero;
