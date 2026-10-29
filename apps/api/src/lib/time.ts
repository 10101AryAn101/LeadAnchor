export const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

export const isoOrNow = (date: Date | null | undefined) => (date ?? new Date()).toISOString();

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
