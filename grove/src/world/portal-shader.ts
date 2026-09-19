// The portal sphere's surface. Seen from outside it is a lens onto the other
// room: the far view is clean and opaque toward the disc's centre, and toward
// the limb it bends (a screen-space offset along the view-space normal),
// splits into colours, and swirls, as light would around a mass. The horizon
// shimmers with a hashed noise and faint rings drift over it. Seen from
// inside, the far room does not fade in evenly: it dissolves outward from the
// direction of travel, and near the core the two rooms interpenetrate a
// little, so the step through is a dissolve, not a cut. Without a far view
// (a headset, or too far off) the same surface is a glass veil with the
// horizon and the rings, never a flat tinted ball. The tint is a design
// token; nothing here is a claim about physics. Cost: three texture fetches
// (one per colour channel), two octaves of value noise, no loops otherwise.

/** The tint: a design token, the palace's cool glass. */
export const PORTAL_TINT = "#7f9fbd";
/** Near the core the near room ghosts back this much, so the crossing has something to dissolve. */
export const PORTAL_MELD = 0.25;

export const PORTAL_VERTEX = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vNormalV;
varying vec3 vToEye;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vNormalV = normalize(normalMatrix * normal);
  vToEye = cameraPosition - world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const PORTAL_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uView;
uniform vec2 uResolution;
uniform vec2 uViewScale;
uniform float uBlend;
uniform float uLive;
uniform float uInside;
uniform float uIntent;
uniform float uFade;
uniform float uTime;
uniform vec2 uTravel;
uniform vec3 uTint;
varying vec3 vNormalW;
varying vec3 vNormalV;
varying vec3 vToEye;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x);
  float b = mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x);
  float c = mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x);
  float d = mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}
vec3 farAt(vec2 uv) {
  // The far view fills only uViewScale of the target; stay a texel inside it.
  vec2 t = clamp(uv, vec2(0.0), vec2(1.0)) * uViewScale;
  t = min(t, uViewScale - 1.0 / uResolution);
  return texture2D(uView, t).rgb;
}

void main() {
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(vToEye);
  float facing = abs(dot(n, v));
  float limb = 1.0 - facing;
  float limb2 = limb * limb;

  // The horizon's shimmer: two octaves riding on the sphere, drifting.
  vec3 p = n * 5.0 + vec3(0.0, uTime * 0.22, uTime * 0.07);
  float sh = 0.65 * noise3(p) + 0.35 * noise3(p * 2.3 + 7.1);
  float horizon = pow(limb, 3.0) * (0.5 + 0.9 * sh);
  float rings = pow(0.5 + 0.5 * sin(facing * 26.0 - uTime * 0.9 + sh * 2.0), 14.0) * limb * 0.2;

  // Refraction: bend the far view outward along the screen-space normal,
  // strongest at the limb, swirled as by a lens, split by colour.
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 dir = vNormalV.xy;
  float len = length(dir);
  dir = len > 1e-4 ? dir / len : vec2(0.0);
  float swirl = 0.9 * limb2 * limb;
  float cs = cos(swirl);
  float sn = sin(swirl);
  dir = vec2(dir.x * cs - dir.y * sn, dir.x * sn + dir.y * cs);
  vec2 off = dir * limb2 * 0.07 * vec2(uResolution.y / uResolution.x, 1.0);
  float disp = 0.2 * limb;
  vec3 far = vec3(
    farAt(uv + off * (1.0 - disp)).r,
    farAt(uv + off).g,
    farAt(uv + off * (1.0 + disp)).b
  );

  // How much of the far room shows here. Outside: the window, opaque toward
  // the centre, gone at the limb, opened at the rim by an early blend.
  // Inside: the same window ahead, and a dissolve growing from the direction
  // of travel; near the core the near room ghosts back a little, so the
  // crossing can dissolve it away instead of cutting.
  float window = smoothstep(0.01, 0.38, facing);
  float outside = mix(window * 0.98, 0.98, uBlend * 0.7);
  vec2 sc = (uv - 0.5 - uTravel) * vec2(uResolution.x / uResolution.y, 1.0);
  // Nothing of it at blend 0 (the noise is scaled by the blend), all of it at 1.
  float grow = uBlend * 2.1;
  float dissolve = 1.0 - smoothstep(grow - 0.45, grow + 0.05, length(sc) + 0.05 + (sh - 0.5) * 0.25 * uBlend);
  float meld = ${PORTAL_MELD.toFixed(3)} * smoothstep(0.6, 1.0, uBlend);
  float inside = max(window, dissolve) * (1.0 - meld);
  float a = mix(outside, inside, uInside) * uLive;

  // The veil: glass where the far room does not show, deepening with the
  // blend when there is no far view to show (a headset), so the fade still happens.
  float veilA = (0.04 + 0.28 * limb * sqrt(limb) + 0.55 * uBlend * (1.0 - uLive)) * (1.0 - a);
  vec3 veil = uTint * (0.25 + 0.5 * sh + 0.4 * uIntent * limb);

  // Layered, premultiplied: veil, then the far room over it, then the glow added.
  vec3 P = veil * veilA;
  float A = veilA;
  P = P * (1.0 - a) + far * a;
  A = A * (1.0 - a) + a;
  vec3 glow = uTint * horizon * (1.4 + 0.8 * uIntent) + vec3(1.0, 0.95, 0.85) * rings;
  float glowA = clamp(horizon * 0.9 + rings, 0.0, 1.0) * (1.0 - 0.7 * uBlend * uInside);
  P += glow * glowA;
  A = min(1.0, A + glowA * 0.35);

  // uFade fades the whole layer: the afterglow's dissolve after a crossing.
  gl_FragColor = vec4(P / max(A, 1e-4), A * uFade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
