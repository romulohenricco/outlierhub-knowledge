"use client";

/**
 * LiveOrb — orb com olhos e boca (WebGL), portado do sistema privado
 * knowledge.ohomer.space. Os olhos seguem o cursor, piscam sozinhos e, em
 * repouso, o orb olha em volta. Sem WebGL (ou com contexto perdido) cai num
 * orb estático feito de CSS, com o mesmo desenho.
 */

import { useEffect, useRef, useState } from "react";

type Variante = "white" | "black";

const CORES: Record<Variante, { body: string; eye: string }> = {
  white: { body: "#F4F4F5", eye: "#09090B" },
  black: { body: "#18181B", eye: "#F4F4F5" },
};

const VERTEX = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_blink;
uniform float u_mouth;
uniform vec2 u_look;
uniform vec3 u_body;
uniform vec3 u_eye;

vec3 orient(vec3 p, vec2 look) {
  float yaw = look.x * 0.92;
  float pitch = -look.y * 0.78;
  float cy = cos(yaw);
  float sy = sin(yaw);
  float cp = cos(pitch);
  float sp = sin(pitch);
  vec3 q = vec3(p.x, p.y * cp - p.z * sp, p.y * sp + p.z * cp);
  return vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
}

float eyeMask(vec3 n, vec3 e, vec3 right, vec3 up, float halfH, float rad) {
  float facing = dot(n, e);
  float x = dot(n, right) - dot(e, right);
  float y = dot(n, up) - dot(e, up);
  y -= clamp(y, -halfH, halfH);
  float d = length(vec2(x, y)) - rad;
  float fill = 1.0 - smoothstep(-0.01, 0.01, d);
  return fill * smoothstep(0.12, 0.32, facing);
}

// Sorriso: arco parabólico grosso, pontas pra cima, centrado em m.
float mouthMask(vec3 n, vec3 m, vec3 right, vec3 up, float halfW, float th) {
  float facing = dot(n, m);
  float x = dot(n, right) - dot(m, right);
  float y = dot(n, up) - dot(m, up);
  float cx = clamp(x, -halfW, halfW);
  float d = length(vec2(x - cx, y - 2.4 * cx * cx)) - th;
  float fill = 1.0 - smoothstep(-0.01, 0.01, d);
  return fill * smoothstep(0.12, 0.32, facing);
}

