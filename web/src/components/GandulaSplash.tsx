import { Box, Button, Stack, Text, Title } from "@mantine/core";

/**
 * Branded landing/splash for a fresh career (the `form` phase — shown only
 * when there's no save to auto-continue). A glowing crest, the wordmark, a
 * one-line pitch, and the entry CTAs. Behaviour is unchanged from the old
 * plain form: `onStart` runs a new career, `onSupport` opens the support
 * screen; `onFriendly` opens the standalone exhibition match.
 */
export function GandulaSplash({
  onStart,
  onFriendly,
  onSupport,
}: {
  onStart: () => void;
  onFriendly: () => void;
  onSupport: () => void;
}) {
  return (
    <Stack align="center" gap="lg" py={{ base: "lg", sm: "xl" }}>
      {/* Glowing ball crest — a radial gradient orb with a soft accent halo. */}
      <Box
        style={{
          width: 96,
          height: 96,
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 35% 30%, #ffffff 0%, #c8f5dc 18%, var(--mantine-color-accent-5) 60%, var(--mantine-color-accent-8) 100%)",
          boxShadow:
            "0 0 32px 6px rgba(21, 184, 101, 0.55), inset 0 0 12px rgba(255,255,255,0.4)",
        }}
      />

      <Stack align="center" gap={4}>
        <Title
          order={1}
          fz={{ base: 40, sm: 56 }}
          style={{
            letterSpacing: "-0.03em",
            textShadow: "0 0 24px rgba(21, 184, 101, 0.5)",
          }}
        >
          Gandula
        </Title>
        <Text c="dimmed" ta="center" maw={420} px="md">
          Pegue um time da Série C e leve-o ao topo do Brasileirão Imaginário.
          Tática, mercado, finanças e Copa do Brasil — uma temporada de cada vez.
        </Text>
      </Stack>

      <Stack gap="sm" w="100%" maw={300} mt="md">
        <Button size="md" onClick={onStart}>
          Nova carreira
        </Button>
        <Button size="md" variant="default" onClick={onFriendly}>
          Amistoso
        </Button>
        <Button size="sm" variant="subtle" onClick={onSupport}>
          Apoiar projeto
        </Button>
      </Stack>
    </Stack>
  );
}
