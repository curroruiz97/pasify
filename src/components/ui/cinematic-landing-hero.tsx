import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { cn } from '@/lib/utils';
import { InfiniteSlider } from '@/components/ui/infinite-slider';
import { ProgressiveBlur } from '@/components/ui/progressive-blur';
import appScreen from '@/assets/app_screen.png';

const phoneBrands = [
  { name: 'Apple', url: 'https://cdn.simpleicons.org/apple/0B1220' },
  { name: 'Samsung', url: 'https://cdn.simpleicons.org/samsung/0B1220' },
  { name: 'Xiaomi', url: 'https://cdn.simpleicons.org/xiaomi/0B1220' },
  { name: 'Huawei', url: 'https://cdn.simpleicons.org/huawei/0B1220' },
  { name: 'Nokia', url: 'https://cdn.simpleicons.org/nokia/0B1220' },
  { name: 'OnePlus', url: 'https://cdn.simpleicons.org/oneplus/0B1220' },
  { name: 'Oppo', url: 'https://cdn.simpleicons.org/oppo/0B1220' },
  { name: 'Sony', url: 'https://cdn.simpleicons.org/sony/0B1220' },
  { name: 'Honor', url: 'https://cdn.simpleicons.org/honor/0B1220' },
  { name: 'Motorola', url: 'https://cdn.simpleicons.org/motorola/0B1220' },
  { name: 'Google', url: 'https://cdn.simpleicons.org/google/0B1220' },
  { name: 'Asus', url: 'https://cdn.simpleicons.org/asus/0B1220' },
];

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

