import type { Assignment, Branch, Order } from './types.ts';
import { distanceKm } from './geo.ts';

const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

export function almatyDate(iso: string): string {
  return new Date(new Date(iso).getTime() + ALMATY_OFFSET_MS).toISOString().slice(0, 10);
}

export function branchLoad(
  branchId: string,
  date: string,
  assignments: Map<string, Assignment>,
  orders: Order[],
): number {
  return [...assignments.values()].filter((a) => {
    if (a.branchId !== branchId) return false;
    const order = orders.find((o) => o.id === a.orderId);
    return order !== undefined && almatyDate(order.createdAt) === date;
  }).length;
}

export function assignBranch(
  order: Order,
  branches: Branch[],
  assignments: Map<string, Assignment> = new Map(),
  orders: Order[] = [],
): Assignment {
  const alreadyAssigned = assignments.get(order.id);
  if (alreadyAssigned) return alreadyAssigned;

  const own = branches.filter((b) => b.storeId === order.storeId && b.active);
  const result = (branch: Branch | null, rule: Assignment['rule']): Assignment => ({
    orderId: order.id,
    branchId: branch?.id ?? null,
    rule,
  });

  // Manual assignment is allowed even when the limit is reached.
  if (order.manualBranchId) {
    const manual = own.find((b) => b.id === order.manualBranchId);
    if (manual) return result(manual, 'manual');
  }

  let chosen: Branch | null = null;
  let rule: Assignment['rule'] = 'unassigned';

  if (own.length === 1) {
    chosen = own[0];
    rule = 'single';
  } else {
    if (order.pickupPointId) {
      chosen = own.find((b) => b.pickupPointIds.includes(order.pickupPointId!)) ?? null;
      if (chosen) rule = 'pickup_point';
    }

    const inCity = own.filter((b) => b.city === order.city);
    if (!chosen && inCity.length === 1) {
      chosen = inCity[0];
      rule = 'city';
    }

    if (!chosen) {
      chosen = findNearest(order, inCity.length > 1 ? inCity : own);
      if (chosen) rule = 'geo';
    }
  }

  if (!chosen) return result(null, 'unassigned');

  const date = almatyDate(order.createdAt);
  const hasSpace = (b: Branch) => branchLoad(b.id, date, assignments, orders) < b.dailyLimit;
  if (hasSpace(chosen)) return result(chosen, rule);

  // If the selected branch is full, use the nearest available branch.
  const fallback = findNearest(order, own.filter(hasSpace));
  return fallback ? result(fallback, 'geo') : result(null, 'unassigned');
}

function findNearest(order: Order, branches: Branch[]): Branch | null {
  if (order.lat === null || order.lon === null) return null;
  let best: Branch | null = null;
  let bestDist = Infinity;

  for (const b of branches) {
    const d = distanceKm(order.lat, order.lon, b.lat, b.lon);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}
