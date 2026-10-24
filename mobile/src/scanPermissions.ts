export function helmetScanPermissions(apiLevel: number): "nearby" | "location" {
  return apiLevel >= 31 ? "nearby" : "location";
}
