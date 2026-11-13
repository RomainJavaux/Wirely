import { describe, expect, it } from 'vitest';
import { Viewport } from '../src/core/viewport';

describe('Viewport.fit', () => {
  const bounds = { x0: 0, y0: 0, x1: 400, y1: 300 };

  it('cadre le contenu au centre de la zone', () => {
    const v = new Viewport();
    v.fit(bounds, 1000, 700);
    expect(v.k).toBeGreaterThan(0);
    // le centre du contenu tombe au centre de la zone
    expect(v.x + 200 * v.k).toBeCloseTo(500);
    expect(v.y + 150 * v.k).toBeCloseTo(350);
  });

  it('ne dépasse pas 2× pour un petit contenu', () => {
    const v = new Viewport();
    v.fit({ x0: 0, y0: 0, x1: 10, y1: 10 }, 1000, 700);
    expect(v.k).toBe(2);
  });

  it('ignore une zone trop petite ou masquée plutôt que de produire une échelle négative', () => {
    const v = new Viewport();
    v.fit(bounds, 1000, 700);
    const before = { x: v.x, y: v.y, k: v.k };
    v.fit(bounds, 0, 8);
    v.fit(bounds, 50, 50);
    expect({ x: v.x, y: v.y, k: v.k }).toEqual(before);
  });

  it('garde une échelle positive même pour un contenu immense', () => {
    const v = new Viewport();
    v.fit({ x0: 0, y0: 0, x1: 1e7, y1: 1e7 }, 800, 600);
    expect(v.k).toBeGreaterThan(0);
  });

  it('centre le plan vide', () => {
    const v = new Viewport();
    v.fit(null, 800, 600);
    expect([v.k, v.x, v.y]).toEqual([1, 400, 300]);
  });
});

describe('Viewport.pinch', () => {
  it('zoome autour du milieu des doigts et suit leur déplacement', () => {
    const v = new Viewport();
    v.fit({ x0: 0, y0: 0, x1: 400, y1: 300 }, 1000, 700);
    const under = v.toWorld(300, 200); // point du plan sous le milieu des doigts
    v.pinch(300, 200, 1.5, 40, -10);
    // Le même point du plan se retrouve sous les doigts, qui ont glissé de (40, -10).
    const after = v.toWorld(340, 190);
    expect(after[0]).toBeCloseTo(under[0]);
    expect(after[1]).toBeCloseTo(under[1]);
  });

  it('reste dans les bornes du zoom et prévient une seule fois', () => {
    const v = new Viewport();
    let calls = 0;
    v.subscribe(() => calls++);
    v.pinch(0, 0, 100, 0, 0);
    expect(v.k).toBe(4);
    v.pinch(0, 0, 0.0001, 0, 0);
    expect(v.k).toBe(0.2);
    expect(calls).toBe(2);
  });
});