const INJECTED_STYLES = `
  .cinematic-hero-root {
    /* Bridge shadcn v0 HSL vars to the v4 --color-* names the styles below expect */
    --color-foreground: hsl(var(--foreground));
    --color-background: hsl(var(--background));
  }

  .cinematic-hero-root .gsap-reveal { visibility: hidden; }

  .cinematic-hero-root .film-grain {
      position: absolute; inset: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 50; opacity: 0.05; mix-blend-mode: overlay;
      background: url('data:image/svg+xml;utf8,<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><filter id="noiseFilter"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(%23noiseFilter)"/></svg>');
  }

  .cinematic-hero-root .bg-grid-theme {
      background-size: 60px 60px;
      background-image:
          linear-gradient(to right, color-mix(in srgb, var(--color-foreground) 5%, transparent) 1px, transparent 1px),
          linear-gradient(to bottom, color-mix(in srgb, var(--color-foreground) 5%, transparent) 1px, transparent 1px);
      mask-image: radial-gradient(ellipse at center, black 0%, transparent 70%);
      -webkit-mask-image: radial-gradient(ellipse at center, black 0%, transparent 70%);
  }

  .cinematic-hero-root .text-3d-matte {
      color: var(--color-foreground);
      text-shadow:
          0 10px 30px color-mix(in srgb, var(--color-foreground) 20%, transparent),
          0 2px 4px color-mix(in srgb, var(--color-foreground) 10%, transparent);
  }

  .cinematic-hero-root .text-silver-matte {
      background: linear-gradient(180deg, #0B1220 0%, #1F2937 50%, #374151 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      transform: translateZ(0);
      filter:
          drop-shadow(0px 10px 20px rgba(11, 18, 32, 0.2))
          drop-shadow(0px 2px 4px rgba(11, 18, 32, 0.12));
  }
  .cinematic-hero-root .sl-serif {
      font-family: 'Instrument Serif', Georgia, serif;
      font-style: italic;
      font-weight: 400;
      letter-spacing: -0.01em;
  }
  .cinematic-hero-root .text-sky-matte {
      background: linear-gradient(180deg, #0284C7 0%, #0EA5E9 55%, #38BDF8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      transform: translateZ(0);
      filter:
          drop-shadow(0px 10px 20px rgba(14, 165, 233, 0.28))
          drop-shadow(0px 2px 4px rgba(14, 165, 233, 0.18));
  }

  .cinematic-hero-root .text-card-silver-matte {
      background: linear-gradient(180deg, #FFFFFF 0%, #A1A1AA 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      transform: translateZ(0);
      filter:
          drop-shadow(0px 12px 24px rgba(0,0,0,0.8))
          drop-shadow(0px 4px 8px rgba(0,0,0,0.6));
  }

  .cinematic-hero-root .premium-depth-card {
      background:
          radial-gradient(ellipse 80% 60% at 15% 12%, rgba(125, 211, 252, 0.55), transparent 60%),
          radial-gradient(ellipse 70% 60% at 92% 90%, rgba(139, 92, 246, 0.5), transparent 65%),
          radial-gradient(ellipse 60% 55% at 85% 20%, rgba(52, 211, 153, 0.28), transparent 65%),
          radial-gradient(ellipse 80% 55% at 10% 85%, rgba(37, 99, 235, 0.45), transparent 65%),
          linear-gradient(145deg, #5BA4F0 0%, #2C6BD9 35%, #1E3A8A 70%, #1E1B4B 100%);
      box-shadow:
          0 40px 100px -20px rgba(15, 23, 80, 0.55),
          0 20px 40px -20px rgba(15, 23, 80, 0.45),
          inset 0 1px 2px rgba(255, 255, 255, 0.3),
          inset 0 -2px 4px rgba(10, 20, 80, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.08);
      position: relative;
  }
  .cinematic-hero-root .premium-depth-card::after {
      content: "";
      position: absolute; inset: 0;
      pointer-events: none;
      background:
          radial-gradient(circle at 50% 50%, transparent 40%, rgba(10, 20, 80, 0.35) 100%);
      mix-blend-mode: soft-light;
      border-radius: inherit;
  }

  .cinematic-hero-root .card-sheen {
      position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: 50;
      background: radial-gradient(800px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(255,255,255,0.06) 0%, transparent 40%);
      mix-blend-mode: screen; transition: opacity 0.3s ease;
  }

  .cinematic-hero-root .iphone-bezel {
      background-color: #111;
      box-shadow:
          inset 0 0 0 2px #52525B,
          inset 0 0 0 7px #000,
          0 40px 80px -15px rgba(0,0,0,0.9),
          0 15px 25px -5px rgba(0,0,0,0.7);
      transform-style: preserve-3d;
  }

  .cinematic-hero-root .hardware-btn {
      background: linear-gradient(90deg, #404040 0%, #171717 100%);
      box-shadow:
          -2px 0 5px rgba(0,0,0,0.8),
          inset -1px 0 1px rgba(255,255,255,0.15),
          inset 1px 0 2px rgba(0,0,0,0.8);
      border-left: 1px solid rgba(255,255,255,0.05);
  }

  .cinematic-hero-root .screen-glare {
      background: linear-gradient(110deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 45%);
  }

  .cinematic-hero-root .widget-depth {
      background: linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%);
      box-shadow:
          0 10px 20px rgba(0,0,0,0.3),
          inset 0 1px 1px rgba(255,255,255,0.05),
          inset 0 -1px 1px rgba(0,0,0,0.5);
      border: 1px solid rgba(255,255,255,0.03);
  }

  .cinematic-hero-root .floating-ui-badge {
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.01) 100%);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      box-shadow:
          0 0 0 1px rgba(255, 255, 255, 0.1),
          0 25px 50px -12px rgba(0, 0, 0, 0.8),
          inset 0 1px 1px rgba(255,255,255,0.2),
          inset 0 -1px 1px rgba(0,0,0,0.5);
  }

  .cinematic-hero-root .btn-modern-light,
  .cinematic-hero-root .btn-modern-dark {
      transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1);
      position: relative;
      overflow: hidden;
      isolation: isolate;
  }
  .cinematic-hero-root .btn-modern-light::before,
  .cinematic-hero-root .btn-modern-dark::before {
      content: "";
      position: absolute;
      top: 0; left: -140%;
      width: 70%; height: 100%;
      background: linear-gradient(
          115deg,
          transparent 0%,
          rgba(56, 189, 248, 0.0) 20%,
          rgba(56, 189, 248, 0.55) 50%,
          rgba(14, 165, 233, 0.4) 60%,
          transparent 85%
      );
      transform: skewX(-20deg);
      transition: left 0.9s cubic-bezier(0.25, 1, 0.5, 1);
      pointer-events: none;
      z-index: 1;
      filter: blur(2px);
  }
  .cinematic-hero-root .btn-modern-light:hover::before,
  .cinematic-hero-root .btn-modern-dark:hover::before {
      left: 160%;
  }
  .cinematic-hero-root .btn-modern-light > *,
  .cinematic-hero-root .btn-modern-dark > * {
      position: relative;
      z-index: 2;
  }
  /* Classic white button (App Store) */
  .cinematic-hero-root .btn-modern-light {
      background: linear-gradient(180deg, #FFFFFF 0%, #F1F5F9 100%);
      color: #0F172A;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.05), 0 2px 4px rgba(0,0,0,0.1), 0 12px 24px -4px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,1), inset 0 -3px 6px rgba(0,0,0,0.06);
  }
  .cinematic-hero-root .btn-modern-light:hover {
      transform: translateY(-3px);
      box-shadow: 0 0 0 1px rgba(0,0,0,0.05), 0 6px 12px -2px rgba(0,0,0,0.15), 0 20px 32px -6px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,1), inset 0 -3px 6px rgba(0,0,0,0.06);
  }
  .cinematic-hero-root .btn-modern-light:active {
      transform: translateY(1px);
      background: linear-gradient(180deg, #F1F5F9 0%, #E2E8F0 100%);
      box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.1), inset 0 3px 6px rgba(0,0,0,0.1), inset 0 0 0 1px rgba(0,0,0,0.02);
  }
  /* Classic black button (Google Play) */
  .cinematic-hero-root .btn-modern-dark {
      background: linear-gradient(180deg, #27272A 0%, #18181B 100%);
      color: #FFFFFF;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.1), 0 2px 4px rgba(0,0,0,0.6), 0 12px 24px -4px rgba(0,0,0,0.9), inset 0 1px 1px rgba(255,255,255,0.15), inset 0 -3px 6px rgba(0,0,0,0.8);
  }
  .cinematic-hero-root .btn-modern-dark:hover {
      transform: translateY(-3px);
      background: linear-gradient(180deg, #3F3F46 0%, #27272A 100%);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.15), 0 6px 12px -2px rgba(0,0,0,0.7), 0 20px 32px -6px rgba(0,0,0,1), inset 0 1px 1px rgba(255,255,255,0.2), inset 0 -3px 6px rgba(0,0,0,0.8);
  }
  .cinematic-hero-root .btn-modern-dark:active {
      transform: translateY(1px);
      background: #18181B;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.05), inset 0 3px 8px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.5);
  }

  /* Brand name pill at top of card */
  .cinematic-hero-root .card-brand-name {
      position: absolute;
      top: 72px; left: 50%;
      transform: translateX(-50%);
      padding: 6px 14px 6px 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.16);
      color: #FFFFFF;
      font-size: 11px; font-weight: 700;
      letter-spacing: 0.1em; text-transform: uppercase;
      display: inline-flex; align-items: center; gap: 8px;
      z-index: 30;
      box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255,255,255,0.2);
      white-space: nowrap;
  }
  @media (min-width: 1024px) {
      .cinematic-hero-root .card-brand-name {
          top: 32px; font-size: 12px; padding: 8px 18px 8px 14px; gap: 10px;
      }
  }
  .cinematic-hero-root .card-brand-dot {
      width: 7px; height: 7px; border-radius: 999px;
      background: #7DD3FC;
      box-shadow: 0 0 12px #7DD3FC;
      animation: slBrandPulse 2s ease-in-out infinite;
  }
  @keyframes slBrandPulse {
      0%, 100% { opacity: 0.7; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.2); }
  }

  /* Stat cards (right column) — modern glassmorphic */
  .cinematic-hero-root .stat-card {
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.04) 100%);
      backdrop-filter: blur(28px) saturate(1.2);
      -webkit-backdrop-filter: blur(28px) saturate(1.2);
      box-shadow:
          0 0 0 1px rgba(255, 255, 255, 0.16),
          0 20px 40px -12px rgba(0, 0, 0, 0.45),
          0 8px 20px -8px rgba(14, 165, 233, 0.25),
          inset 0 1px 1px rgba(255,255,255,0.25);
      border-radius: 18px;
      padding: 12px 14px 11px;
      width: 100%;
      transition: transform .4s cubic-bezier(.2,.8,.2,1);
  }
  @media (min-width: 1024px) {
      .cinematic-hero-root .stat-card { border-radius: 22px; padding: 18px 22px 16px; }
  }
  .cinematic-hero-root .stat-card:hover { transform: translateY(-2px); }
  .cinematic-hero-root .stat-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .cinematic-hero-root .stat-label {
      color: rgba(186, 230, 253, 0.78);
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
  }
  .cinematic-hero-root .stat-value-row { display: flex; align-items: baseline; gap: 6px; margin-bottom: 8px; }
  @media (min-width: 1024px) {
      .cinematic-hero-root .stat-value-row { margin-bottom: 12px; }
  }
  .cinematic-hero-root .stat-value {
      color: #fff;
      font-size: 24px; font-weight: 800;
      letter-spacing: -0.03em; line-height: 1;
      text-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  }
  @media (min-width: 1024px) {
      .cinematic-hero-root .stat-value { font-size: 32px; }
  }
  .cinematic-hero-root .stat-per {
      color: rgba(186, 230, 253, 0.62);
      font-size: 11px; font-weight: 500;
  }
  @media (min-width: 1024px) {
      .cinematic-hero-root .stat-per { font-size: 12px; }
  }
  .cinematic-hero-root .savings-trend-arrow,
  .cinematic-hero-root .stat-icon {
      width: 22px; height: 22px; border-radius: 7px;
      display: inline-flex; align-items: center; justify-content: center;
      color: #fff; flex-shrink: 0;
      box-shadow: 0 4px 10px -2px rgba(14, 165, 233, 0.55), inset 0 1px 1px rgba(255,255,255,0.4);
  }
  .cinematic-hero-root .savings-trend-arrow { background: linear-gradient(135deg, #7DD3FC, #38BDF8); }
  .cinematic-hero-root .stat-icon-students { background: linear-gradient(135deg, #A78BFA, #6366F1); box-shadow: 0 4px 10px -2px rgba(99, 102, 241, 0.55), inset 0 1px 1px rgba(255,255,255,0.4); }
  .cinematic-hero-root .stat-icon-partners { background: linear-gradient(135deg, #34D399, #10B981); box-shadow: 0 4px 10px -2px rgba(16, 185, 129, 0.55), inset 0 1px 1px rgba(255,255,255,0.4); }

  .cinematic-hero-root .savings-chart-wrap { width: 100%; height: 36px; position: relative; }
  @media (min-width: 1024px) {
      .cinematic-hero-root .savings-chart-wrap { height: 52px; }
  }
  .cinematic-hero-root .savings-chart { width: 100%; height: 100%; overflow: visible; }
  .cinematic-hero-root .savings-spark-dot-pulse { animation: slSparkPulse 1.8s ease-in-out infinite; transform-origin: 160px 5px; }
  @keyframes slSparkPulse {
      0%, 100% { r: 5; opacity: 0.45; }
      50% { r: 10; opacity: 0.1; }
  }

  .cinematic-hero-root .stat-bar-wrap { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .cinematic-hero-root .stat-bar {
      flex: 1; height: 6px; border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      overflow: hidden; box-shadow: inset 0 1px 2px rgba(0,0,0,0.2);
  }
  .cinematic-hero-root .stat-bar-fill {
      display: block; height: 100%; width: 0;
      border-radius: 999px;
  }
  .cinematic-hero-root .stat-bar-fill-students { background: linear-gradient(90deg, #A78BFA, #7DD3FC); box-shadow: 0 0 10px rgba(125, 211, 252, 0.5); }
  .cinematic-hero-root .stat-bar-fill-partners { background: linear-gradient(90deg, #34D399, #7DD3FC); box-shadow: 0 0 10px rgba(52, 211, 153, 0.5); }

  .cinematic-hero-root .stat-avatars { display: inline-flex; flex-shrink: 0; }
  .cinematic-hero-root .stat-av {
      width: 22px; height: 22px; border-radius: 999px;
      border: 2px solid rgba(255,255,255,0.15);
      display: inline-flex; align-items: center; justify-content: center;
      color: #fff; font-size: 8px; font-weight: 700;
      letter-spacing: -0.02em;
      margin-left: -6px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  }
  .cinematic-hero-root .stat-avatars .stat-av:first-child { margin-left: 0; }

  .cinematic-hero-root .stat-delta {
      font-size: 10px; font-weight: 600;
      color: #7DD3FC; white-space: nowrap;
      text-shadow: 0 0 10px rgba(125, 211, 252, 0.4);
  }

  /* Big decorative icons flanking the CTA */
  .cinematic-hero-root .cta-bg-icon {
      position: absolute;
      pointer-events: none;
      color: #0B1220;
      fill: currentColor;
      opacity: 0.92;
      filter: drop-shadow(0 30px 60px rgba(11, 18, 32, 0.22));
      z-index: -1;
  }
  .cinematic-hero-root .cta-bg-apple {
      left: 6vw; top: 50%;
      width: clamp(100px, 12vw, 180px);
      transform: translateY(-50%);
  }
  .cinematic-hero-root .cta-bg-android {
      right: 6vw; top: 50%;
      width: clamp(110px, 13vw, 200px);
      transform: translateY(-50%);
  }
  @media (max-width: 900px) {
      .cinematic-hero-root .cta-bg-icon { display: none; }
  }

  .cinematic-hero-root .supported-devices {
      margin-top: 56px;
      display: flex; flex-direction: column;
      align-items: center; gap: 20px;
      width: 100%; max-width: 1100px;
  }
  .cinematic-hero-root .supported-label {
      font-size: 11px; font-weight: 700;
      letter-spacing: 0.2em; text-transform: uppercase;
      color: color-mix(in srgb, var(--color-foreground) 45%, transparent);
  }
  .cinematic-hero-root .brands-slider-wrap {
      position: relative;
      width: 100%;
      height: 72px;
      overflow: hidden;
  }
  .cinematic-hero-root .brands-slider {
      height: 100%;
      display: flex;
      align-items: center;
  }
  .cinematic-hero-root .brand-item {
      width: 90px; height: 56px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      transition: transform .3s cubic-bezier(.2,.8,.2,1), opacity .3s;
      opacity: 0.6;
  }
  .cinematic-hero-root .brand-item:hover {
      opacity: 1;
      transform: scale(1.15);
  }
  .cinematic-hero-root .brand-item img {
      max-width: 100%; max-height: 40px;
      width: auto; height: auto;
      object-fit: contain;
      display: block;
  }
  @media (min-width: 1024px) {
      .cinematic-hero-root .brand-item { width: 110px; height: 64px; }
      .cinematic-hero-root .brand-item img { max-height: 48px; }
      .cinematic-hero-root .brands-slider-wrap { height: 80px; }
  }

  .cinematic-hero-root .progress-ring {
      transform: rotate(-90deg);
      transform-origin: center;
      stroke-dasharray: 402;
      stroke-dashoffset: 402;
      stroke-linecap: round;
  }
`;

