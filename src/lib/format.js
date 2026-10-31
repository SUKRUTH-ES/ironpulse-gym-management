// Display helpers. MySQL returns DATE/DATETIME as strings ("2026-10-31 18:30:00").

const toDate = (value) => (value instanceof Date ? value : new Date(String(value).replace(' ', 'T')));

export const inr = (n) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n || 0));

export const num = (n) => new Intl.NumberFormat('en-IN').format(Number(n || 0));

export const date = (value) =>
    value ? toDate(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const dateShort = (value) =>
    value ? toDate(value).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';

export const time = (value) =>
    value ? toDate(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—';

export const dateTime = (value) => (value ? `${dateShort(value)}, ${time(value)}` : '—');

export const label = (s) => (s ? String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—');

// "YYYY-MM-DD" for <input type="date"> in local time
export const isoDay = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// A moment n days before/after now (negative n = in the future)
export const daysAgo = (n) => new Date(Date.now() - n * 86400000);

export const payMethod = (m) => ({ upi: 'UPI', card: 'Card', cash: 'Cash', netbanking: 'Net banking' })[m] ?? label(m);
