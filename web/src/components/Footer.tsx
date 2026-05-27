type FooterProps = {
  status: string;
};

export function Footer({ status }: FooterProps) {
  return (
    <div className="status">
      &gt; {status}
      <span className="cursor">█</span>
    </div>
  );
}