void main() {
  vec2 uv = (gl_FragCoord.xy / u_resolution.xy) * 2.0 - 1.0;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  uv.x *= aspect;

  float radius = 0.94;
  vec2 p = uv / radius;
  float r2 = dot(p, p);
  float edge = 1.0 - smoothstep(0.985, 1.012, sqrt(max(r2, 0.0)));
  if (edge <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = normalize(vec3(p, z));

  vec2 look = u_look;
  float lm = length(look);
  if (lm > 1.0) look /= lm;

  vec3 right = orient(vec3(1.0, 0.0, 0.0), look);
  vec3 up = orient(vec3(0.0, 1.0, 0.0), look);
  vec3 eL = orient(normalize(vec3(-0.32, 0.08, 1.0)), look);
  vec3 eR = orient(normalize(vec3(0.32, 0.08, 1.0)), look);

  float halfH = mix(0.128, 0.012, u_blink);
  float rad = mix(0.054, 0.062, u_blink);
  float eyes = max(
    eyeMask(n, eL, right, up, halfH, rad),
    eyeMask(n, eR, right, up, halfH, rad)
  );
  if (u_mouth > 0.5) {
    vec3 mo = orient(normalize(vec3(0.0, -0.3, 1.0)), look);
    eyes = max(eyes, mouthMask(n, mo, right, up, 0.13, 0.03));
  }

  vec3 col = mix(u_body, u_eye, clamp(eyes, 0.0, 1.0));
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), edge);
}
`;

function hexParaRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const v = Number.parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6), 16);
  if (Number.isNaN(v)) return [0.96, 0.96, 0.96];
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function compilar(gl: WebGLRenderingContext, tipo: number, fonte: string) {
  const s = gl.createShader(tipo);
  if (!s) return null;
  gl.shaderSource(s, fonte);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

type Opcoes = { variant: Variante; interactive: boolean; blink: boolean; mouth: boolean };

function iniciar(canvas: HTMLCanvasElement, opcoes: () => Opcoes, aoMudarGl: (ok: boolean) => void) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  let programa: WebGLProgram | null = null;
  let vs: WebGLShader | null = null;
  let fs: WebGLShader | null = null;
  let buffer: WebGLBuffer | null = null;
  let uRes: WebGLUniformLocation | null = null;
  let uLook: WebGLUniformLocation | null = null;
  let uBlink: WebGLUniformLocation | null = null;
  let uMouth: WebGLUniformLocation | null = null;
  let uBody: WebGLUniformLocation | null = null;
  let uEye: WebGLUniformLocation | null = null;

  const montar = () => {
    vs = compilar(gl, gl.VERTEX_SHADER, VERTEX);
    fs = compilar(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return false;
    const p = gl.createProgram();
    if (!p) return false;
    programa = p;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return false;
    gl.useProgram(p);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(p, "a_position");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    uRes = gl.getUniformLocation(p, "u_resolution");
    uLook = gl.getUniformLocation(p, "u_look");
    uBlink = gl.getUniformLocation(p, "u_blink");
    uMouth = gl.getUniformLocation(p, "u_mouth");
    uBody = gl.getUniformLocation(p, "u_body");
    uEye = gl.getUniformLocation(p, "u_eye");
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, canvas.width, canvas.height);
    return true;
  };

  if (!montar()) return null;
  aoMudarGl(true);

  const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)");
  const alvoRepouso = { x: 0, y: 0.08 };
  let olhar = { x: 0, y: 0.08 };
  const alvoOcioso = { x: 0, y: 0.08 };
  const olharAlvo = { x: 0, y: 0.08 };
  let raf = 0;
  let destruido = false;
  let perdido = false;
  let visivel = true;
  let ultimo = 0;
  let relogio = 0;
  let proximoPiscar = 1800 + 2400 * Math.random();
  let inicioPiscar = -1e4;
  let proximoOlhar = 600 + 900 * Math.random();
  let ultimoPonteiro = -Infinity;

  const ajustar = () => {
    const pai = canvas.parentElement;
    if (!pai) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = pai.clientWidth;
    const h = pai.clientHeight;
    if (w <= 0 || h <= 0) return false;
    const pw = Math.max(1, Math.floor(w * dpr));
    const ph = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    if (pw !== canvas.width || ph !== canvas.height) {
      canvas.width = pw;
      canvas.height = ph;
      gl.viewport(0, 0, canvas.width, canvas.height);
      return true;
    }
    return false;
  };

  const agendar = () => {
    if (raf || destruido || perdido) return;
    ultimo = performance.now();
    raf = requestAnimationFrame(quadro);
  };

  const aoMoverPonteiro = (ev: PointerEvent) => {
    if (!opcoes().interactive) return;
    const pai = canvas.parentElement;
    if (!pai) return;
    const r = pai.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const x = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const y = (r.top + r.height / 2 - ev.clientY) / (r.height / 2);
    olharAlvo.x = Math.min(1, Math.max(-1, x));
    olharAlvo.y = Math.min(1, Math.max(-1, y));
    ultimoPonteiro = performance.now();
    if (visivel) agendar();
  };
  window.addEventListener("pointermove", aoMoverPonteiro, { passive: true });

  const quadro = (agora: number) => {
    raf = 0;
    if (perdido) return;
    const dt = Math.min(50, Math.max(0, agora - ultimo));
    ultimo = agora;
    const ativo = visivel && !reduzido.matches && document.visibilityState !== "hidden";
    if (ativo) relogio += dt;

    const o = opcoes();
    const cores = CORES[o.variant] ?? CORES.white;
    const reduz = reduzido.matches;
    const seguindo = o.interactive && agora - ultimoPonteiro < 3000;

    // em repouso, o orb olha em volta
    if (!seguindo && ativo && relogio >= proximoOlhar) {
      const centro = 0.3 > Math.random();
      alvoOcioso.x = centro ? 0 : (2 * Math.random() - 1) * 0.8;
      alvoOcioso.y = centro ? 0.08 : (2 * Math.random() - 1) * 0.5;
      proximoOlhar = relogio + 900 + 2100 * Math.random();
    }
    const alvo = seguindo ? olharAlvo : reduz ? alvoRepouso : alvoOcioso;
    const k = ativo ? (seguindo ? 0.16 : 0.1) : 1;
    olhar = { x: olhar.x + (alvo.x - olhar.x) * k, y: olhar.y + (alvo.y - olhar.y) * k };

    if (!reduz && o.blink && relogio >= proximoPiscar) {
      inicioPiscar = relogio;
      proximoPiscar = relogio + 2200 + 3800 * Math.random();
    }
    const t = (relogio - inicioPiscar) / 1000;
    let piscar = 0;
    if (!reduz && o.blink) {
      if (t < 0.055) piscar = t / 0.055;
      else if (t < 0.1) piscar = 1;
      else if (t < 0.18) piscar = 1 - (t - 0.1) / 0.08;
    }

    const corpo = hexParaRgb(cores.body);
    const olho = hexParaRgb(cores.eye);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform2f(uLook, olhar.x, olhar.y);
    gl.uniform1f(uBlink, piscar);
    gl.uniform1f(uMouth, o.mouth ? 1 : 0);
    gl.uniform3f(uBody, corpo[0], corpo[1], corpo[2]);
    gl.uniform3f(uEye, olho[0], olho[1], olho[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (ativo && !destruido) raf = requestAnimationFrame(quadro);
  };

  const ro = new ResizeObserver(() => {
    if (ajustar() && !destruido && !perdido) {
      cancelAnimationFrame(raf);
      raf = 0;
      quadro(performance.now());
    }
  });
  if (canvas.parentElement) ro.observe(canvas.parentElement);
  const io = new IntersectionObserver((e) => {
    visivel = e[0]?.isIntersecting ?? true;
    agendar();
  });
  io.observe(canvas);
  const aoVisibilidade = () => agendar();
  document.addEventListener("visibilitychange", aoVisibilidade);
  reduzido.addEventListener("change", aoVisibilidade);

  const aoPerderContexto = (ev: Event) => {
    ev.preventDefault();
    perdido = true;
    cancelAnimationFrame(raf);
    raf = 0;
    canvas.style.visibility = "hidden";
    aoMudarGl(false);
  };
  const aoRestaurarContexto = () => {
    if (!destruido && montar()) {
      perdido = false;
      canvas.style.visibility = "";
      aoMudarGl(true);
      agendar();
    }
  };
  canvas.addEventListener("webglcontextlost", aoPerderContexto);
  canvas.addEventListener("webglcontextrestored", aoRestaurarContexto);

  ajustar();
  agendar();

  return {
    destroy() {
      destruido = true;
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", aoVisibilidade);
      reduzido.removeEventListener("change", aoVisibilidade);
      window.removeEventListener("pointermove", aoMoverPonteiro);
      canvas.removeEventListener("webglcontextlost", aoPerderContexto);
      canvas.removeEventListener("webglcontextrestored", aoRestaurarContexto);
      if (programa) gl.deleteProgram(programa);
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      if (buffer) gl.deleteBuffer(buffer);
      const ext = gl.getExtension("WEBGL_lose_context");
      queueMicrotask(() => {
        if (!canvas.isConnected && !gl.isContextLost()) ext?.loseContext();
      });
    },
  };
}

export type LiveOrbProps = {
  /** diâmetro em px */
  size?: number;
  variant?: Variante;
  /** os olhos seguem o cursor */
  interactive?: boolean;
  blink?: boolean;
  mouth?: boolean;
  className?: string;
};

export function LiveOrb({ size = 26, variant = "white", interactive = true, blink = true, mouth = false, className }: LiveOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const opcoesRef = useRef<Opcoes>({ variant, interactive, blink, mouth });
  const [temGl, setTemGl] = useState(true);

  useEffect(() => {
    opcoesRef.current = { variant, interactive, blink, mouth };
  }, [variant, interactive, blink, mouth]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctl = iniciar(canvas, () => opcoesRef.current, setTemGl);
    if (!ctl) {
      setTemGl(false);
      return;
    }
    return () => ctl.destroy();
  }, []);

  const c = CORES[variant] ?? CORES.white;

  return (
    <div
      data-slot="live-orb"
      role="img"
      aria-label="Orb"
      className={className}
      style={{ position: "relative", flexShrink: 0, width: size, height: size }}
    >
      {temGl ? null : (
        <div
          aria-hidden
          style={{ position: "absolute", inset: "2%", overflow: "hidden", borderRadius: "9999px", backgroundColor: c.body }}
        >
          <span style={{ position: "absolute", borderRadius: "9999px", backgroundColor: c.eye, width: "13%", height: "28%", left: "31%", top: "34%" }} />
          <span style={{ position: "absolute", borderRadius: "9999px", backgroundColor: c.eye, width: "13%", height: "28%", left: "56%", top: "34%" }} />
          {mouth ? (
            <span
              style={{
                position: "absolute",
                borderRadius: "0 0 9999px 9999px",
                borderBottom: `${Math.max(2, size * 0.06)}px solid ${c.eye}`,
                width: "34%",
                height: "14%",
                left: "33%",
                top: "62%",
              }}
            />
          ) : null}
        </div>
      )}
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
    </div>
  );
}

export default LiveOrb;
