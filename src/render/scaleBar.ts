const NICE_METERS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] as const;

export interface ScaleBar {
  /** Longueur représentée, en mètres. */
  meters: number;
  /** Largeur de la barre à l'écran, en pixels. */
  px: number;
  label: string;
}

/**
 * Barre d'échelle : la plus petite longueur « ronde » (0,5 m, 1 m, 2 m, 5 m…) dont la barre
 * mesure au moins `minPx` pixels à l'écran.
 */
export function niceScaleBar(pxPerMeter: number, minPx = 64): ScaleBar {
  const safe = pxPerMeter > 0 && Number.isFinite(pxPerMeter) ? pxPerMeter : 1;
  const meters = NICE_METERS.find((m) => m * safe >= minPx) ?? NICE_METERS[NICE_METERS.length - 1];
  const label = `${String(meters).replace('.', ',')} m`;
  return { meters, px: meters * safe, label };
}
