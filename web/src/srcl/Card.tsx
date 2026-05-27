import styles from "@components/Card.module.css";

import * as React from "react";

// `title` is omitted from HTMLAttributes because the native HTML `title`
// attribute is typed as `string` and would clash with our ReactNode signature.
interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  children?: React.ReactNode;
  title?: string | React.ReactNode;
  mode?: string | any;
}

const Card: React.FC<CardProps> = ({ children, mode, title, style }) => {
  let titleElement = (
    <header className={styles.action}>
      <div className={styles.left} aria-hidden="true"></div>
      {title ? <h2 className={styles.title}>{title}</h2> : null}
      <div className={styles.right} aria-hidden="true"></div>
    </header>
  );

  if (mode === "left") {
    titleElement = (
      <header className={styles.action}>
        <div className={styles.leftCorner} aria-hidden="true"></div>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.right} aria-hidden="true"></div>
      </header>
    );
  }

  if (mode === "right") {
    titleElement = (
      <header className={styles.action}>
        <div className={styles.left} aria-hidden="true"></div>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.rightCorner} aria-hidden="true"></div>
      </header>
    );
  }

  return (
    <article className={styles.card} style={style}>
      {titleElement}
      <section className={styles.children}>{children}</section>
    </article>
  );
};

export default Card;
