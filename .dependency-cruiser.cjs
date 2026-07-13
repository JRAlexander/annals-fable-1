/**
 * The one architectural wall that keeps the simulation headless-testable and
 * worker-portable: nothing in the pure layers may depend on three.js or on the
 * presentation layers. (DOM/wall-clock/Math.random access is caught separately
 * by scripts/purity-check.sh, since it isn't a module dependency.)
 */
module.exports = {
  forbidden: [
    {
      name: 'headless-no-three',
      comment: 'core/content/worldgen/sim must never import three.js',
      severity: 'error',
      from: { path: '^src/(core|content|worldgen|sim)' },
      to: { path: 'node_modules/three|^three' },
    },
    {
      name: 'headless-no-presentation',
      comment: 'core/content/worldgen/sim must never import render/ui/app',
      severity: 'error',
      from: { path: '^src/(core|content|worldgen|sim)' },
      to: { path: '^src/(render|ui|app)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
