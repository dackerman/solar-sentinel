import * as THREE from 'three';

// A continuous sky canopy: no billboards, gaps at full cover, or per-frame allocations.
// Two cloud scales share the same cover threshold so the slider changes coverage,
// while optical depth and directional edge light give the clouds their volume.
export function createAtmosphereMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color('#1875d5') },
      horizon: { value: new THREE.Color('#b9d9f2') },
      cloudCover: { value: 0 },
      daylight: { value: 1 },
      storm: { value: 0 },
      dusk: { value: 0 },
      time: { value: 0 },
      drift: { value: new THREE.Vector2() },
      sunDirection: { value: new THREE.Vector3(-0.4, 0.7, -0.6).normalize() },
    },
    vertexShader: `
      varying vec3 skyDirection;
      void main() {
        skyDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 top, horizon, sunDirection;
      uniform float cloudCover, daylight, storm, dusk, time;
      uniform vec2 drift;
      varying vec3 skyDirection;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float cloudNoise(vec2 p) {
        float n = 0.0, weight = 0.55;
        mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
        for (int i = 0; i < 5; i++) {
          n += noise(p) * weight;
          p = turn * p * 2.03 + 13.7;
          weight *= 0.48;
        }
        return n;
      }
      void main() {
        vec3 ray = normalize(skyDirection);
        float height = max(ray.y, 0.0);
        vec3 sky = mix(horizon, top, pow(clamp(height * 1.8, 0.0, 1.0), 0.55));
        float sunDot = max(dot(ray, sunDirection), 0.0);
        // Broad atmospheric glow and a small bright solar disc disappear behind clouds.
        sky += vec3(1.0, 0.69, 0.35) * pow(sunDot, 18.0) * daylight * 0.28;
        sky += vec3(3.5, 2.7, 1.7) * smoothstep(0.9993, 0.9998, sunDot) * daylight;
        // Project onto a high cloud deck; the horizon compresses clouds into distant banks.
        vec2 p = ray.xz / max(height + 0.12, 0.12) * 2.0;
        p += drift * time * 0.018;
        float n = cloudNoise(p);
        float detail = cloudNoise(p * 2.7 + vec2(19.3, 8.1));
        float body = n * 0.82 + detail * 0.18;
        float threshold = mix(0.78, 0.22, cloudCover);
        float density = smoothstep(threshold - 0.085, threshold + 0.085, body);
        density *= smoothstep(0.0, 0.035, cloudCover);
        float depth = clamp((body - threshold) * 2.3 + 0.18, 0.0, 1.0);
        float facing = cloudNoise(p + normalize(sunDirection.xz + vec2(0.001)) * 0.16);
        float rim = clamp((n - facing) * 4.5 + 0.48, 0.0, 1.0);
        vec3 underside = mix(vec3(0.30, 0.39, 0.51), vec3(0.12, 0.17, 0.25), storm);
        vec3 crown = mix(vec3(0.96, 0.97, 1.0), vec3(0.66, 0.73, 0.81), cloudCover * 0.7);
        crown = mix(crown, vec3(1.0, 0.66, 0.40), dusk * 0.5);
        vec3 cloud = mix(underside, crown, clamp(rim * 0.75 + (1.0 - depth) * 0.4, 0.0, 1.0));
        cloud += vec3(1.0, 0.85, 0.62) * pow(sunDot, 9.0) * (1.0 - density) * 0.5;
        cloud *= mix(0.10, 1.0, daylight);
        // At 100% every ray sees opaque cloud, with texture still visible across the deck.
        float opacity = mix(density, 1.0, smoothstep(0.93, 1.0, cloudCover));
        vec3 color = mix(sky, cloud, opacity);
        color = mix(horizon, color, smoothstep(-0.08, 0.08, ray.y));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}
