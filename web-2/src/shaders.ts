// Shared vertex shader for celestial bodies
// Passes world position, world normal, and UV for future texture mapping
export const celestialVertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec2 vUv;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Moon fragment shader
// Computes per-fragment eclipse shadow by checking how much of the Sun disk
// is occluded by Earth, using circle-circle intersection on the angular sky.
// Outputs shading only (base color * lighting * shadow). Multiply with diffuse
// texture later: replace uBaseColor with texture2D(uDiffuseMap, vUv).rgb
export const moonFragmentShader = /* glsl */ `
  #define PI 3.14159265359

  uniform vec3 uSunPos;       // scene coords (ER)
  uniform float uSunRadius;   // scene units (ER)
  uniform float uEarthRadius; // scene units (ER), = 1.0
  uniform vec3 uBaseColor;
  uniform sampler2D uDiffuseMap;
  uniform bool uHasTexture;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec2 vUv;

  // Area of intersection of two circles with radii r1, r2
  // whose centers are separated by distance d.
  float circleOverlap(float r1, float r2, float d) {
    if (d >= r1 + r2) return 0.0;           // no overlap
    if (d + r1 <= r2) return PI * r1 * r1;  // circle 1 inside circle 2
    if (d + r2 <= r1) return PI * r2 * r2;  // circle 2 inside circle 1

    float a1 = acos(clamp((d * d + r1 * r1 - r2 * r2) / (2.0 * d * r1), -1.0, 1.0));
    float a2 = acos(clamp((d * d + r2 * r2 - r1 * r1) / (2.0 * d * r2), -1.0, 1.0));
    float radical = (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2);
    return r1 * r1 * a1 + r2 * r2 * a2 - 0.5 * sqrt(max(0.0, radical));
  }

  void main() {
    vec3 N = normalize(vWorldNormal);

    // Sun lighting
    vec3 toSun = uSunPos - vWorldPos;
    float distToSun = length(toSun);
    vec3 L = toSun / distToSun;
    float NdotL = max(0.0, dot(N, L));

    // Eclipse: what fraction of the Sun disk is visible from this fragment?
    float distToEarth = length(vWorldPos); // Earth at origin
    vec3 toEarth = -vWorldPos / distToEarth;

    // Angular radii as seen from this surface point
    float angSun   = asin(clamp(uSunRadius   / distToSun,   0.0, 1.0));
    float angEarth = asin(clamp(uEarthRadius / distToEarth, 0.0, 1.0));

    // Angular separation between Sun center and Earth center
    float angSep = acos(clamp(dot(L, toEarth), -1.0, 1.0));

    // Fraction of Sun disk blocked
    float sunArea = PI * angSun * angSun;
    float blocked = circleOverlap(angSun, angEarth, angSep);
    float sunVisible = 1.0 - clamp(blocked / sunArea, 0.0, 1.0);

    // Blood moon: Earth's atmosphere refracts red/orange light into the umbra.
    // This light comes from the ring of atmosphere at Earth's limb,
    // so it illuminates from Earth's direction.
    float inShadow = 1.0 - sunVisible;
    float earthFacing = max(0.0, dot(N, toEarth));
    vec3 bloodMoon = vec3(0.22, 0.035, 0.01) * inShadow * inShadow * earthFacing;

    // Combine: diffuse * shadow + blood moon + ambient
    float ambient = 0.008;
    vec3 baseColor = uHasTexture ? texture2D(uDiffuseMap, vUv).rgb : uBaseColor;
    vec3 shading = baseColor * (NdotL * sunVisible + ambient) + bloodMoon;

    gl_FragColor = vec4(shading, 1.0);
  }
`;

// Earth fragment shader
// Simple diffuse shading from Sun. Multiply with diffuse texture later.
export const earthFragmentShader = /* glsl */ `
  uniform vec3 uSunPos;
  uniform vec3 uBaseColor;
  uniform sampler2D uDayMap;
  uniform sampler2D uNightMap;
  uniform bool uHasTexture;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec2 vUv;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunPos - vWorldPos);
    float NdotL = max(0.0, dot(N, L));

    float ambient = 0.04;
    // Slight limb darkening on the terminator
    float wrap = max(0.0, NdotL * 0.85 + 0.15);

    vec3 dayColor = uHasTexture ? texture2D(uDayMap, vUv).rgb : uBaseColor;
    vec3 shading = dayColor * (wrap * 0.9 + ambient);

    // Blend in night lights on the dark side
    if (uHasTexture) {
      vec3 nightColor = texture2D(uNightMap, vUv).rgb;
      float nightBlend = smoothstep(0.0, 0.15, -NdotL + 0.1);
      shading += nightColor * nightBlend;
    }

    gl_FragColor = vec4(shading, 1.0);
  }
`;
