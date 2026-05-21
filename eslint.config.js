// Flat-config shim so the repo-root global eslint v9+ can lint files inside
// app/frontend without choking on a missing config. The real lint surface
// for the webapp is app/frontend/.eslintrc.json (consumed via `npm run lint`
// inside app/frontend). This file exists only so the editor/hook eslint
// invocation does not block on a missing config.
module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.workflow/**',
      'app/backend/**',
    ],
  },
];
