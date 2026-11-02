import { useEffect, useRef, useState, type RefObject } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Celebratory confetti burst drawn on a full-viewport canvas.
 *
 * Increment `fire` to launch a burst; pieces shoot out of `originRef` (or the
 * upper-centre of the viewport), fall under gravity and fade within ~2.5 s,
 * after which the canvas unmounts. Purely decorative: pointer events pass
 * through, it is hidden from assistive technology (a polite status message
 * carries the meaning instead), and nothing is drawn when the user prefers
 * reduced motion.
 */
export interface ConfettiBurstProps {
  /** Monotonic counter — every change fires one burst. 0 = idle. */
  fire: number;
  /** Element the pieces burst out of. */
  originRef?: RefObject<HTMLElement | null>;
  /** Spoken by screen readers when a burst fires. */
  announcement?: string;
  /** Number of pieces per burst. */
  count?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  width: number;
  height: number;
  color: string;
  shape: "rect" | "circle";
  /** Remaining life in seconds; the last 0.6 s fade out. */
  life: number;
  /** Horizontal wobble phase, gives paper a fluttering fall. */
  wobble: number;
}

// Brand palette: indigo shades plus the success and warning accents.
const COLORS = ["#4f46e5", "#6366f1", "#818cf8", "#c7cbfb", "#2f855a", "#b7791f", "#f6c453", "#ffffff"];
const GRAVITY = 1500; // px/s²
const DRAG = 0.9; // velocity retained per second
const LIFETIME = 2.6; // seconds

function spawn(x: number, y: number, count: number): Particle[] {
  const pieces: Particle[] = [];
  for (let i = 0; i < count; i++) {
    // Mostly upward fan: straight up ± 65°, a few strays further out.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI * 0.72) + (Math.random() < 0.1 ? (Math.random() - 0.5) * Math.PI : 0);
    const speed = 520 + Math.random() * 620;
    const size = 7 + Math.random() * 7;
    pieces.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 18,
      width: size,
      height: size * (0.4 + Math.random() * 0.6),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shape: Math.random() < 0.25 ? "circle" : "rect",
      life: LIFETIME - Math.random() * 0.6,
      wobble: Math.random() * Math.PI * 2,
    });
  }
  return pieces;
}

export function ConfettiBurst({ fire, originRef, announcement = "All tasks complete.", count = 140 }: ConfettiBurstProps) {
  const reduceMotion = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const [active, setActive] = useState(false);

  // Launch a burst whenever `fire` changes.
  useEffect(() => {
    if (fire === 0 || reduceMotion) return;
    const rect = originRef?.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight * 0.3;
    particles.current.push(...spawn(x, y, count));
    setActive(true);
  }, [fire, reduceMotion, originRef, count]);

  // Animation loop lives only while there is something to draw.
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      const drag = Math.pow(DRAG, dt);
      const alive: Particle[] = [];
      for (const p of particles.current) {
        p.life -= dt;
        if (p.life <= 0 || p.y > window.innerHeight + 40) continue;
        p.vx *= drag;
        p.vy = p.vy * drag + GRAVITY * dt;
        p.wobble += dt * 6;
        p.x += (p.vx + Math.sin(p.wobble) * 40) * dt;
        p.y += p.vy * dt;
        p.rotation += p.spin * dt;

        ctx.save();
        ctx.globalAlpha = Math.min(1, p.life / 0.6);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        if (p.shape === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, p.width / 2.4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Scale the height with the wobble so flat pieces appear to tumble.
          ctx.fillRect(-p.width / 2, (-p.height / 2) * Math.cos(p.wobble), p.width, p.height * Math.cos(p.wobble));
        }
        ctx.restore();
        alive.push(p);
      }
      particles.current = alive;

      if (alive.length === 0) {
        setActive(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [active]);

  return (
    <>
      {/* Re-keyed so each burst is announced again. */}
      <span key={fire} role="status" aria-live="polite" className="sr-only">
        {fire > 0 ? announcement : ""}
      </span>
      {active && <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-[100] h-dvh w-screen" />}
    </>
  );
}
