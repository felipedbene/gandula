// Minimal stub of SRCL's @common/utilities. Upstream SRCL bundles a number
// of layout/text helpers here; we only re-export the ones our copied
// primitives reference. Add more as we copy more SRCL components — keep
// the surface tight rather than pulling the whole upstream module in.

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
