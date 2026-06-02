import { useEffect, useState } from "react";
import init from "./wasm/gandula_wasm.js";
import {
  Badge,
  Box,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Footer } from "./components/Footer";
import { SeasonView } from "./components/SeasonView";

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("pronto");
  const [teamName, setTeamName] = useState<string | null>(null);

  useEffect(() => {
    init()
      .then(() => setReady(true))
      .catch((e: unknown) =>
        setError(`Falha ao carregar o engine WASM: ${String(e)}`)
      );
  }, []);

  return (
    <>
      <Box
        component="header"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          backdropFilter: "blur(8px)",
          background: "rgba(14, 18, 20, 0.8)",
          borderBottom: "1px solid var(--mantine-color-ink-7)",
        }}
      >
        <Container size="sm" py="sm">
          <Group justify="space-between" align="center" wrap="nowrap">
            <Group gap="xs" align="center" wrap="nowrap" style={{ minWidth: 0 }}>
              <Title
                order={1}
                fz={{ base: "h3", sm: "h2" }}
                style={{ letterSpacing: "-0.02em", flexShrink: 0 }}
              >
                Gandula
              </Title>
              {teamName ? (
                <>
                  <Text c="dimmed" fz="lg" style={{ flexShrink: 0 }}>
                    ·
                  </Text>
                  <Text c="accent.3" fw={600} fz={{ base: "sm", sm: "md" }} truncate>
                    {teamName}
                  </Text>
                </>
              ) : (
                <Badge variant="light" color="accent" radius="sm" size="sm">
                  BETA
                </Badge>
              )}
            </Group>
            <Text c="dimmed" size="xs" ff="monospace" style={{ flexShrink: 0 }}>
              v{__APP_VERSION__}
            </Text>
          </Group>
        </Container>
      </Box>

      <Container size="sm" py="lg" pb={80}>
        <Stack gap="md">
          {error ? (
            <Text c="red" style={{ whiteSpace: "pre-wrap" }}>
              {error}
            </Text>
          ) : !ready ? (
            <Group gap="sm" py="xl" justify="center">
              <Loader size="sm" color="accent" />
              <Text c="dimmed">Carregando engine…</Text>
            </Group>
          ) : (
            <SeasonView onStatus={setStatus} onTeamName={setTeamName} />
          )}

          <Footer status={status} />
        </Stack>
      </Container>
    </>
  );
}
