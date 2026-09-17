/**
 * What the accname algorithm makes of an element, for tests that check it.
 *
 * The package ships its own types under `dist/`, but its `exports` map has
 * no `types` condition, so bundler resolution cannot reach them. It arrives
 * with Testing Library and is used here to assert the name a control really
 * has rather than the name its markup looks like it gives.
 */
declare module "dom-accessibility-api" {
  export function computeAccessibleName(element: Element): string;
}
