import * as THREE from 'three';
import { cellPos, terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { MAX_HEIGHT, SEA_LEVEL, WORLD_SIZE } from '../worldgen/types';

function waterMat(color: number): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    color,
    transparent: true,
    opacity: 0.82,
    shininess: 90,
    specular: 0x88bbdd,
  });
}

export function buildWater(world: WorldData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'water';
  if (world.coastEdge >= 0) {
    const g = new THREE.PlaneGeometry(WORLD_SIZE * 1.4, WORLD_SIZE * 1.4, 1, 1);
    g.rotateX(-Math.PI / 2);
    const sea = new THREE.Mesh(g, waterMat(0x2b5a72));
    sea.position.y = SEA_LEVEL * MAX_HEIGHT - 1;
    group.add(sea);
  }
  // river ribbons
  const positions: number[] = [];
  const indices: number[] = [];
  let vc = 0;
  for (const r of world.rivers) {
    const main = r === world.rivers[0];
    for (let n = 0; n < r.length - 1; n++) {
      const p0 = cellPos(r[n][0], r[n][1]);
      const p1 = cellPos(r[n + 1][0], r[n + 1][1]);
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      const wdt = 6 + (main ? 7 : 0);
      const y0 = terrainHeight(world.heightmap, p0.x, p0.z) + 1;
      const y1 = terrainHeight(world.heightmap, p1.x, p1.z) + 1;
      positions.push(
        p0.x + nx * wdt,
        y0,
        p0.z + nz * wdt,
        p0.x - nx * wdt,
        y0,
        p0.z - nz * wdt,
        p1.x + nx * wdt,
        y1,
        p1.z + nz * wdt,
        p1.x - nx * wdt,
        y1,
        p1.z - nz * wdt,
      );
      indices.push(vc, vc + 1, vc + 2, vc + 1, vc + 3, vc + 2);
      vc += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  group.add(new THREE.Mesh(g, waterMat(0x35708c)));
  return group;
}

export interface SkyHandle {
  mesh: THREE.Mesh;
  uniforms: {
    topColor: { value: THREE.Color };
    botColor: { value: THREE.Color };
    sunPos: { value: THREE.Vector3 };
    nightMix: { value: number };
  };
}

/** Gradient sky dome with sun glow and night stars (ANNALS shader). */
export function buildSky(): SkyHandle {
  const uniforms = {
    topColor: { value: new THREE.Color(0x2a5a9a) },
    botColor: { value: new THREE.Color(0xe8c98a) },
    sunPos: { value: new THREE.Vector3(0.4, 0.55, 0.25).normalize() },
    nightMix: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `varying vec3 vP;
      void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec3 vP;
      uniform vec3 topColor,botColor,sunPos;uniform float nightMix;
      void main(){float t=clamp(vP.y*0.5+0.5,0.0,1.0);
        vec3 day=mix(botColor,topColor,pow(t,0.7));
        vec3 night=mix(vec3(0.03,0.04,0.10),vec3(0.02,0.03,0.09),t);
        float sd=max(dot(vP,normalize(sunPos)),0.0);
        vec3 col=mix(day,night,nightMix);
        col+=vec3(1.0,0.7,0.35)*pow(sd,64.0)*(1.0-nightMix)*0.8;
        col+=vec3(1.0,0.9,0.6)*pow(sd,900.0)*1.5;
        float star=step(0.9995,fract(sin(dot(floor(vP*260.0),vec3(12.9898,78.233,37.719)))*43758.5453));
        col+=star*nightMix*0.9;
        gl_FragColor=vec4(col,1.0);}`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(WORLD_SIZE * 3, 24, 16), mat);
  mesh.name = 'sky';
  return { mesh, uniforms };
}
