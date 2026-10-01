import { useEffect, useRef, type ReactNode } from "react";

// Red flames that leap from the top and bottom edges of what they wrap, a glow
// along its outline, rounded corners included, and sparks, drawn with WebGL2 on
// a canvas behind it. Without WebGL2 only the content shows.

type Rgb = [number, number, number];

interface FlamesProps {
  children: ReactNode;
  // How far the flames reach past the top and bottom edges, in px.
  height?: number;
}

const RED: Rgb = [1, 0.16, 0.05];
// Where the flames are hottest, along the edge of what they wrap.
const HOT: Rgb = [1, 0.3, 0.1];

// The flames' color where they touch what they wrap, so what burns can match
// them there.
export const FLAME_COLOR = `rgb(${HOT.map((c) => Math.round(c * 255)).join(" ")})`;

// Room around the content for the glow, below it for the flames' tallest
// tongues, and above it for the sparks, which rise past them. Both in heights.
const GLOW = 12;
const FLAME_REACH = 1.2;
const SPARK_REACH = 1.5;

// The canvas sits one layer down, so the flames pass behind the content and
// behind any text above it. An ancestor has to start a stacking context, like
// `isolate`, or the flames go behind the page too.
export function Flames({ children, height = 16 }: FlamesProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const top = Math.ceil(height * SPARK_REACH) + GLOW;
  const bottom = Math.ceil(height * FLAME_REACH) + GLOW;

  useEffect(() => {
    if (!box.current || !canvas.current) return;
    return ignite(canvas.current, box.current, { height, color: RED, hot: HOT });
  }, [height]);

  return (
    <div ref={box} className="relative">
      {children}
      <canvas
        ref={canvas}
        aria-hidden
        className="pointer-events-none absolute -z-10"
        style={{
          top: -top,
          left: -GLOW,
          width: `calc(100% + ${GLOW * 2}px)`,
          height: `calc(100% + ${top + bottom}px)`,
        }}
      />
    </div>
  );
}

interface Look {
  height: number;
  color: Rgb;
  hot: Rgb;
}

// Starts drawing on the canvas, and returns what stops it. It only animates
// while the canvas is on screen, and holds still for reduced motion.
function ignite(canvas: HTMLCanvasElement, box: HTMLElement, look: Look): () => void {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  const program = gl && link(gl);
  if (!gl || !program) return () => {};

  gl.useProgram(program);
  const at = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = { dpr: at("uDpr"), box: at("uBox"), time: at("uTime") };
  // The corners of what's wrapped, which fills the box.
  const wrapped = box.firstElementChild;
  gl.uniform1f(at("uRadius"), wrapped ? parseFloat(getComputedStyle(wrapped).borderTopLeftRadius) || 0 : 0);
  gl.uniform1f(at("uHeight"), look.height);
  gl.uniform3f(at("uColor"), ...look.color);
  gl.uniform3f(at("uHot"), ...look.hot);
  // So bars side by side don't burn the same.
  gl.uniform1f(at("uSeed"), Math.random() * 1000);

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const born = performance.now();
  let visible = false;
  let frame = 0;

  const draw = (now: number) => {
    const dpr = window.devicePixelRatio;
    const c = canvas.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const width = Math.round(c.width * dpr);
    const height = Math.round(c.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.uniform1f(uniforms.dpr, dpr);
    // The box's center and half size in CSS px, with y up from the canvas's bottom, as GL counts.
    gl.uniform4f(uniforms.box, b.left - c.left + b.width / 2, c.bottom - b.bottom + b.height / 2, b.width / 2, b.height / 2);
    gl.uniform1f(uniforms.time, motion.matches ? 0 : (now - born) / 1000);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const tick = (now: number) => {
    draw(now);
    frame = visible && !motion.matches ? requestAnimationFrame(tick) : 0;
  };
  const wake = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  const seen = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
    if (visible) wake();
  });
  seen.observe(canvas);
  const resized = new ResizeObserver(wake);
  resized.observe(box);
  motion.addEventListener("change", wake);

  // The context isn't lost on purpose: StrictMode mounts twice on the same
  // canvas, and a lost context can't be had back. The browser frees it with
  // the canvas.
  return () => {
    cancelAnimationFrame(frame);
    seen.disconnect();
    resized.disconnect();
    motion.removeEventListener("change", wake);
    gl.deleteProgram(program);
  };
}

