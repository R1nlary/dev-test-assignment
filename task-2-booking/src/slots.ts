import type { Booking, Master, Service } from './types.ts';
import { now } from './clock.ts';
import { fromMinutes, overlaps, toMinutes, TZ_OFFSET, weekday } from './time.ts';

export const SLOT_STEP_MIN = 15;

export function getSlots(master: Master, service: Service, date: string, bookings: Booking[]): string[] {
  const day = master.schedule[weekday(date)];
  if (!day) return [];

  const result: string[] = [];
  const endOfDay = toMinutes(day.to);
  const currentTime = now().getTime();

  for (let t = toMinutes(day.from); t + service.durationMin <= endOfDay; t += SLOT_STEP_MIN) {
    const start = new Date(`${date}T${fromMinutes(t)}:00${TZ_OFFSET}`).getTime();
    const end = start + service.durationMin * 60_000;
    if (start <= currentTime) continue;

    const slot = { start, end };
    const onBreak = day.breaks.some((b) => {
      const breakStart = new Date(`${date}T${b.from}:00${TZ_OFFSET}`).getTime();
      const breakEnd = new Date(`${date}T${b.to}:00${TZ_OFFSET}`).getTime();
      return overlaps(slot, { start: breakStart, end: breakEnd });
    });
    if (onBreak) continue;

    const busy = bookings.some((b) => b.masterId === master.id && b.status === 'active' && overlaps(slot, {
      start: new Date(b.start).getTime(),
      end: new Date(b.end).getTime(),
    }));
    if (!busy) result.push(fromMinutes(t));
  }

  return result;
}
