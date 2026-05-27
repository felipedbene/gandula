import type { ReactNode } from "react";

type AsciiBoxProps = {
  title?: string;
  double?: boolean;
  width?: number;
  hint?: string;
  /** Optional content rendered above a `╠══╣` (or `├──┤`) divider, before
   *  the main body. When present, `title` is typically omitted — the top
   *  border becomes plain dashes and the title-like content lives in the
   *  header row (mockup.html lines 67-71 pattern). */
  header?: ReactNode;
  children?: ReactNode;
};

export function AsciiBox({
  title,
  double = false,
  width = 78,
  hint,
  header,
  children,
}: AsciiBoxProps) {
  const c = double
    ? { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║", dl: "╠", dr: "╣" }
    : { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│", dl: "├", dr: "┤" };

  // Mockup convention: double-line uses 2 dashes adjacent to title/hint,
  // single-line uses 1. See docs/ui-dos-redesign/mockup.html lines 73 vs 82.
  const leadDashes = double ? 2 : 1;

  const topLead = title ? c.tl + c.h.repeat(leadDashes) + " " : c.tl;
  const topTrail = title
    ? " " +
      c.h.repeat(Math.max(0, width - 4 - leadDashes - title.length)) +
      c.tr
    : c.h.repeat(width - 2) + c.tr;

  const bottom = hint
    ? c.bl +
      c.h.repeat(Math.max(0, width - 4 - leadDashes - hint.length)) +
      " " +
      hint +
      " " +
      c.h.repeat(leadDashes) +
      c.br
    : c.bl + c.h.repeat(width - 2) + c.br;

  const divider = c.dl + c.h.repeat(width - 2) + c.dr;

  const edge = (c.v + "\n").repeat(200);

  const renderBodySection = (content: ReactNode) => (
    <div className="ascii-box__body">
      <div className="ascii-box__edge ascii-box__edge--left" aria-hidden>
        {edge}
      </div>
      <div className="ascii-box__content">{content}</div>
      <div className="ascii-box__edge ascii-box__edge--right" aria-hidden>
        {edge}
      </div>
    </div>
  );

  return (
    <div className="ascii-box">
      <div className="ascii-box__top">
        <span>{topLead}</span>
        {title && <span className="ascii-box__title">{title}</span>}
        <span>{topTrail}</span>
      </div>
      {header && (
        <>
          {renderBodySection(header)}
          <div className="ascii-box__divider">{divider}</div>
        </>
      )}
      {renderBodySection(children)}
      <div className="ascii-box__bottom">{bottom}</div>
    </div>
  );
}
