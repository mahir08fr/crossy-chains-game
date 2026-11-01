import { MeshStandardMaterial, Vector4 } from 'three';
import type { RiverLayout } from '@crossy/config';

/** All coordinates are world-space: coverage growth and adjacent section meshes
 * cannot restart a texture or expose the old physical corridor edges. */
export function grassMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: 0x64998b, roughness: 1 });
  material.name = 'environment-grass';
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 environmentPosition;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nenvironmentPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 environmentPosition;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float meadow = sin(environmentPosition.x * .31 + sin(environmentPosition.z * .19)) * sin(environmentPosition.z * .43 + environmentPosition.x * .09);
        diffuseColor.rgb *= vec3(.83, .94, .69) * (1.0 + .055 * meadow);`);
  };
  material.customProgramCacheKey = () => 'm15a-meadow-v1';
  return material;
}

/** Signed translation in world X, driven exclusively by authoritative elapsed
 * seconds. No browser clock, accumulating delta, per-river loop or timer. */
export function waterFlowOffset(seconds: number, river: Pick<RiverLayout, 'direction'|'strength'>): number {
  return seconds === 0 ? 0 : seconds * river.direction * (river.strength === 'fast' ? 1.65 : .65);
}
export function flowingWater(river?: RiverLayout): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: 0x247faf, roughness: .74 });
  material.name = 'environment-flowing-water';
  const flow = { value: 0 };
  const rocks = Array.from({length:6}, (_,i) => {
    const rock=river?.rocks[i];
    return rock ? new Vector4(rock.x,rock.z,rock.size==='medium'?.78:.43,rock.size==='medium'?.66:.38) : new Vector4(0,0,-1,-1);
  });
  material.userData.flow = flow;
  material.userData.river = river;
  material.onBeforeCompile = shader => {
    shader.uniforms.environmentFlow = flow;
    shader.uniforms.environmentRocks = { value: rocks };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 environmentPosition;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nenvironmentPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 environmentPosition;
      uniform float environmentFlow;
      uniform vec4 environmentRocks[6];`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = environmentPosition.xz;
        float x = p.x - environmentFlow;
        float row = floor(p.y * 3.2);
        float phase = x * .72 + sin(row * 19.7) * 3.0;
        float stroke = smoothstep(.74,.86,sin(phase * 6.283185)) * (1.0-smoothstep(.035,.10,abs(fract(p.y * 3.2)-.5)));
        float broad = sin(x * .55 + p.y * 1.7) * .025;
        float foam = 0.0;
        for (int i=0;i<6;i++) {
          vec4 rock = environmentRocks[i];
          if(rock.z > 0.0) {
            float ring = length((p-rock.xy)/rock.zw);
            foam += (1.0-smoothstep(.04,.14,abs(ring-1.0))) * (.38+.12*sin(x*3.0+p.y*4.0));
          }
        }
        diffuseColor.rgb = mix(diffuseColor.rgb * vec3(.69,1.06,.94) * (1.0+broad), vec3(.40,.74,.73), clamp(stroke*.38+foam,0.0,.55));`);
  };
  material.customProgramCacheKey = () => 'm15a-water-v1';
  return material;
}
export function updateWater(material: MeshStandardMaterial, seconds: number): void {
  const river = material.userData.river as RiverLayout | undefined;
  material.userData.flow.value = river ? waterFlowOffset(seconds,river) : 0;
}

export function asphaltMaterial():MeshStandardMaterial {
  const material=new MeshStandardMaterial({color:0x34444a,roughness:1});
  material.name='environment-asphalt';
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 environmentPosition;')
      .replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nenvironmentPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 environmentPosition;')
      .replace('#include <color_fragment>',`#include <color_fragment>
        float grain=sin(environmentPosition.x*2.7+sin(environmentPosition.z*4.1))*sin(environmentPosition.z*3.3);
        diffuseColor.rgb *= vec3(.75,.77,.82)*(1.0+.025*grain);`);
  };
  material.customProgramCacheKey=()=> 'm15a-asphalt-v1';return material;
}

/** Colour only, on the exact original support/slope geometry. No new ledge or
 * stepping surface; the wet-soil tint stops short of the actual water volume. */
export function shorelineMaterial(center:number):MeshStandardMaterial {
  const material=grassMaterial(),compile=material.onBeforeCompile;
  const shoreline={value:center};
  material.onBeforeCompile=(shader,renderer)=>{
    compile.call(material,shader,renderer);
    shader.uniforms.environmentShore=shoreline;
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float environmentShore;')
      .replace('#include <roughnessmap_fragment>',`float shore = 1.0-smoothstep(2.48,2.88,abs(environmentPosition.z-environmentShore));
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.25,.29,.16),shore*.38);
        #include <roughnessmap_fragment>`);
  };
  material.customProgramCacheKey=()=> 'm15a-shore-v1';return material;
}
