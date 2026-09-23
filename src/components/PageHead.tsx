export function PageHead({
  eyebrow,
  title,
  lead,
  aside,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-2xl">
        <span className="eyebrow enter">{eyebrow}</span>
        <h1 className="display enter enter-1 mt-4 text-4xl sm:text-5xl">{title}</h1>
        {lead && <p className="lead enter enter-2 mt-4">{lead}</p>}
      </div>
      {aside && <div className="enter enter-2">{aside}</div>}
    </div>
  );
}
