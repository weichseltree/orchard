import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from "three";
import type { Sky } from "./schema";

// What is outside the mansion. The hall's six windows and its doorway are open
// apertures (WP3 bakes sun and sky through them), so without an outside the
// room reads as having seven voids in its walls and the windows show the page
// background. This is the smallest outside: a gradient dome with the sun in
// the place the bake put it, so the pools on the floor and the disc in the
// window agree. An HDR or a real exterior is a later milestone.

/** Dome radius, metres. The palace front is 128 m and the orchard reaches 130 m; the camera's far plane is 600. */
export const SKY_RADIUS = 400;

/**
 * The bake records the sunlight's TRAVEL direction in Blender's Z-up axes.
 * glTF is Y-up, (x, y, z)_blender -> (x, z, -y)_gltf, and the dome wants the
 * direction TOWARDS the sun, so the whole conversion is (-x, -z, y).
 */
export function sunFromBlenderTravel(travel: readonly [number, number, number]): Vector3 {
  return new Vector3(-travel[0], -travel[2], travel[1]).normalize();
}

/**
 * The sun the room's own bake record names, if the asset carries one. WP3's
 * hall.json has `lighting.sun_direction_blender`; the glb's extras gain it on
 * the next bake. Null means "mansion.json's copy stands".
 */
export function sunFromAsset(provenance: Record<string, unknown>): Vector3 | null {
  const orchard = provenance.orchard as Record<string, unknown> | undefined;
  const lighting = orchard?.lighting as Record<string, unknown> | undefined;
  const travel = lighting?.sun_direction_blender;
  if (
    !Array.isArray(travel) ||
    travel.length !== 3 ||
    !travel.every((c) => typeof c === "number" && Number.isFinite(c))
  ) {
    return null;
  }
  const v = sunFromBlenderTravel(travel as [number, number, number]);
  return v.lengthSq() > 0 ? v : null;
}

export interface SkyDome {
  mesh: Mesh;
  /** Where the sun is, as a unit vector towards it in world axes. */
  readonly sun: Vector3;
  setSun(towards: Vector3): void;
  dispose(): void;
}

const VERTEX_SHADER = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  // Direction from the eye, not from the dome's centre: the visitor walks up
  // to 20 m off-centre and the horizon must not tilt with them.
  vDir = world.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uSunCos;
uniform float uSunIntensity;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  // Sky: pale at the horizon, saturating towards the zenith. Ground: the
  // horizon haze darkening quickly below eye level.
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.45));
  vec3 ground = mix(uHorizon, uGround, smoothstep(0.0, 0.08, -up));
  vec3 c = up >= 0.0 ? sky : ground;
  float s = dot(d, uSunDir);
  // A wide haze around the sun and the disc itself, which is meant to blow out.
  c += uSunColor * uSunIntensity * 0.25 * pow(max(s, 0.0), 24.0);
  c += uSunColor * uSunIntensity * 4.0 * smoothstep(uSunCos - 0.0004, uSunCos, s);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

export function buildSky(sky: Sky): SkyDome {
  const sun = sunFromBlenderTravel(sky.sunTravelBlender);
  const material = new ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uZenith: { value: new Color(sky.zenith) },
      uHorizon: { value: new Color(sky.horizon) },
      uGround: { value: new Color(sky.ground) },
      uSunColor: { value: new Color(sky.sun) },
      uSunDir: { value: sun.clone() },
      uSunCos: { value: Math.cos(((sky.sunAngleDeg / 2) * Math.PI) / 180) },
      uSunIntensity: { value: sky.sunIntensity },
    },
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  const geometry = new SphereGeometry(SKY_RADIUS, 32, 16);
  const mesh = new Mesh(geometry, material);
  mesh.name = "sky";
  // Drawn first, behind everything; never culled, because the eye is inside it.
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return {
    mesh,
    sun,
    setSun(towards) {
      sun.copy(towards).normalize();
      (material.uniforms.uSunDir as { value: Vector3 }).value.copy(sun);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
