import { expect, it } from 'vitest';
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, ShaderLib } from 'three';
import { generateSection, sectionBoxes, roadScenario, scenarios } from '@crossy/config';
import { BoundaryShading, playableSides } from './boundary-shading';
import { asphaltMaterial, flowingWater, grassMaterial, shorelineMaterial } from './environment-materials';

it('uses actual inner collider faces for generated and authored worlds without changing geometry', () => {
  const boxes = sectionBoxes(generateSection(42, 1)), before = structuredClone(boxes);
  expect(playableSides(boxes)).toEqual([-9.7, 9.7]);
  expect(playableSides(roadScenario.boxes)).toEqual([-9.7, 9.7]);
  expect(playableSides(scenarios[0]!.boxes)).toEqual([-11.7, 11.7]);
  expect(boxes).toEqual(before);
});

it('composes grass/asphalt/shore/water and standard GLB shaders with fragment-level instanced world coordinates', () => {
  const shading = new BoundaryShading(), root = new Group(), geometry = new BoxGeometry();
  shading.watch(root); shading.setBounds([-9.7, 9.7]);
  for (const material of [grassMaterial(), asphaltMaterial(), shorelineMaterial(12), flowingWater(), new MeshStandardMaterial()]) {
    const mesh = new InstancedMesh(geometry, material, 2); root.add(mesh);
    const compile = material.onBeforeCompile; shading.watch(mesh);
    expect(material.onBeforeCompile).toBe(compile);
    const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
    material.onBeforeCompile(shader as never, {} as never);
    expect(shader.vertexShader).toContain('instanceMatrix * boundaryPosition');
    expect(shader.vertexShader).toContain('modelMatrix * boundaryPosition');
    expect(shader.fragmentShader).toContain('smoothstep(0.0, .12, outsideDistance)');
    expect(shader.fragmentShader).toContain('gl_FragColor.rgb *=');
    expect(shader.fragmentShader).not.toContain('gl_FragCoord');
    expect(shader.uniforms).toHaveProperty('playableSides', shading.bounds);
    expect(material.customProgramCacheKey()).toContain('pre-m16-boundaries-v1');
    if (material.name === 'environment-flowing-water') expect(shader.uniforms).toHaveProperty('environmentFlow');
    material.dispose(); mesh.dispose();
  }
  // Asynchronous/streamed subtrees are shaded once without a draw-time scan.
  const section = new Group(), m = new MeshStandardMaterial(); root.add(section); section.add(new Mesh(geometry, m));
  expect(m.customProgramCacheKey()).toContain('pre-m16-boundaries-v1');
  shading.amount.value = 0; expect(shading.amount.value).toBe(0);
  geometry.dispose(); m.dispose();
});
