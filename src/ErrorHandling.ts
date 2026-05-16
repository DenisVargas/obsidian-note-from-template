/* -------------------------------------------------------------------------- */
/*             Error Handling via Pattern Matching (more explicit)            */
/* -------------------------------------------------------------------------- */

export type Ok<T> = {
	ok:true;
	value: T;
};
export type Err<E extends Error> = {
	ok: false;
	error: E;
};

export type Result<T, E extends Error> = Ok<T> | Err<E>;

export const Ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const Err = <E extends Error>(error: E): Err<E> => ({ ok: false, error });
