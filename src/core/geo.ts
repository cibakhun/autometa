const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Lat/lng box that contains every point within radiusKm; used as a cheap index prefilter. */
export function boundingBox(lat: number, lng: number, radiusKm: number) {
  const dLat = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  const dLng = dLat / Math.max(Math.cos(toRad(lat)), 0.01);
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

/** SQL expression for the great-circle distance in km between a row's lat/lng and a point. */
export function distanceSql(latColumn: string, lngColumn: string, latParam: string, lngParam: string): string {
  return `(2 * ${EARTH_RADIUS_KM} * asin(sqrt(
    power(sin(radians(${latColumn} - ${latParam}) / 2), 2)
    + cos(radians(${latParam})) * cos(radians(${latColumn})) * power(sin(radians(${lngColumn} - ${lngParam}) / 2), 2)
  )))`;
}
