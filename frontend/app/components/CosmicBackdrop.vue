<template>
  <div class="cosmic-backdrop" aria-hidden="true">
    <div class="cosmic-backdrop__void" />
    <div class="cosmic-backdrop__nebula" />
    <div class="cosmic-backdrop__aurora" />
    <div class="cosmic-backdrop__aurora cosmic-backdrop__aurora--b" />
    <div class="cosmic-backdrop__stars" />
    <div class="cosmic-backdrop__grid" />
    <div class="cosmic-backdrop__scan" />
  </div>
</template>

<style>
.cosmic-backdrop {
  --cb-base: #f2f5ff;
  --cb-grid: rgba(6, 148, 162, 0.11);
  --cb-void-a: rgba(200, 210, 255, 0.45);
  --cb-void-b: rgba(230, 240, 255, 0.85);
  --cb-nebula-a: rgba(120, 100, 220, 0.12);
  --cb-nebula-b: rgba(0, 180, 200, 0.1);
  --cb-nebula-c: rgba(220, 100, 180, 0.08);
  --cb-aur-1: rgba(80, 140, 220, 0.22);
  --cb-aur-2: rgba(0, 170, 190, 0.16);
  --cb-aur-3: rgba(200, 100, 180, 0.14);
  --cb-star: rgba(30, 58, 95, 0.55);
  --cb-scan: rgba(0, 0, 0, 0.025);
}

html.dark .cosmic-backdrop {
  --cb-base: #03040c;
  --cb-grid: rgba(0, 245, 255, 0.045);
  --cb-void-a: rgba(20, 10, 48, 0.9);
  --cb-void-b: rgba(8, 20, 40, 0.95);
  --cb-nebula-a: rgba(188, 19, 254, 0.14);
  --cb-nebula-b: rgba(0, 245, 255, 0.1);
  --cb-nebula-c: rgba(255, 0, 170, 0.09);
  --cb-aur-1: rgba(120, 90, 255, 0.35);
  --cb-aur-2: rgba(0, 245, 255, 0.22);
  --cb-aur-3: rgba(255, 0, 170, 0.18);
  --cb-star: rgba(255, 255, 255, 0.92);
  --cb-scan: rgba(0, 0, 0, 0.04);
}

.cosmic-backdrop__void {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 140% 100% at 50% 120%, var(--cb-void-a), transparent 55%),
    radial-gradient(ellipse 100% 60% at 50% -10%, var(--cb-void-b), transparent 50%),
    var(--cb-base);
}

.cosmic-backdrop__nebula {
  position: fixed;
  inset: -60%;
  z-index: 0;
  pointer-events: none;
  background: conic-gradient(
    from 0deg at 50% 50%,
    var(--cb-nebula-a),
    transparent 16%,
    var(--cb-nebula-b),
    transparent 34%,
    var(--cb-nebula-c),
    transparent 52%,
    var(--cb-nebula-b),
    transparent 70%,
    var(--cb-nebula-a),
    transparent 88%,
    var(--cb-nebula-a)
  );
  filter: blur(55px);
  opacity: 0.75;
  animation: cosmic-nebula-spin 90s linear infinite;
}

html:not(.dark) .cosmic-backdrop__nebula {
  opacity: 0.55;
}

@keyframes cosmic-nebula-spin {
  to {
    transform: rotate(360deg);
  }
}

.cosmic-backdrop__aurora {
  position: fixed;
  inset: -25%;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 55% 45% at 25% 30%, var(--cb-aur-1), transparent 55%),
    radial-gradient(ellipse 50% 40% at 75% 65%, var(--cb-aur-2), transparent 50%),
    radial-gradient(ellipse 45% 50% at 50% 95%, var(--cb-aur-3), transparent 45%);
  filter: blur(48px);
  mix-blend-mode: screen;
  opacity: 0.55;
  animation: cosmic-aurora-a 22s ease-in-out infinite;
}

html:not(.dark) .cosmic-backdrop__aurora {
  mix-blend-mode: multiply;
  opacity: 0.45;
  filter: blur(56px);
}

.cosmic-backdrop__aurora--b {
  animation: cosmic-aurora-b 28s ease-in-out infinite;
  animation-delay: -8s;
  background:
    radial-gradient(ellipse 50% 42% at 70% 25%, var(--cb-aur-2), transparent 52%),
    radial-gradient(ellipse 48% 48% at 15% 70%, var(--cb-aur-3), transparent 48%),
    radial-gradient(ellipse 40% 38% at 90% 85%, var(--cb-aur-1), transparent 50%);
}

@keyframes cosmic-aurora-a {
  0%,
  100% {
    transform: translate(0, 0) scale(1) rotate(0deg);
    opacity: 0.72;
  }
  33% {
    transform: translate(6%, -4%) scale(1.08) rotate(4deg);
    opacity: 0.9;
  }
  66% {
    transform: translate(-5%, 5%) scale(0.96) rotate(-3deg);
    opacity: 0.78;
  }
}

@keyframes cosmic-aurora-b {
  0%,
  100% {
    transform: translate(0, 0) scale(1.02) rotate(0deg);
    opacity: 0.6;
  }
  50% {
    transform: translate(-7%, 6%) scale(1.12) rotate(-5deg);
    opacity: 0.88;
  }
}

.cosmic-backdrop__stars {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image:
    radial-gradient(1px 1px at 8% 12%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 22% 8%, var(--cb-star), transparent),
    radial-gradient(1.2px 1.2px at 35% 28%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 48% 15%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 62% 22%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 78% 10%, var(--cb-star), transparent),
    radial-gradient(1.2px 1.2px at 92% 18%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 12% 38%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 28% 45%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 55% 42%, var(--cb-star), transparent),
    radial-gradient(1.2px 1.2px at 72% 38%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 88% 48%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 5% 58%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 42% 62%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 65% 55%, var(--cb-star), transparent),
    radial-gradient(1.2px 1.2px at 95% 62%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 18% 72%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 38% 82%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 58% 78%, var(--cb-star), transparent),
    radial-gradient(1.2px 1.2px at 82% 85%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 15% 92%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 50% 88%, var(--cb-star), transparent),
    radial-gradient(1px 1px at 70% 92%, var(--cb-star), transparent);
  background-repeat: no-repeat;
  background-size: 100% 100%;
  opacity: 0.48;
  animation: cosmic-stars-twinkle 7s ease-in-out infinite alternate;
}

html:not(.dark) .cosmic-backdrop__stars {
  opacity: 0.35;
}

@keyframes cosmic-stars-twinkle {
  0% {
    opacity: 0.35;
    filter: brightness(0.94);
  }
  100% {
    opacity: 0.55;
    filter: brightness(1.12);
  }
}

.cosmic-backdrop__grid {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background-image:
    linear-gradient(var(--cb-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--cb-grid) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse 75% 75% at 50% 42%, black 15%, transparent 72%);
}

.cosmic-backdrop__scan {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    var(--cb-scan) 2px,
    var(--cb-scan) 4px
  );
  animation: cosmic-scan 10s linear infinite;
}

@keyframes cosmic-scan {
  0% {
    opacity: 0.4;
  }
  50% {
    opacity: 0.72;
  }
  100% {
    opacity: 0.4;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cosmic-backdrop__nebula,
  .cosmic-backdrop__aurora,
  .cosmic-backdrop__aurora--b,
  .cosmic-backdrop__stars,
  .cosmic-backdrop__scan {
    animation: none;
  }
}
</style>
