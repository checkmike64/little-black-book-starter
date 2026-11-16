export type PromiseRouteRow = {
  direction: string;
  due_on: string | null;
  contacts?: {
    id?: string | null;
  } | null;
};

export function promiseLaneHref(promise: PromiseRouteRow): string;

export function promiseMovementHref(promise: PromiseRouteRow, now?: Date): string;

export function promisePrimaryHref(promise: PromiseRouteRow): string;
