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
    <Card withBorder radius="md" padding="md">
      {title !== undefined && (
        <Text
          tt="uppercase"
          c="dimmed"
          fw={700}
          size="xs"
          mb="sm"
          style={{ letterSpacing: "0.06em" }}
        >
          {title}
        </Text>
      )}
      {children}
    </Card>
  );
}
