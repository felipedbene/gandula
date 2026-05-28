import { Text } from "@mantine/core";

type FooterProps = {
  status: string;
};

export function Footer({ status }: FooterProps) {
  return (
    <Text c="dimmed" size="sm" ff="monospace" mt="md">
      &gt; {status}
      <span className="cursor">█</span>
    </Text>
  );
}
