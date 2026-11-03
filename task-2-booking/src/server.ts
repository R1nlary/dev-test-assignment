// @rev kc-31
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { now } from './clock.ts';
import { getSlots } from './slots.ts';
import { bookingRepo, masters, services } from './store.ts';
import type { Booking } from './types.ts';

const port = Number(process.env.PORT ?? 3002);
const locks = new Map<string, Promise<void>>();
const TWO_HOURS = 2 * 60 * 60 * 1000;

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function phoneNumber(input: unknown): string | null {
  if (typeof input !== 'string' || !/^\+?[\d\s()\-]+$/.test(input)) return null;
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (!/^7(70[0-8]|74\d|75\d|76\d|77\d)\d{7}$/.test(digits)) return null;
  return `+${digits}`;
}

function parseStart(input: unknown): Date | null {
  if (typeof input !== 'string') return null;
  const match = input.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/);
  if (!match || !validDate(match[1])) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (match[6] !== 'Z') {
    const offsetHours = Number(match[6].slice(1, 3));
    const offsetMinutes = Number(match[6].slice(4));
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) return null;
  }
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function withMasterLock<T>(masterId: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(masterId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  locks.set(masterId, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (locks.get(masterId) === current) locks.delete(masterId);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    if (req.method === 'GET' && url.pathname === '/masters') return send(res, 200, masters);
    if (req.method === 'GET' && url.pathname === '/services') return send(res, 200, services);

    if (req.method === 'GET' && parts[0] === 'masters' && parts[2] === 'slots' && parts.length === 3) {
      const master = masters.find((m) => m.id === parts[1]);
      if (!master) return send(res, 404, { error: 'master_not_found' });
      const serviceId = url.searchParams.get('serviceId');
      const service = services.find((s) => s.id === serviceId);
      if (!serviceId) return send(res, 400, { error: 'serviceId_required' });
      if (!service) return send(res, 404, { error: 'service_not_found' });
      const date = url.searchParams.get('date');
      if (!validDate(date) || !service.masterIds.includes(master.id)) {
        return send(res, 400, { error: 'invalid_request' });
      }
      const bookings = await bookingRepo.listByMaster(master.id);
      return send(res, 200, { masterId: master.id, serviceId, date, slots: getSlots(master, service, date, bookings) });
    }

    if (req.method === 'POST' && url.pathname === '/bookings') {
      let body: unknown;
      try { body = await readJson(req); } catch { return send(res, 400, { error: 'invalid_json' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'invalid_request' });
      const input = body as Record<string, unknown>;
      if (typeof input.masterId !== 'string' || typeof input.serviceId !== 'string') {
        return send(res, 400, { error: 'invalid_request' });
      }
      const master = masters.find((m) => m.id === input.masterId);
      const service = services.find((s) => s.id === input.serviceId);
      if (!master) return send(res, 404, { error: 'master_not_found' });
      if (!service) return send(res, 404, { error: 'service_not_found' });
      if (!service.masterIds.includes(master.id)) return send(res, 400, { error: 'service_unavailable' });
      const start = parseStart(input.start);
      const clientPhone = phoneNumber(input.clientPhone);
      if (!start || !clientPhone) return send(res, 400, { error: 'invalid_request' });

      const result = await withMasterLock(master.id, async () => {
        if (start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0) return null;
        const date = new Date(start.getTime() + 5 * 60 * 60_000).toISOString().slice(0, 10);
        const hhmm = new Date(start.getTime() + 5 * 60 * 60_000).toISOString().slice(11, 16);
        const bookings = await bookingRepo.listByMaster(master.id);
        if (!getSlots(master, service, date, bookings).includes(hhmm)) return null;
        const booking: Booking = {
          id: `bk-${randomUUID()}`,
          masterId: master.id,
          serviceId: service.id,
          start: start.toISOString(),
          end: new Date(start.getTime() + service.durationMin * 60_000).toISOString(),
          clientPhone,
          status: 'active',
        };
        await bookingRepo.insert(booking);
        return booking;
      });
      if (!result) return send(res, 409, { error: 'slot_unavailable' });
      return send(res, 201, result);
    }

    if (req.method === 'DELETE' && parts[0] === 'bookings' && parts.length === 2) {
      const booking = await bookingRepo.get(parts[1]);
      if (!booking) return send(res, 404, { error: 'booking_not_found' });
      if (booking.status === 'cancelled') return send(res, 200, booking);
      if (new Date(booking.start).getTime() - now().getTime() < TWO_HOURS) {
        return send(res, 409, { error: 'too_late' });
      }
      await bookingRepo.update(booking.id, { status: 'cancelled' });
      return send(res, 200, { ...booking, status: 'cancelled' });
    }

    return send(res, 404, { error: 'not_found' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: 'internal' });
  }
});

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : null;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

server.listen(port, () => {
  console.log(`booking: http://localhost:${port}`);
});
