export const now = () => Date.now();

export const fromNow = (ms: number) => now() + ms;

export const hours = (value: number) => value * 60 * 60 * 1000;

export const minutes = (value: number) => value * 60 * 1000;