function link(gl: WebGL2RenderingContext): WebGLProgram | null {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  console.warn("Flames couldn't draw:", gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
  return null;
}

// One triangle that covers the whole canvas, with no buffers.
const VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

// Heat is highest along the top and bottom edges and fades as the flames leave
// them, broken up by noise that scrolls away from the edge. It glows around the
// rest of the outline too.
// Colors run from dark red through the flame color to red-orange where it's hottest.
// Output is premultiplied.
const FRAGMENT = `#version 300 es
precision highp float;

uniform float uDpr;
uniform vec4 uBox;
uniform float uRadius;
uniform float uHeight;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uSeed;

out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * noise(p);
    p = p * 2.02 + vec2(17.0, 9.0);
    amp *= 0.5;
  }
  return sum;
}

// Distance to a rounded box, negative inside.
float roundedBox(vec2 p, vec2 size, float r) {
  vec2 q = abs(p) - size + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = gl_FragCoord.xy / uDpr;
  vec2 local = p - uBox.xy;
  vec2 size = uBox.zw;
  float edge = roundedBox(local, size, uRadius);
  // How far past the nearer of the top and bottom edges. The bottom's flames
  // burn a pattern of their own, not the top's mirrored.
  float past = abs(local.y) - size.y;
  float side = local.y < 0.0 ? 37.0 : 0.0;

  // Flames over both edges, thinning out at both ends. Each tongue reaches
  // its own height, which drifts along the edge.
  float ends = 1.0 - smoothstep(size.x - uRadius - 4.0, size.x + 2.0, abs(local.x));
  float reach = uHeight * (0.25 + 0.9 * pow(noise(vec2(p.x / 8.0 + uSeed + side, uTime * 0.8)), 1.3));
  vec2 q = vec2(p.x / 5.0 + uSeed + side, past / 4.0 - uTime * 3.2);
  float sway = fbm(q * 0.5 + vec2(0.0, -uTime));
  float n = fbm(q + vec2(sway * 2.0, 0.0));
  float rise = max(past, 0.0) / reach;
  // Hottest along the edge, fading and breaking up towards the tips.
  float body = (n + 0.25) * (1.0 - rise) * 1.4 + 0.3 * exp(-max(past, 0.0) / 2.0);
  float flame = past > -1.0 ? smoothstep(0.15, 0.8, body) * ends : 0.0;

  // The outline glows all around, brightest where it touches the content.
  float outside = max(edge, 0.0);
  float glow = exp(-outside / 3.0) * 0.55 + exp(-outside) * 0.45;

  float heat = clamp(flame + glow * (0.75 + 0.25 * n), 0.0, 1.0);

  // Sparks rise from the top edge and fade out, each time from somewhere new.
  float sparks = 0.0;
  for (int i = 0; i < 10; i++) {
    float seed = float(i) + uSeed;
    float t = uTime * (0.35 + 0.35 * hash(vec2(seed, 1.0))) + hash(vec2(seed, 2.0));
    float life = fract(t);
    float x = uBox.x + (hash(vec2(seed, floor(t))) * 2.0 - 1.0) * (size.x - uRadius);
    x += sin(life * 9.0 + seed) * 2.0;
    float y = uBox.y + size.y + life * uHeight * 1.4;
    vec2 s = p - vec2(x, y);
    sparks += (1.0 - life) * exp(-dot(s, s) / 0.9);
  }
  sparks = min(sparks, 1.0);

  vec3 color = mix(vec3(0.35, 0.02, 0.01), uColor, smoothstep(0.15, 0.6, heat));
  color = mix(color, uHot, smoothstep(0.9, 1.0, heat));
  float alpha = smoothstep(0.02, 0.7, heat);
  vec3 spark = vec3(1.0, 0.45, 0.2) * sparks;
  outColor = vec4(color * alpha * (1.0 - sparks) + spark, alpha + sparks * (1.0 - alpha));
}`;