export interface CinematicHeroProps extends React.HTMLAttributes<HTMLDivElement> {
  brandName?: string;
  tagline1?: string;
  tagline2?: string;
  cardHeading?: string;
  cardDescription?: React.ReactNode;
  metricValue?: number;
  metricLabel?: string;
  ctaHeading?: React.ReactNode;
  ctaDescription?: React.ReactNode;
  appStoreUrl?: string;
  playStoreUrl?: string;
}

export function CinematicHero({
  brandName = 'Sobers',
  tagline1 = 'Track the journey,',
  tagline2 = 'not just the days.',
  cardHeading = 'Accountability, redefined.',
  cardDescription = (
    <>
      <span className="text-white font-semibold">Sobers</span> empowers sponsors and sponsees in 12-step recovery programs with structured accountability, precise sobriety tracking, and beautiful visual timelines.
    </>
  ),
  metricValue = 365,
  metricLabel = 'Days Sober',
  ctaHeading = 'Start your recovery.',
  ctaDescription = 'Join thousands of others in the 12-step program and take control of your timeline today.',
  appStoreUrl = '#',
  playStoreUrl = '#',
  className,
  ...props
}: CinematicHeroProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainCardRef = useRef<HTMLDivElement>(null);
  const mockupRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (window.scrollY > window.innerHeight * 2) return;
      cancelAnimationFrame(requestRef.current);
      requestRef.current = requestAnimationFrame(() => {
        if (mainCardRef.current && mockupRef.current) {
          const rect = mainCardRef.current.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          mainCardRef.current.style.setProperty('--mouse-x', `${mouseX}px`);
          mainCardRef.current.style.setProperty('--mouse-y', `${mouseY}px`);

          const xVal = (e.clientX / window.innerWidth - 0.5) * 2;
          const yVal = (e.clientY / window.innerHeight - 0.5) * 2;

          gsap.to(mockupRef.current, {
            rotationY: xVal * 12,
            rotationX: -yVal * 12,
            ease: 'power3.out',
            duration: 1.2,
          });
        }
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(requestRef.current);
    };
  }, []);

  useEffect(() => {
    const isMobile = window.innerWidth < 768;

    const ctx = gsap.context(() => {
      gsap.set('.text-track', { autoAlpha: 0, y: 60, scale: 0.85, filter: 'blur(20px)', rotationX: -20 });
      gsap.set('.text-days', { autoAlpha: 1, clipPath: 'inset(-30% 100% -30% 0)' });
      gsap.set('.main-card', { y: window.innerHeight + 200, autoAlpha: 1 });
      gsap.set(['.card-left-text', '.mockup-scroll-wrapper', '.phone-widget', '.card-right-stats'], { autoAlpha: 0 });
      gsap.set('.stat-card', { y: 40, autoAlpha: 0 });
      gsap.set('.savings-spark-line', { strokeDasharray: 340, strokeDashoffset: 340 });
      gsap.set(['.savings-spark-fill', '.savings-spark-dot', '.savings-spark-dot-pulse'], { autoAlpha: 0 });
      gsap.set('.stat-bar-fill-students', { width: '0%' });
      gsap.set('.stat-bar-fill-partners', { width: '0%' });
      gsap.set('.cta-wrapper', { autoAlpha: 0, scale: 0.8, filter: 'blur(30px)' });

      const introTl = gsap.timeline({ delay: 0.3 });
      introTl
        .to('.text-track', { duration: 1.8, autoAlpha: 1, y: 0, scale: 1, filter: 'blur(0px)', rotationX: 0, ease: 'expo.out' })
        .to('.text-days', { duration: 1.4, clipPath: 'inset(-30% 0% -30% 0)', ease: 'power4.inOut' }, '-=1.0');

      const scrollTl = gsap.timeline({
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top top',
          end: '+=7000',
          pin: true,
          scrub: 1,
          anticipatePin: 1,
        },
      });

      scrollTl
        .to(['.hero-text-wrapper', '.bg-grid-theme'], { scale: 1.15, filter: 'blur(20px)', opacity: 0.2, ease: 'power2.inOut', duration: 2 }, 0)
        .to('.main-card', { y: 0, ease: 'power3.inOut', duration: 2 }, 0)
        .to('.main-card', { width: '100%', height: '100%', borderRadius: '0px', ease: 'power3.inOut', duration: 1.5 })
        .fromTo('.mockup-scroll-wrapper',
          { y: 300, z: -500, rotationX: 50, rotationY: -30, autoAlpha: 0, scale: 0.6 },
          { y: 0, z: 0, rotationX: 0, rotationY: 0, autoAlpha: 1, scale: 1, ease: 'expo.out', duration: 2.5 },
          '-=0.8'
        )
        .fromTo('.phone-widget', { y: 40, autoAlpha: 0, scale: 0.95 }, { y: 0, autoAlpha: 1, scale: 1, ease: 'back.out(1.2)', duration: 1.5 }, '-=1.5')
        .fromTo('.card-left-text', { x: -50, autoAlpha: 0 }, { x: 0, autoAlpha: 1, ease: 'power4.out', duration: 1.5 }, '-=1.2')
        .to('.card-right-stats', { autoAlpha: 1, duration: 0.3 }, '-=1')
        .to('.stat-card', { y: 0, autoAlpha: 1, ease: 'back.out(1.3)', duration: 1.2, stagger: 0.15 }, '-=1')
        .to('.savings-spark-line', { strokeDashoffset: 0, duration: 1.6, ease: 'power3.inOut' }, '-=1.2')
        .to('.savings-spark-fill', { autoAlpha: 1, duration: 0.8, ease: 'power2.out' }, '-=0.9')
        .to(['.savings-spark-dot-pulse', '.savings-spark-dot'], { autoAlpha: 1, duration: 0.5, ease: 'power2.out', stagger: 0.15 }, '-=0.6')
        .to('.counter-savings', { innerHTML: '€350', duration: 1.8, ease: 'expo.out' }, '-=2')
        .to('.counter-students', { innerHTML: 1200, snap: { innerHTML: 1 }, duration: 1.8, ease: 'expo.out' }, '-=1.8')
        .to('.counter-partners', { innerHTML: 40, snap: { innerHTML: 1 }, duration: 1.8, ease: 'expo.out' }, '-=1.8')
        .to('.stat-bar-fill-students', { width: '80%', duration: 1.6, ease: 'power3.out' }, '-=1.5')
        .to('.stat-bar-fill-partners', { width: '65%', duration: 1.6, ease: 'power3.out' }, '-=1.3')
        .to({}, { duration: 2.8 })
        .set('.hero-text-wrapper', { autoAlpha: 0 })
        .set('.cta-wrapper', { autoAlpha: 1 })
        .to({}, { duration: 1.2 })
        .to(['.mockup-scroll-wrapper', '.card-left-text', '.card-right-stats'], {
          scale: 0.92, y: -30, autoAlpha: 0, ease: 'power3.in', duration: 1.2, stagger: 0.05,
        })
        .to('.main-card', {
          width: isMobile ? '92vw' : '80vw',
          height: isMobile ? '88vh' : '78vh',
          borderRadius: isMobile ? '32px' : '40px',
          ease: 'expo.inOut',
          duration: 1.8,
        }, 'pullback')
        .to('.cta-wrapper', { scale: 1, filter: 'blur(0px)', ease: 'expo.inOut', duration: 1.8 }, 'pullback')
        .to('.main-card', { autoAlpha: 0, scale: 0.95, ease: 'power3.inOut', duration: 1.5 });
    }, containerRef);

    return () => ctx.revert();
  }, [metricValue]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'cinematic-hero-root relative w-screen h-screen overflow-hidden flex items-center justify-center bg-background text-foreground font-sans antialiased',
        className,
      )}
      style={{ perspective: '1500px' }}
      {...props}
    >
      <style dangerouslySetInnerHTML={{ __html: INJECTED_STYLES }} />
      <div className="film-grain" aria-hidden="true" />
      <div className="bg-grid-theme absolute inset-0 z-0 pointer-events-none opacity-50" aria-hidden="true" />

      <div className="hero-text-wrapper absolute z-10 flex flex-col items-center justify-center text-center w-screen px-6 sm:px-10 py-16 will-change-transform">
        <h1 className="text-track gsap-reveal text-3d-matte text-4xl sm:text-5xl md:text-6xl lg:text-[5rem] font-bold tracking-tight mb-3 leading-[1.05]">
          {tagline1}
        </h1>
        <h1 className="text-days gsap-reveal text-sky-matte text-4xl sm:text-5xl md:text-6xl lg:text-[5rem] font-extrabold tracking-tight leading-[1.05] pb-2">
          {tagline2}
        </h1>
      </div>

      <div className="cta-wrapper absolute z-10 flex flex-col items-center justify-center text-center w-screen px-4 gsap-reveal pointer-events-auto will-change-transform">
        <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 tracking-tight text-silver-matte">
          {ctaHeading}
        </h2>
        <p className="text-muted-foreground text-lg md:text-xl mb-12 max-w-xl mx-auto font-light leading-relaxed">
          {ctaDescription}
        </p>
        <div className="flex flex-col sm:flex-row gap-6">
          <a href={appStoreUrl} target="_blank" rel="noopener noreferrer" aria-label="Download on the App Store" className="btn-modern-light flex items-center justify-center gap-3 px-8 py-4 rounded-[1.25rem] group focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
            <svg className="w-8 h-8 transition-transform group-hover:scale-105" fill="currentColor" viewBox="0 0 384 512" aria-hidden="true">
              <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
            </svg>
            <div className="text-left">
              <div className="text-[10px] font-bold tracking-wider text-neutral-500 uppercase mb-[-2px]">Download on the</div>
              <div className="text-xl font-bold leading-none tracking-tight">App Store</div>
            </div>
          </a>
          <a href={playStoreUrl} target="_blank" rel="noopener noreferrer" aria-label="Get it on Google Play" className="btn-modern-dark flex items-center justify-center gap-3 px-8 py-4 rounded-[1.25rem] group focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-background">
            <svg className="w-7 h-7 transition-transform group-hover:scale-105" fill="currentColor" viewBox="0 0 512 512" aria-hidden="true">
              <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z" />
            </svg>
            <div className="text-left">
              <div className="text-[10px] font-bold tracking-wider text-neutral-300 uppercase mb-[-2px]">Get it on</div>
              <div className="text-xl font-bold leading-none tracking-tight">Google Play</div>
            </div>
          </a>
        </div>

        {/* Animated brand logos — supported devices */}
        <div className="supported-devices">
          <span className="supported-label">Compatible con todos los dispositivos</span>
          <div className="brands-slider-wrap">
            <InfiniteSlider className="brands-slider" duration={35} gap={56} durationOnHover={100}>
              {phoneBrands.map((b) => (
                <div key={b.name} className="brand-item" title={b.name}>
                  <img src={b.url} alt={b.name} loading="lazy" />
                </div>
              ))}
            </InfiniteSlider>
            <ProgressiveBlur
              className="pointer-events-none absolute top-0 left-0 h-full w-[120px]"
              direction="left"
              blurIntensity={1}
            />
            <ProgressiveBlur
              className="pointer-events-none absolute top-0 right-0 h-full w-[120px]"
              direction="right"
              blurIntensity={1}
            />
          </div>
        </div>
      </div>

      <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none" style={{ perspective: '1500px' }}>
        <div
          ref={mainCardRef}
          className="main-card premium-depth-card relative overflow-hidden gsap-reveal flex items-center justify-center pointer-events-auto w-[92vw] md:w-[85vw] h-[92vh] md:h-[85vh] rounded-[32px] md:rounded-[40px]"
        >
          <div className="card-sheen" aria-hidden="true" />


          <div className="relative w-full h-full max-w-7xl mx-auto px-4 lg:px-10 flex flex-col justify-evenly lg:grid lg:grid-cols-[1.1fr_1fr_1fr] items-center lg:gap-10 z-10 pt-14 pb-5 lg:py-0">
            <div className="mockup-scroll-wrapper order-2 lg:order-2 relative w-full h-[320px] sm:h-[380px] lg:h-[600px] flex items-center justify-center z-10" style={{ perspective: '1000px' }}>
              <div className="relative w-full h-full flex items-center justify-center transform scale-[0.55] sm:scale-[0.65] md:scale-[0.85] lg:scale-100">
                <div
                  ref={mockupRef}
                  className="relative w-[280px] h-[580px] rounded-[3rem] iphone-bezel flex flex-col will-change-transform"
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  <div className="absolute top-[120px] -left-[3px] w-[3px] h-[25px] hardware-btn rounded-l-md z-0" aria-hidden="true" />
                  <div className="absolute top-[160px] -left-[3px] w-[3px] h-[45px] hardware-btn rounded-l-md z-0" aria-hidden="true" />
                  <div className="absolute top-[220px] -left-[3px] w-[3px] h-[45px] hardware-btn rounded-l-md z-0" aria-hidden="true" />
                  <div className="absolute top-[170px] -right-[3px] w-[3px] h-[70px] hardware-btn rounded-r-md z-0 scale-x-[-1]" aria-hidden="true" />

                  <div className="absolute inset-[7px] bg-[#050914] rounded-[2.5rem] overflow-hidden shadow-[inset_0_0_15px_rgba(0,0,0,1)] text-white z-10">
                    <div className="absolute inset-0 screen-glare z-40 pointer-events-none" aria-hidden="true" />

                    <div className="absolute top-[5px] left-1/2 -translate-x-1/2 w-[100px] h-[28px] bg-black rounded-full z-50 flex items-center justify-end px-3 shadow-[inset_0_-1px_2px_rgba(255,255,255,0.1)]">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)] animate-pulse" />
                    </div>

                    <img
                      src={appScreen}
                      alt="Screenshot app Student's Life — partner locali di Valladolid"
                      className="phone-widget absolute inset-0 w-full h-full object-cover object-top z-20"
                    />

                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-[120px] h-[4px] bg-white/30 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.5)] z-30" />
                  </div>
                </div>

              </div>
            </div>

            <div className="card-left-text gsap-reveal order-3 lg:order-1 flex flex-col justify-center text-center lg:text-left z-20 w-full lg:max-w-none px-4 lg:px-0">
              <h3 className="text-white text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold mb-2 lg:mb-5 tracking-tight">
                {cardHeading}
              </h3>
              <p className="text-blue-100/70 text-[13px] sm:text-sm md:text-base lg:text-lg font-normal leading-relaxed mx-auto lg:mx-0 max-w-sm lg:max-w-none">
                {cardDescription}
              </p>
            </div>

            {/* RIGHT COLUMN — stats panel */}
            <div className="card-right-stats gsap-reveal order-4 lg:order-3 grid grid-cols-3 lg:flex lg:flex-col gap-2 lg:gap-4 z-20 w-full max-w-md lg:max-w-none mx-auto px-2 lg:px-0">
              <div className="stat-card stat-savings">
                <div className="stat-top">
                  <span className="savings-trend-arrow">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M7 17L17 7M17 7H9M17 7V15" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="stat-label"><span className="hidden lg:inline">Ahorro medio</span><span className="lg:hidden">Ahorro</span></span>
                </div>
                <div className="stat-value-row">
                  <span className="counter-savings stat-value">€0</span>
                  <span className="stat-per">/mensual</span>
                </div>
                <div className="savings-chart-wrap hidden lg:block">
                  <svg className="savings-chart" viewBox="0 0 160 52" preserveAspectRatio="none" aria-hidden="true">
                    <defs>
                      <linearGradient id="sparkStroke" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#38BDF8" />
                        <stop offset="100%" stopColor="#BAE6FD" />
                      </linearGradient>
                      <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#7DD3FC" stopOpacity="0.45" />
                        <stop offset="100%" stopColor="#7DD3FC" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      className="savings-spark-fill"
                      fill="url(#sparkFill)"
                      d="M 0 44 C 18 43, 26 36, 40 32 S 70 24, 86 17 S 130 8, 160 5 L 160 52 L 0 52 Z"
                    />
                    <path
                      className="savings-spark-line"
                      fill="none"
                      stroke="url(#sparkStroke)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M 0 44 C 18 43, 26 36, 40 32 S 70 24, 86 17 S 130 8, 160 5"
                    />
                    <circle className="savings-spark-dot-pulse" cx="160" cy="5" r="6" fill="#7DD3FC" opacity="0.4" />
                    <circle className="savings-spark-dot" cx="160" cy="5" r="3.5" fill="#fff" stroke="#38BDF8" strokeWidth="1.5" />
                  </svg>
                </div>
              </div>

              <div className="stat-card stat-students">
                <div className="stat-top">
                  <span className="stat-icon stat-icon-students">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2.2" />
                      <path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                      <path d="M17 3a4 4 0 010 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="stat-label"><span className="hidden lg:inline">Estudiantes activos</span><span className="lg:hidden">Estudiantes</span></span>
                </div>
                <div className="stat-value-row">
                  <span className="counter-students stat-value">0</span>
                  <span className="stat-per"><span className="hidden lg:inline">+ en Valladolid</span><span className="lg:hidden">+</span></span>
                </div>
                <div className="stat-bar-wrap hidden lg:flex">
                  <div className="stat-bar stat-bar-students"><span className="stat-bar-fill stat-bar-fill-students" /></div>
                  <div className="stat-avatars">
                    <span className="stat-av" style={{ background: 'linear-gradient(135deg,#f97316,#ec4899)' }}>MR</span>
                    <span className="stat-av" style={{ background: 'linear-gradient(135deg,#8b5cf6,#3b82f6)' }}>SF</span>
                    <span className="stat-av" style={{ background: 'linear-gradient(135deg,#10b981,#0ea5e9)' }}>LT</span>
                  </div>
                </div>
              </div>

              <div className="stat-card stat-partners">
                <div className="stat-top">
                  <span className="stat-icon stat-icon-partners">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" stroke="currentColor" strokeWidth="2.2" />
                      <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="2.2" />
                    </svg>
                  </span>
                  <span className="stat-label"><span className="hidden lg:inline">Locales partner</span><span className="lg:hidden">Partner</span></span>
                </div>
                <div className="stat-value-row">
                  <span className="counter-partners stat-value">0</span>
                  <span className="stat-per"><span className="hidden lg:inline">+ verificados</span><span className="lg:hidden">+</span></span>
                </div>
                <div className="stat-bar-wrap hidden lg:flex">
                  <div className="stat-bar stat-bar-partners"><span className="stat-bar-fill stat-bar-fill-partners" /></div>
                  <span className="stat-delta">+4 este mes</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
