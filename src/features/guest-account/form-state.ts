/**
 * Shared form state for the guest-account auth forms (Phase 2).
 *
 * This is a PLAIN module — deliberately NOT a `"use server"` file. A `"use server"`
 * module may export async functions ONLY; exporting a value (like the idle-state
 * object) from one throws "A 'use server' file can only export async functions,
 * found object" the moment an action in it is invoked. So the `(prevState, formData)`
 * state shape and its idle constant live here, and `form-actions.ts` (the server
 * actions) plus the client forms both import them from this file.
 */
export type GuestFormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> }
  | { status: "otp_sent"; mobile: string; devCode?: string };

export const GUEST_FORM_IDLE: GuestFormState = { status: "idle" };
