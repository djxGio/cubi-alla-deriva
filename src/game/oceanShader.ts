import * as THREE from 'three';

export interface OceanUniforms {
  uTime: { value: number };
  uDetailTime: { value: number };
  uIslandRadius: { value: number };
  uWeatherIntensity: { value: number };
  uNightFactor: { value: number };
  uStormCells: { value: THREE.Vector4[] };
}

export function createOceanUniforms(): OceanUniforms {
  return {
    uTime: { value: 0 },
    uDetailTime: { value: 0 },
    uIslandRadius: { value: 11 },
    uWeatherIntensity: { value: 0 },
    uNightFactor: { value: 0 },
    uStormCells: {
      value: [
        new THREE.Vector4(0, 0, 20, 0),
        new THREE.Vector4(0, 0, 20, 0),
        new THREE.Vector4(0, 0, 20, 0),
      ],
    },
  };
}

export function createWeatherOceanMesh(uniforms: OceanUniforms): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(580, 580, 144, 144);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.18,
    metalness: 0.1,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uDetailTime = uniforms.uDetailTime;
    shader.uniforms.uIslandRadius = uniforms.uIslandRadius;
    shader.uniforms.uWeatherIntensity = uniforms.uWeatherIntensity;
    shader.uniforms.uNightFactor = uniforms.uNightFactor;
    shader.uniforms.uStormCells = uniforms.uStormCells;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform float uIslandRadius;
         uniform float uWeatherIntensity;
         uniform vec4 uStormCells[3];
         varying vec3 vWorldPos;
         varying float vWaveSlope;
         varying float vCrestFactor;
         varying float vLocalWeather;
         varying vec3 vViewRight;
         varying vec3 vViewForward;

         float computeLocalWeather(vec2 xz) {
           float boost = 0.0;
           for (int i = 0; i < 3; i++) {
             vec4 cell = uStormCells[i];
             if (cell.w > 0.5) {
               float dCell = length(xz - cell.xy);
               boost += smoothstep(cell.z * 1.4, 0.0, dCell) * 0.62;
             }
           }
           return clamp(uWeatherIntensity + boost, 0.0, 1.35);
         }

         float evalOceanWave(vec2 xz, out float localWeatherOut, out float calmOut, out float crestOut) {
           float dist = length(xz);
           float calm = clamp((dist - uIslandRadius * 0.9) / 72.0, 0.08, 1.0);
           float w = computeLocalWeather(xz);
           float sharpenMix = clamp(w, 0.0, 1.0);

           float p1 = xz.x * 0.068 + xz.y * 0.025 + uTime * 1.15;
           float s1 = sin(p1);
           float peak1 = pow(max(0.0, s1 * 0.5 + 0.5), 1.65) * 2.0 - 1.0;
           float crest1 = mix(s1, peak1, sharpenMix);

           float p2 = xz.y * 0.082 - xz.x * 0.032 + uTime * 1.45;
           float s2 = cos(p2);
           float peak2 = pow(max(0.0, s2 * 0.5 + 0.5), 1.55) * 2.0 - 1.0;
           float crest2 = mix(s2, peak2, sharpenMix);

           float w3 = sin((xz.x + xz.y) * 0.165 - uTime * 2.55) * (0.22 + w * 0.58);

           float chopFade = smoothstep(0.18, 1.0, w);
           float stormChop = (
             sin(xz.x * 0.27 - xz.y * 0.23 + uTime * 3.65) * 0.55 +
             cos(xz.x * 0.34 + xz.y * 0.29 - uTime * 4.35) * 0.45
           ) * chopFade * 0.72;

           float swellAmp = (0.20 + calm * 0.58) * (1.0 + w * 1.65);
           float rawSum = crest1 * 0.62 + crest2 * 0.42 + w3 + stormChop;

           localWeatherOut = w;
           calmOut = calm;
           crestOut = clamp(rawSum * 0.45 + 0.35, 0.0, 1.0);
           return rawSum * swellAmp;
         }`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         float _lwC = 0.0;
         float _calmC = 0.0;
         float _crestC = 0.0;
         float _lwDummy = 0.0;
         float _calmDummy = 0.0;
         float _crestDummy = 0.0;
         float _oceanH = evalOceanWave(position.xz, _lwC, _calmC, _crestC);
         float _eps = 0.7;
         float _hX = evalOceanWave(position.xz + vec2(_eps, 0.0), _lwDummy, _calmDummy, _crestDummy);
         float _hZ = evalOceanWave(position.xz + vec2(0.0, _eps), _lwDummy, _calmDummy, _crestDummy);
         float _dhdx = (_hX - _oceanH) / _eps;
         float _dhdz = (_hZ - _oceanH) / _eps;
         objectNormal = normalize(vec3(-_dhdx, 1.0, -_dhdz));
         vWaveSlope = clamp(length(vec2(_dhdx, _dhdz)) * 1.65, 0.0, 1.0);
         vCrestFactor = _crestC;
         vLocalWeather = _lwC;
         vViewRight = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
         vViewForward = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed.y += _oceanH;
         float _pinch = _calmC * (0.22 + clamp(_lwC, 0.0, 1.0) * 0.48);
         transformed.x -= _dhdx * _pinch;
         transformed.z -= _dhdz * _pinch;
         vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uDetailTime;
         uniform float uIslandRadius;
         uniform float uWeatherIntensity;
         uniform float uNightFactor;
         varying vec3 vWorldPos;
         varying float vWaveSlope;
         varying float vCrestFactor;
         varying float vLocalWeather;
         varying vec3 vViewRight;
         varying vec3 vViewForward;

         float oceanHash(vec2 p) {
           return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
         }

         float oceanNoise(vec2 p) {
           vec2 i = floor(p);
           vec2 f = fract(p);
           vec2 u = f * f * (3.0 - 2.0 * f);
           float a = oceanHash(i);
           float b = oceanHash(i + vec2(1.0, 0.0));
           float c = oceanHash(i + vec2(0.0, 1.0));
           float d = oceanHash(i + vec2(1.0, 1.0));
           return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
         }

         float rainRippleRing(vec2 xz, float t) {
           vec2 cell = floor(xz * 0.42);
           vec2 local = fract(xz * 0.42) - 0.5;
           float rnd = oceanHash(cell);
           float phase = fract(t * (0.95 + rnd * 0.65) + rnd * 6.28);
           float dist = length(local - (vec2(rnd, fract(rnd * 13.7)) - 0.5) * 0.35);
           float ring = sin((dist - phase * 0.48) * 34.0) * exp(-abs(dist - phase * 0.48) * 18.0);
           return ring * (1.0 - phase);
         }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float dCenter = length(vWorldPos.xz);
         vec3 shallowCol = vec3(0.18, 0.85, 0.77);
         vec3 reefCol = vec3(0.02, 0.56, 0.80);
         vec3 deepCol = vec3(0.03, 0.25, 0.46);
         vec3 stormCol = vec3(0.04, 0.14, 0.23);

         float t1 = smoothstep(uIslandRadius - 1.0, uIslandRadius + 30.0, dCenter);
         float t2 = smoothstep(uIslandRadius + 30.0, 138.0, dCenter);
         vec3 seaCol = mix(shallowCol, reefCol, t1);
         seaCol = mix(seaCol, deepCol, t2);
         seaCol = mix(seaCol, stormCol, clamp(vLocalWeather * 0.55, 0.0, 0.72));
         seaCol = mix(seaCol, seaCol * vec3(0.55, 0.68, 0.85), uNightFactor * 0.62);

         // Subsurface turquoise scatter inside sunlit crests
         float sss = pow(vCrestFactor, 2.0) * (1.0 - uWeatherIntensity * 0.65) * (1.0 - uNightFactor * 0.75);
         seaCol += vec3(0.05, 0.22, 0.24) * sss;

         // Procedural whitecap & storm-crest foam lace
         float foamNoise = oceanNoise(vWorldPos.xz * 0.38 + vec2(uDetailTime * 0.35, -uDetailTime * 0.25)) * 0.65
                         + oceanNoise(vWorldPos.xz * 0.95 - vec2(uDetailTime * 0.55, uDetailTime * 0.42)) * 0.35;
         float crestThreshold = mix(0.84, 0.42, clamp(vLocalWeather, 0.0, 1.0));
         float crestWhitecap = smoothstep(crestThreshold, crestThreshold + 0.38, vCrestFactor * 0.72 + vWaveSlope * 0.52 + foamNoise * 0.34);
         crestWhitecap *= mix(0.28, 0.95, clamp(vLocalWeather * 0.85 + 0.15, 0.0, 1.0));

         // Shore lapping foam
         float shorePulse = sin(dCenter * 1.4 - uDetailTime * (1.6 + uWeatherIntensity * 1.8)) * 0.25 + 0.75;
         float shoreBand = 1.0 - smoothstep(uIslandRadius - 0.9, uIslandRadius + 2.4 + uWeatherIntensity * 1.8, dCenter);
         float shoreFoam = shoreBand * shorePulse * (0.48 + uWeatherIntensity * 0.34);

         float totalFoam = clamp(crestWhitecap + shoreFoam, 0.0, 0.88);
         vec3 foamCol = mix(vec3(0.92, 0.98, 1.0), vec3(0.76, 0.84, 0.92), uNightFactor * 0.45);
         diffuseColor.rgb = mix(seaCol, foamCol, totalFoam);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         float _calmRough = mix(0.12, 0.34, clamp(vLocalWeather * 0.8 + vWaveSlope * 0.45, 0.0, 1.0));
         roughnessFactor = clamp(mix(_calmRough, 0.68, totalFoam), 0.10, 0.78);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         float _nScale = 0.08 + clamp(vLocalWeather, 0.0, 1.2) * 0.16;
         float _r1 = sin(vWorldPos.x * 1.15 + uDetailTime * 2.2) * cos(vWorldPos.z * 1.05 - uDetailTime * 1.7);
         float _r2 = cos(vWorldPos.x * 1.85 - vWorldPos.z * 1.45 + uDetailTime * 3.1);
         float _rainWeight = smoothstep(0.12, 0.95, uWeatherIntensity);
         float _rainR = rainRippleRing(vWorldPos.xz, uDetailTime) * _rainWeight * 0.32;
         float _px = (_r1 * 0.6 + _r2 * 0.4) * _nScale + _rainR;
         float _pz = (_r2 * 0.6 - _r1 * 0.4) * _nScale + _rainR;
         normal = normalize(normal + vViewRight * _px + vViewForward * _pz);`
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
