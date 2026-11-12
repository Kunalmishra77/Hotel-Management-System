/**
 * The heading block shared by every signed-out screen (sign-in, 2FA, forgot,
 * reset) so the four read as one flow inside the auth layout's form column.
 * No card chrome here — the layout already supplies the surface.
 */
export function AuthPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section aria-labelledby="auth-title">
      <h1 id="auth-title" className="text-balance font-serif text-[26px] font-semibold leading-tight text-foreground">
        {title}
      </h1>
      {description && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>}
      <div className="mt-7">{children}</div>
    </section>
  );
}
