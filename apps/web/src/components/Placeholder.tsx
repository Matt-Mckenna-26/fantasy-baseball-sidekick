/** Empty-state placeholder for screens that arrive in later slices. */
export function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <section className="placeholder">
      <h1>{title}</h1>
      <p>{description}</p>
      <p className="placeholder__badge">Coming in a later slice</p>
    </section>
  );
}
