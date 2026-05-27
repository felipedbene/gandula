import type { ReactNode } from "react";

type AsciiBoxProps = {
  title?: string;
  double?: boolean;
  width?: number;
  hint?: string;
  children?: ReactNode;
};

export function AsciiBox({
  title,
  double = false,
  width = 78,
  hint,
  children,
}: AsciiBoxProps) {
  const c = double
    ? { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" }
    : { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" };

  const topLead = c.tl + c.h + (title ? " " : "");
  const topTrail = title
    ? " " + c.h.repeat(Math.max(0, width - title.length - 5)) + c.tr
    : c.h.repeat(width - 3) + c.tr;

  const bottom = hint
    ? c.bl +
      c.h.repeat(Math.max(0, width - hint.length - 5)) +
      " " +
      hint +
      " " +
      c.h +
      c.br
    : c.bl + c.h.repeat(width - 2) + c.br;

  const edge = (c.v + "\n").repeat(200);

  return (
    <div className="ascii-box">
      <div className="ascii-box__top">
        <span>{topLead}</span>
        {title && <span className="ascii-box__title">{title}</span>}
        <span>{topTrail}</span>
      </div>
      <div className="ascii-box__body">
        <div className="ascii-box__edge ascii-box__edge--left" aria-hidden>
          {edge}
        </div>
        <div className="ascii-box__content">{children}</div>
        <div className="ascii-box__edge ascii-box__edge--right" aria-hidden>
          {edge}
        </div>
      </div>
      <div className="ascii-box__bottom">{bottom}</div>
    </div>
  );
}
