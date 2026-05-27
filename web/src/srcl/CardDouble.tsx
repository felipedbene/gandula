import styles from "@components/CardDouble.module.css";

import * as React from "react";

// `title` is omitted from HTMLAttributes because the native HTML `title`
// attribute is typed as `string` and would clash with our ReactNode signature.
interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  children?: React.ReactNode;
  title?: string | React.ReactNode;
  /** Optional label rendered in the top-right notch, mirroring `title`.
   *  Truncates with ellipsis if the combined widths would overflow.
   *  Extension over upstream SRCL — keeps the GANDULA `╔═ TITLE ═══ vN ═╗`
   *  layout doable with a single primitive. */
  titleRight?: string | React.ReactNode;
  mode?: string | any;
  style?: any;
}

const CardDouble: React.FC<CardProps> = ({ children, mode, title, titleRight, style }) => {
  // Three independent decisions inform the top row:
  //   - left side : .left vs .leftCorner (mode === 'left' uses Corner)
  //   - left slot : <h2> only if `title` is set, else an empty spacer
  //   - right side: mirror, but driven by `titleRight` + mode === 'right'
  // The notches break the top border around whichever side has a label;
  // sides without a label keep the border continuous via the spacer divs.
  const leftClass = mode === "left" ? styles.leftCorner : styles.left;
  const rightClass = mode === "right" ? styles.rightCorner : styles.right;

  // When both notches are populated we need a third spacer between them so
  // the top border stays continuous across the gap. With just one title (or
  // none) the original two-spacer layout suffices.
  const titleElement = (
    <header className={styles.action}>
      <div className={leftClass} aria-hidden="true"></div>
      {title ? <h2 className={styles.title}>{title}</h2> : null}
      {title && titleRight ? <div className={styles.middle} aria-hidden="true"></div> : null}
      {titleRight ? <h2 className={styles.titleRight}>{titleRight}</h2> : null}
      <div className={rightClass} aria-hidden="true"></div>
    </header>
  );

  return (
    <article className={styles.card}>
      {titleElement}
      <section className={styles.children} style={style}>
        {children}
      </section>
    </article>
  );
};

export default CardDouble;
