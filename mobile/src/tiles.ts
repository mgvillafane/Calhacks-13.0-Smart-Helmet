import { LatLng } from "./geo";

export const TILE_PX = 256;
const MAX_TILES = 16;

export type TilePlan = {
  zoom: number;
  minX: number;
  minY: number;
  widthTiles: number;
  heightTiles: number;
  tiles: { x: number; y: number }[];
};

export function mercatorTile(lat: number, lng: number, zoom: number): [number, number] {
  const scale = 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * scale;
  return [x, y];
}

export function planTiles(points: LatLng[]): TilePlan {
  let chosen = planAt(points, 3);
  for (let zoom = 16; zoom >= 3; zoom -= 1) {
    const plan = planAt(points, zoom);
    if (plan.tiles.length <= MAX_TILES) {
      chosen = plan;
      break;
    }
  }
  return chosen;
}

export function pointPixel(point: LatLng, plan: TilePlan): [number, number] {
  const [x, y] = mercatorTile(point[0], point[1], plan.zoom);
  return [(x - plan.minX) * TILE_PX, (y - plan.minY) * TILE_PX];
}

function planAt(points: LatLng[], zoom: number): TilePlan {
  const projected = points.map((point) => mercatorTile(point[0], point[1], zoom));
  const minX = Math.floor(Math.min(...projected.map((point) => point[0])));
  const maxX = Math.floor(Math.max(...projected.map((point) => point[0])));
  const minY = Math.floor(Math.min(...projected.map((point) => point[1])));
  const maxY = Math.floor(Math.max(...projected.map((point) => point[1])));
  const tiles: { x: number; y: number }[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) tiles.push({ x, y });
  }
  return { zoom, minX, minY, widthTiles: maxX - minX + 1, heightTiles: maxY - minY + 1, tiles };
}
