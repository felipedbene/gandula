// Type declaration for CSS Modules consumed by SRCL primitives via the
// `@components/*` alias. Vite handles the runtime; this only satisfies tsc.
declare module "@components/*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
