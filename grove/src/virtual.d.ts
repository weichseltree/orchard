// Fixed asset path -> content-hashed path, written by build/fingerprint.ts;
// empty in dev and under vitest.
declare module "virtual:grove-asset-map" {
  const map: Readonly<Record<string, string>>;
  export default map;
}
