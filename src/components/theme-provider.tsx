"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Theme provider — toggles the `.dark` class on <html> (Tailwind darkMode: class).
 * Light = "Operations"; Dark = "Nightshift Command".
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
