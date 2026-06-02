import { Card, Text } from "@mantine/core";
import type { ReactNode } from "react";

/**
 * Mantine-based replacement for the old srcl/Card: a bordered surface with an
 * optional uppercase, dimmed title. Drop-in for `<Card title=...>` usages
 * across the screens during the migration.
 */
export function Panel({
  title,
  children,
}: {
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card
      radius="md"
      padding="md"
      bg="ink.8"
      style={{ border: "1px solid var(--mantine-color-ink-7)" }}
    >
      {title !== undefined && (
        <Text
          tt="uppercase"
          c="dimmed"
          fw={600}
          size="xs"
          mb="sm"
          style={{ letterSpacing: "0.08em" }}
        >
          {title}
        </Text>
      )}
      {children}
    </Card>
  );
}
