// @rev kc-31
import type { Assignment, Branch, Order } from './types.ts';
import { assignBranch } from './router.ts';
import { almatyDate } from './day.ts';

export type Dispatcher = {
  findBranch(id: string): Branch | undefined;
  assign(orderId: string): Assignment | null;
  load(branchId: string, date: string): number;
};

export function createDispatcher(branches: Branch[], orders: Order[]): Dispatcher {
  const assignments = new Map<string, Assignment>();
  const loadByDay = new Map<string, number>();

  const key = (branchId: string, date: string) => `${branchId}|${date}`;
  const load = (branchId: string, date: string) => loadByDay.get(key(branchId, date)) ?? 0;

  return {
    findBranch: (id) => branches.find((b) => b.id === id),

    assign(orderId) {
      const existing = assignments.get(orderId);
      if (existing) return existing;

      const order = orders.find((o) => o.id === orderId);
      if (!order) return null;

      const date = almatyDate(order.createdAt);
      const result = assignBranch(order, branches, (b) => load(b.id, date) >= b.dailyLimit);

      assignments.set(orderId, result);
      if (result.branchId) loadByDay.set(key(result.branchId, date), load(result.branchId, date) + 1);
      return result;
    },

    load,
  };
}
